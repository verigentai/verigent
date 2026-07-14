// POST /api/wallet/check-sol-payment — body { label, txid }
//
// The Solana top-up settle path. The owner sends SOL to the Verigent wallet WITH the quote's memo
// (vg:<handle>:<label>), then submits their txid here. We verify on-chain reusing the AUDITED
// verifySolPayment (memo binding + funds to our address + failed-tx guard), confirm the received
// amount covers the quote, guard cross-quote replay (claimTxid), atomically claim the quote, and
// credit the wallet ×1.08. Mirrors check-payment.ts (Lightning): ledger-first, credit exactly once,
// never returns credentials to this unauthenticated poll (Codex CX2). Payment proves itself, so —
// like the Lightning poll — no owner-auth is required: the on-chain SOL to our address is the proof.

import { verifySolPayment, claimTxid } from '../../lib/sovereignty-tests';
import { creditWallet, markAgentPendingOnTopup } from '../../lib/wallet';
import { creditForTopup, SOL_DISCOUNT } from '../../lib/pricing';
// @ts-ignore — extensionless JS sibling (resolved by the Pages/Workers bundler at runtime)
import { paymentsEnabledDb } from '../../lib/payments-flag.js';

interface Env {
  DB: D1Database;
  SOL_RPC_URL?: string;         // Workers-reachable Solana RPC (mainnet-beta 403-blocks Workers)
  PAYMENTS_ENABLED?: string;
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

// Has THIS quote already been credited? Trust the LEDGER, not the flag (Codex H1) — only 'already
// credited' if a matching wallet_transactions row exists.
async function alreadyCredited(db: D1Database, agentId: string, label: string): Promise<boolean> {
  const row = await db.prepare(
    "SELECT 1 FROM wallet_transactions WHERE agent_id = ? AND type = 'topup_sol' AND lightning_label = ? LIMIT 1"
  ).bind(agentId, label).first();
  return !!row;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const headers = { 'Content-Type': 'application/json', ...CORS };

  if (!(await paymentsEnabledDb(env, env.DB))) {
    return Response.json({ error: 'Payments are not live yet', code: 'payments_disabled' }, { status: 503, headers });
  }

  let body: any;
  try { body = await request.json(); } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400, headers });
  }
  const label = String(body?.label || '').trim();
  const txid = String(body?.txid || '').trim();
  if (!label || !txid) {
    return Response.json({ error: 'label and txid required' }, { status: 400, headers });
  }

  const db = env.DB;
  const s = await db.prepare(
    'SELECT label, agent_id, owner_id, amount_cents, amount_lamports, memo, status FROM sol_topups WHERE label = ?'
  ).bind(label).first() as any;
  if (!s) return Response.json({ error: 'Top-up quote not found' }, { status: 404, headers });

  if (s.status === 'paid' && await alreadyCredited(db, s.agent_id, label)) {
    return Response.json({ ok: true, status: 'paid', already_credited: true }, { headers });
  }

  // Verify on-chain (memo binding + funds to the Verigent wallet). retryable = settlement lag (RPC
  // hasn't indexed the tx yet) → tell the client to poll again rather than fail.
  const result = await verifySolPayment(s.memo, txid, env.SOL_RPC_URL);
  if (!result.verified) {
    return Response.json({ ok: true, status: result.retryable ? 'pending' : 'failed', reason: result.reason }, { headers });
  }

  // The audited verifier only enforces the tiny sovereignty floor (minLamports). For a TOP-UP the
  // received amount must cover the QUOTE. Underpayment is not credited (the quote stays open to retry
  // with a correct payment).
  if ((result.amount_lamports ?? 0) < s.amount_lamports) {
    return Response.json({
      ok: false, status: 'insufficient_amount',
      received_lamports: result.amount_lamports ?? 0, needed_lamports: s.amount_lamports,
    }, { status: 400, headers });
  }

  // Replay guard — bind this txid to this quote; a txid already used for a different quote is rejected.
  const claim = await claimTxid(db, txid, label, 'sol');
  if (!claim.ok) {
    return Response.json({ ok: false, status: 'failed', reason: claim.reason }, { status: 409, headers });
  }

  // Atomic quote claim — only the FIRST caller flips it to paid and proceeds to credit.
  const flip = await db.prepare(
    "UPDATE sol_topups SET status = 'paid', txid = ?, paid_at = datetime('now') WHERE label = ? AND status != 'paid'"
  ).bind(txid, label).run();
  if (((flip.meta as any)?.changes ?? 0) === 0) {
    if (await alreadyCredited(db, s.agent_id, label)) {
      return Response.json({ ok: true, status: 'paid', already_credited: true }, { headers });
    }
    // flag was 'paid' but no ledger row (crash between claim and credit) → fall through and credit.
  }

  const creditCents = creditForTopup('custom', s.amount_cents, 'sol');
  const { balance_cents } = await creditWallet(db, s.agent_id, creditCents, 'topup_sol', {
    description: `Solana topup — paid $${(s.amount_cents / 100).toFixed(2)}, credited $${(creditCents / 100).toFixed(2)} (${Math.round(SOL_DISCOUNT * 100)}% SOL bonus)`,
    lightningLabel: label,   // reused as the generic topup-label idempotency key in the ledger
  });

  // Re-arm continuous + open the provisional-Current window (same as Lightning/card top-ups).
  const activation = await markAgentPendingOnTopup(db, s.agent_id);

  return Response.json({
    ok: true,
    status: 'paid',
    balance_cents,
    balance_usd: (balance_cents / 100).toFixed(2),
    ...(activation ? { continuous_pending: activation.pending } : {}),
  }, { headers });
};
