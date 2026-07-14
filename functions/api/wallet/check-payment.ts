// GET /api/wallet/check-payment?label=verigent-topup-xxx
// Polls Lightning invoice status for wallet topups. Credits wallet on payment.

import { checkInvoiceStatus, fetchBtcUsdRate } from '../../lib/lightning';
import { mailerFromEnv } from '../../lib/email-send';
import { creditWallet, activateReferral, recordFirstPaymentTrust, ownerIdForAgent, markAgentPendingOnTopup } from '../../lib/wallet';
import { creditForTopup, LIGHTNING_DISCOUNT } from '../../lib/pricing';
import { sendNotificationEmail } from '../../lib/email';
import { scrubUrls } from '../../lib/log-scrub';

interface Env {
  DB: D1Database;
  CLN_API_URL: string;
  CLN_RUNE: string;
  RESEND_API_KEY?: string;
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const headers = { 'Content-Type': 'application/json', ...CORS };
  const url = new URL(request.url);
  const label = url.searchParams.get('label');

  if (!label || !label.startsWith('verigent-topup-')) {
    return Response.json({ error: 'Valid topup label required' }, { status: 400, headers });
  }

  if (!env.CLN_API_URL || !env.CLN_RUNE) {
    return Response.json({ error: 'Lightning unavailable' }, { status: 503, headers });
  }

  const db = env.DB;
  const session = await db.prepare(
    'SELECT agent_id, amount_cents, plan, status FROM wallet_topup_sessions WHERE id = ?'
  ).bind(label).first() as any;

  if (!session) {
    return Response.json({ error: 'Topup session not found' }, { status: 404, headers });
  }

  if (session.status === 'paid') {
    // Trust the LEDGER, not the flag (Codex H1): a crash after marking the session 'paid' but before
    // creditWallet would otherwise report already_credited forever with the money never credited. Only
    // short-circuit when a ledger row actually exists for this invoice; otherwise fall through and
    // (re-)credit below (creditWallet is idempotent on lightning_label via the v50 unique index).
    const credited = await db.prepare(
      'SELECT 1 FROM wallet_transactions WHERE lightning_label = ? LIMIT 1'
    ).bind(label).first();
    if (credited) return Response.json({ ok: true, status: 'paid', already_credited: true }, { headers });
  }

