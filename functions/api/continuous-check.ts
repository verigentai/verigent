// POST /api/continuous-check — cron (auth: X-Sweep-Secret header)
// Called by cron worker. HOUSEKEEPING sweep only since the per-challenge debit landed (Ant ruling
// 2026-07-08): billing moved to /api/probe/finish — every SCORED challenge debits the wallet at
// perChallengeCents the moment the verification work happens (bill-at-proof §2.8, truer than the
// old daily batch this endpoint used to run). What remains here: the cron heartbeat, the payments
// kill-switch gate, and free-window expiry (deactivate never-funded agents whose 72h/7d window
// lapsed). Referral payouts stay event-driven at top-up time (payReferralOnTopup in wallet.ts).

import { paymentsEnabledDb } from '../lib/payments-flag.js';

interface Env {
  DB: D1Database;
  SWEEP_SECRET?: string;
  STRIPE_SECRET_KEY?: string;
  PAYMENTS_ENABLED?: string;
  RESEND_API_KEY?: string;   // low-balance alert emails (crypto payers, autotopup.ts)
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
  const url = new URL(request.url);
  const secret = request.headers.get('X-Sweep-Secret');

  if (!env.SWEEP_SECRET || secret !== env.SWEEP_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
  }

  const db = env.DB;
  const { stampCronHeartbeat } = await import('../lib/cron-heartbeat');
  await stampCronHeartbeat(db, 'continuous-check'); // 5v-a heartbeat (before the master-switch gate)

  // Sim-clock (staging fleet exercise): free-window expiry + weekly stamping read sim-now when
  // the driver warps time. Heartbeat + auth above stay REAL.
  const { simNow, sqlNow } = await import('../lib/sim-clock');
  const now = await simNow(env as any, request);
  const nowSql = sqlNow(now);

  // MASTER SWITCH (5k blocker 1): the debit sweep MUST obey the payments kill-switch, exactly like
  // the top-up endpoints. It previously ignored it — so with payments OFF, top-ups stopped but
  // funded wallets kept draining on every cron. When payments are OFF (env flag unset OR the admin
  // D1 kill-switch), this sweep does NOTHING: no wallet debit, and no free-week deactivation either
  // (an agent can't be penalised for not funding when funding is disabled). paymentsEnabledDb fails
  // CLOSED — any settings-read error resolves to OFF, so a transient DB hiccup can't drain wallets.
  if (!(await paymentsEnabledDb(env, db))) {
    return Response.json(
      { ok: true, billing_disabled: true, billed: 0, note: 'Payments master switch OFF — no wallet debits or deactivations performed.' },
      { headers }
    );
  }

  // FREE-WEEK EXPIRY (Ant 2026-06-28): a referred agent whose free week has ended WITHOUT ever
  // funding the pool was running continuous on the house — deactivate it and start the lapse clock
  // (the price-lock grace timer). Funded agents are billed normally below; the conversion email is
  // decay-nudge's job. Bounded scan; runs daily so the backlog never grows.
  // Gate on the AGENT's own wallet (per-agent money since v32): owners.balance_cents is a retired,
  // permanently-zero field — gating on it deactivated FUNDED agents at free-week end (review 5kk #4).
  // Lapse clock stamps the agent row too, matching the re-price read side (5kk #3).
  let freeWeekEnded = 0;
  const expired = await db.prepare(`
    SELECT agent_id FROM agents
    WHERE continuous_active = 1 AND free_until IS NOT NULL
      AND free_until <= datetime(?) AND balance_cents <= 0
    LIMIT 100
  `).bind(nowSql).all();
  for (const a of (expired.results || []) as any[]) {
    await db.prepare(
      'UPDATE agents SET continuous_active = 0, lapsed_at = COALESCE(lapsed_at, ?) WHERE agent_id = ?'
    ).bind(nowSql, a.agent_id).run();
    freeWeekEnded++;
  }

  // The daily MEMBERSHIP debit that used to run here is GONE (Ant ruling 2026-07-08): billing is
  // per-challenge at /api/probe/finish now — debit, ledger row, cost_cents on continuous_checks,
  // drain-deactivation and auto top-up all happen at proof time.
  //
  // WEEKLY PUBLICATION STAMP (Ant review fix): probe/finish + view endpoints stamp the snapshot on
  // ACTIVITY, but an active agent whose scheduler goes quiet mid-week (or a baseline whose ops
  // driver stalls) and whose report nobody opens would develop a HOLE in the weekly-frozen record —
  // the exact agents the scheduler-health alert is about. The deleted sweep guaranteed a row for
  // every active agent daily; restore that here (idempotent, bounded, never throws off the sweep).
  let stamped = 0;
  const { ensureWeeklySnapshot } = await import('../lib/weekly');
  const active = await db.prepare(
    'SELECT agent_id FROM agents WHERE continuous_active = 1 OR is_public_baseline = 1 LIMIT 500'
  ).all();
  for (const a of (active.results || []) as any[]) {
    try { await ensureWeeklySnapshot(db, a.agent_id, now); stamped++; } catch (e) { console.error('weekly stamp failed:', e); }
  }

  return Response.json({
    ok: true,
    billing: 'per-challenge at probe/finish (2026-07-08) — this sweep is housekeeping only',
    freeWeekEnded,
    weekly_stamped: stamped,
  }, { headers });
};
