// POST /api/wallet/create-payment-intent — Create a Stripe PaymentIntent for a card wallet top-up,
// for the DARK Stripe Elements <PaymentElement> in the owner drawer (Ant 2026-07-04). Replaces the
// embedded-Checkout path for the drawer; Lightning/Solana stay on /api/wallet/topup, and /keep-current
// keeps embedded Checkout.
//
// Amount + plan + owner resolution MIRROR /api/wallet/topup exactly (one pricing source). The PI carries
// the SAME metadata the webhook credits on (type/agent_id/owner_id/amount_cents/plan), and we create the
// wallet_topup_sessions row here with id = PI id so the webhook's atomic idempotency claim works.
//
// CARD-SAVE OPT-IN (Ant 2026-07-13, supersedes the 2026-07-04 "dropped" strip for the OPT-IN case
// only): when the payer ticks "keep this card for automatic top-ups", `save_card: true` rides in
// and the PI gains a customer + setup_future_usage=off_session — the exact plumbing the strip
// removed, now behind the payer's own explicit tick. Untucked, the PI is byte-identical to the
// stripped minimal form: no customer, no mandate text, auto-topup stays dormant. The saved card
// anchors to the OWNER row (the email identity); the agent handle resolves to it.

import { ownerIdForAgent } from '../../lib/wallet';
import { getTopupPlan, minTopupUsd, MAX_TOPUP_USD, type PayRail } from '../../lib/pricing';
import { verifyOwnerSession, getOwnerTokenFromCookie } from '../../lib/owner-auth';
import { scrubUrls } from '../../lib/log-scrub';
// @ts-ignore — extensionless JS sibling (resolved by the Pages/Workers bundler at runtime)
import { paymentsEnabledDb } from '../../lib/payments-flag.js';

interface Env {
  DB: D1Database;
  STRIPE_SECRET_KEY?: string;
  OWNER_AUTH_SECRET?: string;   // owner-session verify — gates whether we may read/return the owner email
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const headers = { 'Content-Type': 'application/json', ...CORS };

  // MASTER SWITCH: billing stays dark until PAYMENTS_ENABLED=true (same gate as topup.ts).
  if (!(await paymentsEnabledDb(env, env.DB))) {
    return Response.json({ error: 'Payments are not live yet', code: 'payments_disabled' }, { status: 503, headers });
  }