  try {
    const config = { apiUrl: env.CLN_API_URL, rune: env.CLN_RUNE };
    const invoiceStatus = await checkInvoiceStatus(config, label);

    if (invoiceStatus.status === 'paid') {
      // Atomic claim — only the first caller to flip this session to 'paid' proceeds to credit.
      // (The poll endpoint is a public, CORS-open GET, so it can be hit concurrently or spammed.)
      const claim = await db.prepare(
        "UPDATE wallet_topup_sessions SET status = 'paid', paid_at = datetime('now') WHERE id = ? AND status != 'paid'"
      ).bind(label).run();
      if (((claim.meta as any)?.changes ?? 0) === 0) {
        // Trust the LEDGER, not the flag (review 2026-07-09): if the row is 'paid' but no ledger row
        // exists for this invoice, a prior claim died before crediting — fall through and credit.
        const credited = await db.prepare(
          'SELECT 1 FROM wallet_transactions WHERE lightning_label = ? LIMIT 1'
        ).bind(label).first();
        if (credited) return Response.json({ ok: true, status: 'paid', already_credited: true }, { headers });
      }
      await db.prepare("UPDATE lightning_invoices SET status = 'paid', paid_at = datetime('now') WHERE label = ?").bind(label).run();

      // Per-agent wallet (spec §7): the cash funds THIS agent's own wallet. Resolve the owner too —
      // only to stamp the topup session's owner_id for the directory/audit, not to hold the money.
      const ownerId = await ownerIdForAgent(db, session.agent_id);
      if (!ownerId) {
        return Response.json({ error: 'Owner not found' }, { status: 404, headers });
      }
      await db.prepare("UPDATE wallet_topup_sessions SET owner_id = ? WHERE id = ?").bind(ownerId, label).run();

      // Credit = plan credit (with the Lightning +12% bonus stacked) or, for a custom amount,
      // paid × 1.12. Bounded by the atomic claim above + MAX_TOPUP, so retries can't amplify it.
      // AMOUNTLESS invoice (session.amount_cents = 0, Ant 2026-07-10): the payer chose the amount in
      // their own wallet — the authoritative figure is what the NODE says arrived
      // (amount_received_msat), valued at the live BTC rate. Never trust a client-supplied number.
      let paidCents = session.amount_cents;
      if (!paidCents) {
        const receivedMsat = invoiceStatus.amount_received_msat ?? 0;
        if (receivedMsat <= 0) {
          return Response.json({ error: 'Paid invoice reports no received amount — contact support' }, { status: 500, headers });
        }
        const rate = await fetchBtcUsdRate();
        // Sanity-bound the rate (Codex HIGH) — a garbage price source is a credit-minting boundary.
        if (!Number.isFinite(rate) || rate < 1_000 || rate > 100_000_000) {
          return Response.json({ error: 'BTC rate looks wrong — not crediting; try again shortly' }, { status: 503, headers });
        }
        paidCents = Math.round((receivedMsat / 100_000_000_000) * rate * 100);
        await db.prepare('UPDATE wallet_topup_sessions SET amount_cents = ? WHERE id = ?').bind(paidCents, label).run();
      }
      const creditCents = creditForTopup(session.plan, paidCents, 'lightning');
      const { balance_cents } = await creditWallet(db, session.agent_id, creditCents, 'topup_lightning', {
        description: `Lightning topup — paid $${(paidCents / 100).toFixed(2)}, credited $${(creditCents / 100).toFixed(2)} (${Math.round(LIGHTNING_DISCOUNT * 100)}% Lightning bonus)`,
        lightningLabel: label,
        mailer: mailerFromEnv(env), // (5n c) email the referrer if this top-up pays a referral credit
      });

      // Arm THIS agent (continuous_pending) + mint/return its pull_token — cash pooled, activation
      // per-agent. The agent polls this endpoint, so it receives its MCP-pull credential + setup
      // prompt directly in the confirmation response (the moment it's paid).
      // Best-effort as ONE block (code-review, 2026-07-10 — same armour as the Sol rails): the
      // credit is already committed; a throw below must not 500 the poll, because the retry hits
      // the already-credited early-return and these side-effects would never fire again.
      let activation: Awaited<ReturnType<typeof markAgentPendingOnTopup>> | null = null;
      try {
      activation = await markAgentPendingOnTopup(db, session.agent_id);
      await activateReferral(db, session.agent_id);
      const firstPayment = await recordFirstPaymentTrust(db, ownerId);

      // Receipt email (best-effort — never block the payment confirmation). Stripe-style rail receipt
      // (Ant 2026-07-10): logo'd payment-method row + money summary + runway, NO setup prompt —
      // setup lives in the welcome email and the Owner Controls drawer.
      if (env.RESEND_API_KEY) {
        const a = await db.prepare('SELECT handle, display_name, email FROM agents WHERE agent_id = ?').bind(session.agent_id).first() as any;
        if (a?.email) {
          const { sendTemplateEmail, escHtml } = await import('../../lib/email-template-loader');
          const { sendRailReceipt } = await import('../../lib/receipt-email');
          const rawLabel = a.display_name || a.handle || 'your agent';
          const agentLabel = escHtml(rawLabel); // template-loader vars stay caller-escaped
          const paidSats = Math.round((invoiceStatus.amount_received_msat ?? 0) / 1000);
          await sendRailReceipt(db, mailerFromEnv(env), {
            to: a.email,
            rail: 'lightning',
            agentId: session.agent_id,
            agentLabel: rawLabel, // sendRailReceipt escapes internally (2026-07-10)
            handle: a.handle || session.agent_id,
            paidCents,
            creditCents,
            balanceCents: balance_cents,
            nativeAmount: paidSats > 0 ? `${paidSats.toLocaleString('en-US')} sats` : 'Lightning payment',
            bonusPct: Math.round(LIGHTNING_DISCOUNT * 100),
          });

          // FIRST payment ever for this owner → the 'welcome' club email (admin-edited template),
          // exactly once (recordFirstPaymentTrust's atomic claim is the once-per-owner guard).
          if (firstPayment) {
            await sendTemplateEmail(db, mailerFromEnv(env), 'welcome', {
              to: a.email,
              vars: { Atlas: agentLabel },
              ctaUrl: `https://verigent.ai/agent/${encodeURIComponent(a.handle || session.agent_id)}`,
            }).catch(() => {});
          }
        }
      }
      } catch (e) {
        console.error('check-payment post-credit side-effects failed (credit landed):', scrubUrls(e));
      }

      return Response.json({
        ok: true,
        status: 'paid',
        // SECURITY (Codex 2026-07-10): the invoice `label` is NOT a secret — it's timestamp-shaped and
        // lives in the client, browser history and logs — so this UNAUTHENTICATED poll returns ONLY the
        // payment status. NO balance, NO pull_token, NO setup_prompt: a label-guesser must learn nothing
        // about the wallet. The client only needs 'paid' to flip the card; the freshly-paid owner reads
        // balance + setup through the owner-authenticated surface (/api/owner/me) and the welcome email.
        ...(activation ? { continuous_pending: activation.pending } : {}),
      }, { headers });
    }

    if (invoiceStatus.status === 'expired') {
      await db.prepare("UPDATE wallet_topup_sessions SET status = 'expired' WHERE id = ?").bind(label).run();
      await db.prepare("UPDATE lightning_invoices SET status = 'expired' WHERE label = ?").bind(label).run();
    }

    return Response.json({ ok: true, status: invoiceStatus.status }, { headers });
  } catch (err: any) {
    console.error('check-payment failed:', err?.message || err);
    return Response.json({ error: 'Could not check payment' }, { status: 500, headers });
  }
};
