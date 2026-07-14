// POST /api/wallet/scan-sol-topup — body { handle }
//
// The SIMPLE Solana top-up path (Ant 2026-07-10, supersedes the quote+txid flow): the owner sends
// ANY amount of SOL to the Verigent wallet with their AGENT HANDLE as the memo — nothing else. The
// top-up card polls this endpoint, which scans recent transactions to our receiving address for a
// memo matching the handle, verifies each candidate on-chain, and credits the received amount at the
// live SOL/USD rate ×(1+SOL_DISCOUNT). "Send to the address, memo = handle, done" — Bitcoin-simple.
//
// Money-path guards (§5.4 — the memo is attacker-controllable on-chain text):
//   · memo must EQUAL the handle (case-insensitive) or be a legacy vg:<handle>:… quote memo — never
//     a substring match, so one agent's memo can't be confused for another's.
//   · a "payment" binding someone ELSE's handle just gifts that agent credit — no attack value.
//   · double-credit: used_txids first-writer claim (claimTxid) + the wallet_transactions unique
//     label index inside creditWallet — a txid credits exactly once, ever.
//   · verification is by BALANCE DELTA on our address from the fetched transaction (never the memo's
//     word for the amount), failed txs (meta.err) skipped — same semantics as the audited scoreSolTx.
//   · unauthenticated by design, like check-payment: on-chain SOL to our address IS the proof, and
//     the response never contains credentials (CX2).
//
// Cheap polling: getSignaturesForAddress already returns each signature's memo, so non-matching
// transactions cost nothing — only memo-matched candidates get a full getTransaction verify.

import { PAYMENT_CONFIG, claimTxid } from '../../lib/sovereignty-tests';
import { mailerFromEnv } from '../../lib/email-send';
import { creditWallet, markAgentPendingOnTopup, activateReferral, recordFirstPaymentTrust } from '../../lib/wallet';
import { creditForTopup, SOL_DISCOUNT } from '../../lib/pricing';
import { fetchSolUsdRate } from '../../lib/lightning';
import { verifyOwnerSession, getOwnerTokenFromCookie } from '../../lib/owner-auth';
// @ts-ignore — extensionless JS sibling (resolved by the Pages/Workers bundler at runtime)
import { paymentsEnabledDb } from '../../lib/payments-flag.js';

// A pasted memo-less txid may only be claimed within this window (Codex CRIT, 2026-07-10): an old
// deposit can't be hoarded and cashed in at a later, more favourable SOL/USD rate, and the front-run
// window against a legitimate payer is bounded.
const PASTED_TX_MAX_AGE_SEC = 2 * 3600;

interface Env {
  DB: D1Database;
  SOL_RPC_URL?: string;         // Workers-reachable Solana RPC (mainnet-beta 403-blocks Workers)
  PAYMENTS_ENABLED?: string;
  OWNER_AUTH_SECRET?: string;
  RESEND_API_KEY?: string;
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

// Signature-list memos read "[21] vg:bishop-0A:…" — strip the length prefix before matching.
function memoText(raw: unknown): string {
  const s = String(raw ?? '');
  return s.replace(/^\[\d+\]\s*/, '').trim();
}

function memoMatchesHandle(memo: string, handle: string): boolean {
  const m = memo.toLowerCase();
  const h = handle.toLowerCase();
  // Exact handle (the advertised memo), or a legacy quote memo (vg:<handle>:<label> / vg:<handle>).
  return m === h || m === `vg:${h}` || m.startsWith(`vg:${h}:`);
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
  const handle = String(body?.handle || '').trim();
  // Optional txid (Ant 2026-07-10, the Coinbase discovery): exchanges show a "note"/"memo" field in
  // their UI but DON'T write it on-chain (Coinbase receipt said Note: bishop-0A; the transaction
  // carried no memo instruction). For those payments the payer pastes the transaction hash from
  // their receipt instead. Guard: if the pasted tx DOES carry a memo, it must match THIS handle —
  // you can't claim a payment that names someone else's agent. Memo-less txs are first-claim
  // (claimTxid) — the payer holds the hash instantly, long before any observer.
  const claimTx = String(body?.txid || '').trim();
  if (!handle) return Response.json({ error: 'handle required' }, { status: 400, headers });

  const db = env.DB;
  const agent = await db.prepare(
    'SELECT agent_id, handle, owner_id FROM agents WHERE LOWER(handle) = LOWER(?) OR agent_id = ?'
  ).bind(handle, handle).first() as any;
  if (!agent) return Response.json({ error: 'Agent not found' }, { status: 404, headers });

  // THEFT GUARD (Codex CRIT, 2026-07-10): a memo-less on-chain deposit has NO binding to any account,
  // so a pasted txid is otherwise a bearer token — anyone watching our public address could front-run
  // a stranger's deposit and claim it to their own agent. The memo-scan path is safe (the memo binds
  // it); the txid-paste path is NOT, so it requires the authenticated OWNER of the target agent. This
  // costs legit users nothing — they paste from inside their own signed-in Owner Controls drawer.
  if (claimTx) {
    const ownerId = await verifyOwnerSession(getOwnerTokenFromCookie(request.headers.get('Cookie')), env.OWNER_AUTH_SECRET);
    if (!ownerId || ownerId !== agent.owner_id) {
      return Response.json({ error: 'Sign in as this agent’s owner to claim a payment by transaction hash' }, { status: 401, headers });
    }
  }

  const endpoint = env.SOL_RPC_URL || PAYMENT_CONFIG.sol.rpcEndpoint;
  const address = PAYMENT_CONFIG.sol.receivingAddress;

  // Live rate first — if we can't price SOL we must not credit at a stale/garbage rate. Sanity-bound
  // it (Codex HIGH): a compromised/garbage price source that returned an absurd number is a direct
  // credit-minting boundary, so reject anything outside a plausible SOL/USD envelope.
  let solUsd: number;
  try { solUsd = await fetchSolUsdRate(); } catch {
    return Response.json({ ok: false, error: 'SOL rate unavailable — try again shortly' }, { status: 503, headers });
  }
  if (!Number.isFinite(solUsd) || solUsd < 1 || solUsd > 100_000) {
    return Response.json({ ok: false, error: 'SOL rate looks wrong — not crediting; try again shortly' }, { status: 503, headers });
  }

  let candidates: Array<{ signature: string; fromUser?: boolean }> = [];
  if (claimTx) {
    candidates = [{ signature: claimTx, fromUser: true }];
  } else {
    let sigs: any[] = [];
    try {
      const r = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSignaturesForAddress', params: [address, { limit: 20 }] }),
      });
      if (!r.ok) throw new Error(`RPC HTTP ${r.status}`);
      sigs = ((await r.json()) as any)?.result || [];
    } catch (e: any) {
      console.error('sol scan RPC failed:', e?.message || e);
      return Response.json({ ok: false, error: "Couldn't reach the Solana network — try again shortly" }, { status: 502, headers });
    }