  let body: any;
  try { body = await request.json(); } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400, headers });
  }

  const { handle, agent_id, amount_usd, plan, save_card } = body;
  if (!handle && !agent_id) {
    return Response.json({ error: 'handle or agent_id required' }, { status: 400, headers });
  }

  // Card rail only for Elements. Amount resolution is identical to topup.ts: a named plan fixes the
  // price; otherwise it's a custom amount with the per-rail minimum.
  const rail: PayRail = 'fiat';
  let payCents: number;
  let planKey: string;
  const planDef = plan ? getTopupPlan(plan) : null;
  if (planDef) {
    payCents = planDef.payCents;
    planKey = planDef.key;
  } else {
    const minUsd = minTopupUsd(rail);
    const amt = typeof amount_usd === 'number' ? amount_usd : Number(amount_usd);
    if (!Number.isFinite(amt) || amt < minUsd || amt > MAX_TOPUP_USD) {
      return Response.json({ error: `amount_usd must be a number between ${minUsd} and ${MAX_TOPUP_USD} for this method` }, { status: 400, headers });
    }
    payCents = Math.round(amt * 100);
    planKey = 'custom';
  }
  const amountUsd = payCents / 100;

  const db = env.DB;
  const agent = handle
    ? await db.prepare('SELECT agent_id, handle, display_name FROM agents WHERE LOWER(handle) = LOWER(?)').bind(handle).first() as any
    : await db.prepare('SELECT agent_id, handle, display_name FROM agents WHERE agent_id = ?').bind(agent_id).first() as any;
  if (!agent) {
    return Response.json({ error: 'Agent not found. Take the free test first.' }, { status: 404, headers });
  }

  // Owner pool that gets credited (one wallet funds all of an owner's agents).
  const ownerId = await ownerIdForAgent(db, agent.agent_id);
  // The owner email is fetched ONLY to pre-fill the payer's email + set receipt_email. This endpoint is
  // otherwise unauthenticated (anyone can POST a public handle), so reading/returning the email would
  // leak an owner's address to any caller (Codex H3). Gate it: only when the caller is the AUTHENTICATED
  // owner of this owner_id. Everyone else gets ownerRow=null → no email in the response or on Stripe.
  const authedOwnerId = await verifyOwnerSession(getOwnerTokenFromCookie(request.headers.get('Cookie')), env.OWNER_AUTH_SECRET);
  const ownerRow = ownerId && authedOwnerId === ownerId
    ? await db.prepare('SELECT email FROM owners WHERE owner_id = ?').bind(ownerId).first() as any
    : null;

  if (!env.STRIPE_SECRET_KEY) {
    return Response.json({ error: 'Stripe payments not configured' }, { status: 503, headers });
  }

  try {
    const p = new URLSearchParams();
    p.set('amount', payCents.toString());
    p.set('currency', 'usd');
    p.set('payment_method_types[0]', 'card');
    // Same metadata keys the credit path reads (webhook: payment_intent.succeeded → applyTopupCredit).
    p.set('metadata[type]', 'wallet_topup');
    p.set('metadata[agent_id]', agent.agent_id);
    if (ownerId) p.set('metadata[owner_id]', ownerId);
    p.set('metadata[amount_cents]', payCents.toString());
    p.set('metadata[plan]', planKey);
    p.set('description', `Verigent wallet top-up — ${agent.handle || agent.display_name || agent.agent_id}`);
    if (ownerRow?.email) p.set('receipt_email', ownerRow.email);

    // Save-card opt-in: attach a customer (reuse the owner's if one exists — repeat savers keep one
    // customer object) + setup_future_usage so the confirmed payment_method is reusable off-session.
    // The customer id is NOT persisted here — only a COMPLETED payment saves the card (webhook /
    // confirm-autotopup), so an abandoned form leaves no trace on the owner row.
    if (save_card === true && ownerId) {
      let customerId: string | null = null;
      const existing = await db.prepare('SELECT stripe_customer_id FROM owners WHERE owner_id = ?').bind(ownerId).first() as any;
      if (existing?.stripe_customer_id) customerId = existing.stripe_customer_id;
      if (!customerId) {
        const cp = new URLSearchParams();
        cp.set('metadata[owner_id]', ownerId);
        if (ownerRow?.email) cp.set('email', ownerRow.email);
        const cRes = await fetch('https://api.stripe.com/v1/customers', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: cp.toString(),
        });
        if (cRes.ok) customerId = ((await cRes.json()) as any)?.id || null;
      }
      if (customerId) {
        p.set('customer', customerId);
        p.set('setup_future_usage', 'off_session');
        p.set('metadata[save_card]', '1');
      }
      // Customer creation failing is non-fatal: the payment proceeds as a plain (unsaved) top-up.
    }

    const stripeRes = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: p.toString(),
    });
    if (!stripeRes.ok) {
      const errBody = await stripeRes.text();
      throw new Error(`Stripe returned ${stripeRes.status}: ${errBody}`);
    }
    const pi = await stripeRes.json() as any;

    // Row keyed by PI id — the webhook's atomic idempotency claim flips this to 'paid' exactly once.
    await db.prepare(
      `INSERT INTO wallet_topup_sessions (id, agent_id, owner_id, amount_cents, plan, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`
    ).bind(pi.id, agent.agent_id, ownerId, payCents, planKey).run();

    return Response.json({
      ok: true,
      client_secret: pi.client_secret,
      payment_intent_id: pi.id,
      amount_usd: amountUsd,
      plan: planKey,
      owner_email: ownerRow?.email || null, // client pre-fills billing_details.email
    }, { headers });
  } catch (err: any) {
    // Don't leak internal/Stripe error detail to an unauthenticated caller (Codex LOW, same scrub
    // as the other rails).
    console.error('create-payment-intent failed:', scrubUrls(err));
    return Response.json({ error: 'Payment setup failed' }, { status: 500, headers });
  }
};
