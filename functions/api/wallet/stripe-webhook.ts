// POST /api/wallet/stripe-webhook — Stripe webhook for wallet topup completions.
// Verifies the event, credits the agent's wallet, activates referral if applicable.

import { creditWallet, activateReferral, recordFirstPaymentTrust, ownerIdForAgent, markAgentPendingOnTopup } from '../../lib/wallet';
import { saveCardForAutotopup } from '../../lib/autotopup';
import { mailerFromEnv } from '../../lib/email-send';
import { creditForTopup } from '../../lib/pricing';
import { sendNotificationEmail } from '../../lib/email';

interface Env {
  DB: D1Database;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_SECRET_KEY?: string;
  RESEND_API_KEY?: string;
}

// saveCardForAutotopup moved to lib/autotopup.ts (2026-07-13) — shared with confirm-autotopup.

// Verify Stripe's webhook signature (HMAC-SHA256 over `${timestamp}.${rawBody}`). Without this,
// a forged "checkout.session.completed" would credit a wallet for free.
async function verifyStripeSignature(body: string, sigHeader: string | null, secret: string): Promise<boolean> {
  if (!sigHeader) return false;
  const parts: Record<string, string> = {};
  for (const kv of sigHeader.split(',')) {
    const [k, v] = kv.split('=');
    if (k && v) parts[k.trim()] = v.trim();
  }
  const t = parts['t'];
  const v1 = parts['v1'];
  if (!t || !v1) return false;
  // Replay tolerance — reject events whose timestamp is too far from now (Stripe default 300s),
  // so a captured-and-replayed signed event can't be re-submitted later.
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(t)) > 300) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${body}`));
  const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  if (expected.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

// Shared credit core for a confirmed wallet top-up — the SINGLE money path, routed to by BOTH
// checkout.session.completed (embedded Checkout / topup.ts) AND payment_intent.succeeded (Elements /
// create-payment-intent.ts). Extracted verbatim from the original checkout handler so checkout behaviour
// is unchanged; each caller extracts its own fields (session vs PaymentIntent) and passes them in.
//   refId          — the wallet_topup_sessions row id (session.id | pi.id) the idempotency claim keys on.
//   capturedCents  — Stripe's authoritative captured amount (session.amount_total | pi.amount_received).
//   paidOk         — the caller's "fully paid" test (session.payment_status | pi.status==='succeeded').
//   cardSave       — {customerId, piId} when the payment carried the save-card opt-in, else null.
async function applyTopupCredit(db: D1Database, env: Env, args: {
  agentId: string; claimedCents: number; plan: string; refId: string;
  capturedCents: number | null; paidOk: boolean; cardSave: { customerId?: string | null; piId?: string | null } | null;
}): Promise<Response> {
  const { agentId, claimedCents, plan, refId, capturedCents, paidOk, cardSave } = args;

  if (!agentId || !claimedCents) {
    return new Response('Missing metadata', { status: 400 });
  }

  // Credit from the ACTUAL captured amount, never the client-set metadata (5k hardening 3). If Stripe's
  // authoritative amount disagrees with the metadata, DON'T credit — ack 200 so Stripe stops retrying.
  if (capturedCents != null && capturedCents !== claimedCents) {
    console.error(`stripe-webhook: amount mismatch on ${refId} — captured ${capturedCents} != metadata ${claimedCents}; not crediting`);
    return new Response('Amount mismatch — not credited', { status: 200 });
  }
  const amountCents = capturedCents ?? claimedCents; // authoritative captured amount

  // Only credit fully-paid — async methods can complete unpaid.
  if (!paidOk) {
    return new Response('Not paid', { status: 200 });
  }

  // Atomic idempotency claim — Stripe delivers at-least-once and retries; only the first delivery to
  // flip this row to 'paid' proceeds to credit. (Prevents the double-credit race.)
  const claim = await db.prepare(
    "UPDATE wallet_topup_sessions SET status = 'paid', paid_at = datetime('now') WHERE id = ? AND status != 'paid'"
  ).bind(refId).run();
  if (((claim.meta as any)?.changes ?? 0) === 0) {
    // Already 'paid' — trust the LEDGER, not the flag (review 2026-07-09): a prior delivery could have
    // claimed 'paid' then died BEFORE crediting (charged-not-credited). Only treat as done if a ledger
    // row exists for this ref; otherwise fall through and credit (self-healing — the amount-mismatch and
    // paidOk guards above already ran, and creditWallet keys the ledger row on this same refId).
    const credited = await db.prepare(
      'SELECT 1 FROM wallet_transactions WHERE stripe_session_id = ? LIMIT 1'
    ).bind(refId).first();
    if (credited) return new Response('Already processed', { status: 200 });
  }

  // Per-agent wallet (spec §7): the cash funds THIS agent's own wallet. Resolve the owner to stamp the
  // topup row's owner_id (reconciliation/directory) and for owner-level card save.
  const ownerId = await ownerIdForAgent(db, agentId);
  if (!ownerId) {
    return new Response('Owner not found', { status: 404 });
  }
  await db.prepare("UPDATE wallet_topup_sessions SET owner_id = ? WHERE id = ?").bind(ownerId, refId).run();

  // Credit = plan credit (annual/6-month land a bigger wallet than paid) or the paid amount for a custom
  // top-up. Fiat has no crypto bonus, so custom credits exactly what was paid.
  const creditCents = creditForTopup(plan, amountCents, 'fiat');
  const { balance_cents } = await creditWallet(db, agentId, creditCents, 'topup_stripe', {
    description: `Stripe wallet topup — paid $${(amountCents / 100).toFixed(2)}, credited $${(creditCents / 100).toFixed(2)}${plan !== 'custom' ? ` (${plan} plan)` : ''}`,
    stripeSessionId: refId,
    mailer: mailerFromEnv(env), // (5n c) email the referrer if this top-up pays a referral credit
  });

  // Arm THIS agent (continuous_pending) + mint its pull_token — cash is pooled, activation is per-agent.
  await markAgentPendingOnTopup(db, agentId);
  await activateReferral(db, agentId);
  const firstPayment = await recordFirstPaymentTrust(db, ownerId);
  if (cardSave) await saveCardForAutotopup(db, env, ownerId, cardSave);

  // Receipt email (best-effort). When the top-up newly ARMED continuous testing, the receipt is
  // also the setup handoff (Ant 2026-07-08 — never leave the customer wondering why nothing is
  // probing): continuous is agent-PULL, so the email carries the exact prompt to paste to the
  // agent / add to its schedule. Same prompt lives in Owner Controls on the report.
  if (env.RESEND_API_KEY) {
    const a = await db.prepare('SELECT handle, display_name, email FROM agents WHERE agent_id = ?').bind(agentId).first() as any;
    if (a?.email) {
      // 'receipt' template (admin-edited prose; amounts substituted via the sample literals). NO setup
      // prompt in receipts (Ant 2026-07-10 — receipts say what you paid, full stop; setup lives in the
      // welcome email + Owner Controls). A code-owned runway line is appended instead.
      const { sendTemplateEmail, escHtml } = await import('../../lib/email-template-loader');
      let setupBlock: string[] = [];
      try {
        const { perChallengeCents, FOUNDER_PRICE_CENTS, BASE_PROBES_PER_DAY } = await import('../../lib/pricing');
        const dials = await db.prepare('SELECT locked_rate_cents, probes_per_day FROM agents WHERE agent_id = ?').bind(agentId).first() as any;
        const burn = perChallengeCents(dials?.locked_rate_cents ?? FOUNDER_PRICE_CENTS) * Math.max(1, dials?.probes_per_day ?? BASE_PROBES_PER_DAY);
        const days = burn > 0 ? Math.floor(balance_cents / burn) : 0;
        if (days > 0) setupBlock = [`That covers about <strong>${days} day${days === 1 ? '' : 's'}</strong> of verification at your agent's current pace.`];
      } catch { /* runway line is a nicety — the receipt must send without it */ }
      const agentLabel = escHtml(a.display_name || a.handle || 'your agent');
      await sendTemplateEmail(db, mailerFromEnv(env), 'receipt', {
        to: a.email,
        // Both {{TOKEN}} (new default) and the old sample-literal keys are passed so the receipt
        // renders correctly whether the live email_templates row is the new token body or the old
        // literal one — deploy-order-independent (single-pass render makes the extra keys harmless).
        vars: {
          '{{AGENT}}': agentLabel, Atlas: agentLabel,
          '{{CREDIT}}': `$${(creditCents / 100).toFixed(2)}`, '$10.00': `$${(creditCents / 100).toFixed(2)}`,
          '{{BALANCE}}': `$${(balance_cents / 100).toFixed(2)}`, '$25.00': `$${(balance_cents / 100).toFixed(2)}`,
        },
        appendBodyHtml: setupBlock,
        ctaUrl: `https://verigent.ai/agent/${a.handle || agentId}`,
      }).catch(() => {});

      // FIRST payment ever for this owner → the 'welcome' club email (admin-edited template),
      // exactly once (recordFirstPaymentTrust's atomic claim is the once-per-owner guard).
      if (firstPayment) {
        await sendTemplateEmail(db, mailerFromEnv(env), 'welcome', {
          to: a.email,
          vars: { Atlas: agentLabel },
          ctaUrl: `https://verigent.ai/agent/${a.handle || agentId}`,
        }).catch(() => {});
      }
    }
  }

  return new Response('OK', { status: 200 });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await request.text();

  // Verify the Stripe signature on the RAW body before trusting anything in it.
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return new Response('Webhook not configured', { status: 503 });
  }
  if (!(await verifyStripeSignature(body, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET))) {
    return new Response('Invalid signature', { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const db = env.DB;

  // checkout.session.completed — embedded Checkout (topup.ts). Behaviour unchanged from before the
  // refactor: same fields, same guards, same credit core (now in applyTopupCredit).
  if (event.type === 'checkout.session.completed') {
    const session = event.data?.object;
    if (!session?.metadata?.type || session.metadata.type !== 'wallet_topup') {
      return new Response('OK', { status: 200 });
    }
    return applyTopupCredit(db, env, {
      agentId: session.metadata.agent_id,
      claimedCents: parseInt(session.metadata.amount_cents) || 0,
      plan: session.metadata.plan || 'custom',
      refId: session.id,
      capturedCents: typeof session.amount_total === 'number' ? session.amount_total : null,
      // original guard: reject only when payment_status is present AND not 'paid'.
      paidOk: !session.payment_status || session.payment_status === 'paid',
      cardSave: session.customer ? {
        customerId: typeof session.customer === 'string' ? session.customer : session.customer?.id,
        piId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id,
      } : null,
    });
  }

  // payment_intent.succeeded — Stripe Elements (create-payment-intent.ts). Same credit core; PI fields:
  // authoritative amount = amount_received, paid = status 'succeeded', row keyed by pi.id (create-PI
  // wrote it). Card-save fires only when the PI carried the save-card opt-in (customer + metadata).
  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data?.object;
    if (!pi?.metadata?.type || pi.metadata.type !== 'wallet_topup') {
      return new Response('OK', { status: 200 });
    }
    return applyTopupCredit(db, env, {
      agentId: pi.metadata.agent_id,
      claimedCents: parseInt(pi.metadata.amount_cents) || 0,
      plan: pi.metadata.plan || 'custom',
      refId: pi.id,
      capturedCents: typeof pi.amount_received === 'number' ? pi.amount_received : null,
      paidOk: pi.status === 'succeeded',
      cardSave: pi.metadata?.save_card === '1' && pi.customer
        ? { customerId: typeof pi.customer === 'string' ? pi.customer : pi.customer?.id, piId: pi.id }
        : null,
    });
  }

  return new Response('OK', { status: 200 });
};