    // Candidates: succeeded, recent (48h — a scan is a live-card poll, not an archaeology tool), and
    // memo-bound to THIS handle. Everything else is skipped without another RPC call.
    const nowSec = Math.floor(Date.now() / 1000);
    candidates = sigs.filter((s) =>
      !s.err &&
      (typeof s.blockTime !== 'number' || nowSec - s.blockTime < 48 * 3600) &&
      memoMatchesHandle(memoText(s.memo), agent.handle || handle)
    );
  }

  let creditedCents = 0;
  let paidCentsTotal = 0;
  let receivedLamportsTotal = 0;
  let balanceCents: number | null = null;
  let pending = false;   // a memo-less pasted txid landed for manual review (not credited)
  for (const s of candidates) {
    const txid = s.signature as string;

    // Ledger pre-check — a txid already credited is skipped OUTRIGHT (idempotency + accurate response).
    const seen = await db.prepare(
      "SELECT 1 FROM wallet_transactions WHERE lightning_label = ? LIMIT 1"
    ).bind(`soltx-${txid}`).first();
    if (seen) continue;

    // Fetch the tx first to decide the route: whether it carries a memo binding it to this agent.
    let received = 0;
    let memoBound = false;   // memo present AND names this agent → provably ours → instant credit
    let sender: string | null = null;
    try {
      const r = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [txid, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }] }),
      });
      const tx = ((await r.json()) as any)?.result;
      if (!tx || tx.meta?.err != null) continue;
      const keys: string[] = (tx.transaction?.message?.accountKeys || []).map((k: any) => (typeof k === 'string' ? k : k?.pubkey));
      const idx = keys.indexOf(address);
      received = idx >= 0 ? Number(tx.meta?.postBalances?.[idx] ?? 0) - Number(tx.meta?.preBalances?.[idx] ?? 0) : 0;
      sender = keys[0] ?? null;   // fee payer / source — shown to the admin reviewer
      const ix = (tx.transaction?.message?.instructions || []).find((i: any) =>
        i.program === 'spl-memo' || i.programId === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
      const memo = ix?.parsed ?? ix?.data;
      const hasMemo = memo != null && String(memo).trim() !== '';
      if (hasMemo && !memoMatchesHandle(String(memo).trim(), agent.handle || handle)) continue; // someone else's memo
      memoBound = hasMemo;
      // A pasted (fromUser) txid is age-bounded (Codex): no hoarding an old cheap-rate deposit.
      if (s.fromUser) {
        const age = Math.floor(Date.now() / 1000) - Number(tx.blockTime ?? 0);
        if (!tx.blockTime || age < 0 || age > PASTED_TX_MAX_AGE_SEC) {
          return Response.json({ ok: false, error: 'That transaction is too old to claim here — contact support to reconcile it' }, { status: 400, headers });
        }
      }
    } catch { continue; }
    if (received < PAYMENT_CONFIG.sol.minLamports) continue;

    // THEFT GUARD (Codex CRIT, Ant ruling 2026-07-10): a MEMO-LESS pasted txid can't be proven to
    // belong to the claimant — crediting it instantly is a cross-owner theft primitive. So it goes to
    // MANUAL REVIEW (pending_sol_claims), NOT instant credit. Only a memo-BOUND payment (the memo
    // proves attribution) credits instantly. The auto memo-scan path (not fromUser) is always
    // memo-bound by construction, so it's unaffected.
    if (s.fromUser && !memoBound) {
      await db.prepare(
        `INSERT INTO pending_sol_claims (txid, owner_id, agent_id, handle, received_lamports, sender, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending') ON CONFLICT(txid) DO NOTHING`
      ).bind(txid, agent.owner_id, agent.agent_id, agent.handle || handle, received, sender).run();
      pending = true;
      continue;
    }

    // First-writer txid claim — atomic dedup — only on the instant-credit (memo-bound) path.
    const claim = await claimTxid(db, txid, `topup:${agent.agent_id}`, 'sol');
    if (!claim.ok) continue;

    const paidCents = Math.round((received / 1e9) * solUsd * 100);
    if (paidCents <= 0) continue;
    const creditCents = creditForTopup('custom', paidCents, 'sol');
    const { balance_cents } = await creditWallet(db, agent.agent_id, creditCents, 'topup_sol', {
      description: `Solana topup - paid $${(paidCents / 100).toFixed(2)}, credited $${(creditCents / 100).toFixed(2)} (${Math.round(SOL_DISCOUNT * 100)}% SOL bonus)`,
      lightningLabel: `soltx-${txid}`,   // ledger idempotency (unique index) — second guard after claimTxid
    });
    creditedCents += creditCents;
    paidCentsTotal += paidCents;
    receivedLamportsTotal += received;
    balanceCents = balance_cents;
  }

  if (creditedCents > 0) {
    // Full payment-confirmation suite — SAME as the Lightning/card rails (gap closed 2026-07-10:
    // this path previously armed the agent but never activated a referral, never recorded the
    // first payment, and never sent a receipt).
    // Best-effort as ONE block (Codex HIGH, 2026-07-10): the credit is already committed, and the
    // ledger pre-check skips this txid on every future scan — so a throw here must not 500 the
    // poll; the payer needs the truthful credited response below, not an error after money moved.
    try {
    await markAgentPendingOnTopup(db, agent.agent_id);
    await activateReferral(db, agent.agent_id);
    const firstPayment = await recordFirstPaymentTrust(db, agent.owner_id);

    if (env.RESEND_API_KEY) {
      const a = await db.prepare('SELECT handle, display_name, email FROM agents WHERE agent_id = ?').bind(agent.agent_id).first() as any;
      if (a?.email) {
        const { sendTemplateEmail, escHtml } = await import('../../lib/email-template-loader');
        const { sendRailReceipt } = await import('../../lib/receipt-email');
        const rawLabel = a.display_name || a.handle || 'your agent';
        const agentLabel = escHtml(rawLabel); // template-loader vars stay caller-escaped
        await sendRailReceipt(db, mailerFromEnv(env), {
          to: a.email,
          rail: 'sol',
          agentId: agent.agent_id,
          agentLabel: rawLabel, // sendRailReceipt escapes internally (2026-07-10)
          handle: a.handle || handle,
          paidCents: paidCentsTotal,
          creditCents: creditedCents,
          balanceCents: balanceCents ?? 0,
          nativeAmount: `${(receivedLamportsTotal / 1e9).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')} SOL`,
          bonusPct: Math.round(SOL_DISCOUNT * 100),
        });
        if (firstPayment) {
          await sendTemplateEmail(db, mailerFromEnv(env), 'welcome', {
            to: a.email,
            vars: { Atlas: agentLabel },
            ctaUrl: `https://verigent.ai/agent/${encodeURIComponent(a.handle || agent.agent_id)}`,
          }).catch(() => {});
        }
      }
    }
    } catch (e) {
      const { scrubUrls } = await import('../../lib/log-scrub');
      console.error('scan-sol-topup post-credit side-effects failed (credit landed):', scrubUrls(e));
    }
  }

  return Response.json({
    ok: true,
    credited_cents: creditedCents,
    credited_usd: (creditedCents / 100).toFixed(2),
    // A memo-less pasted payment is now queued for manual review, not credited (Ant 2026-07-10).
    pending_review: pending && creditedCents === 0,
    ...(balanceCents != null ? { balance_cents: balanceCents, balance_usd: (balanceCents / 100).toFixed(2) } : {}),
    sol_usd: Math.round(solUsd * 100) / 100,
    address,
    memo: agent.handle || handle,
  }, { headers });
};
