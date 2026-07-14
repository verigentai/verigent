// GET /api/sweep-expired — Cron-triggered sweep for expired runs
// Finds runs that expired without completing, emails the buyer, marks as notified
// Called by Cloudflare Cron Trigger or external scheduler

import { sendExpiredEmail, sendAdminNotificationEmail } from '../lib/email';
import { mailerFromEnv } from '../lib/email-send';
import { simNow, sqlNow } from '../lib/sim-clock';

interface Env {
  DB: D1Database;
  RESEND_API_KEY?: string;
  SWEEP_SECRET?: string;
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

// Self-fetch base for driving our own API from inside a Function. MUST be the pages.dev hostname
// (a Worker fetch back into its own custom-domain zone is blocked; cross-zone is not), and NOTE the
// subdomain is ratemyagent-bi4 — the original project name survives a rename. If the project is
// ever renamed/recreated, update this ONE constant. (Env-binding form tracked post-launch.)
const SELF_API_BASE = 'https://ratemyagent-bi4.pages.dev';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  // Auth — FAIL CLOSED (B5, review 2026-07-09): this mutates run status + restores coupons, so an
  // unset SWEEP_SECRET must DENY (was `&&`, which let it run wide-open if the binding was missing).
  const url = new URL(request.url);
  if (!env.SWEEP_SECRET || request.headers.get('X-Sweep-Secret') !== env.SWEEP_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
  }

  const db = env.DB;
  await (await import('../lib/cron-heartbeat')).stampCronHeartbeat(db, 'sweep-expired'); // 5v-a heartbeat

  // Sim-clock (staging fleet exercise): expiry windows compare against sim-now when the driver
  // warps time; real now everywhere else. Heartbeat + auth above stay REAL by design.
  const now = await simNow(env as any, request);
  const nowSql = sqlNow(now);
  const mailer = mailerFromEnv(env, now.toISOString());

  // Find expired runs that haven't been notified
  // Only look at runs expired in the last 24 hours to avoid re-processing ancient ones
  // Don't expire runs where grading is complete — those should finalize, not expire
  const expiredRuns = await db.prepare(`
    SELECT r.run_token, r.agent_id, r.email, r.tasks_graded, r.expires_at,
           r.coupon_code, a.display_name, a.email as agent_email,
           (SELECT COUNT(*) FROM run_tasks WHERE run_token = r.run_token) as total_tasks,
           (SELECT COUNT(*) FROM run_tasks WHERE run_token = r.run_token AND graded_at IS NOT NULL) as graded_tasks
    FROM runs r
    JOIN agents a ON r.agent_id = a.agent_id
    WHERE r.status IN ('open', 'in_progress')
      -- datetime(…) wrap (code-review CRIT, 2026-07-10): expires_at is stored as toISOString()
      -- ('…T…Z'); raw TEXT compare vs datetime('now') is skewed ~24h ('T' > ' ' same-day).
      AND datetime(r.expires_at) < datetime(?1)
      AND datetime(r.expires_at) > datetime(?1, '-24 hours')
  `).bind(nowSql).all();

  const runs = (expiredRuns.results || []) as any[];
  let notified = 0;
  let expired = 0;

  for (const run of runs) {
    // Skip runs where all tasks are graded — those should finalize, not expire
    if (run.total_tasks > 0 && run.graded_tasks >= run.total_tasks) continue;

    // Mark as expired with failure tracking
    await db.prepare(`
      UPDATE runs SET status = 'expired',
        failure_type = 'transient',
        failure_reason = 'Test window expired before completion'
      WHERE run_token = ?
    `).bind(run.run_token).run();
    expired++;

    // Restore the key — decrement uses_used so the user can retry with the same key
    if (run.coupon_code) {
      await db.prepare(
        'UPDATE coupons SET uses_used = MAX(0, uses_used - 1) WHERE code = ?'
      ).bind(run.coupon_code).run();
    }

    // Count total tasks for this run
    const total = await db.prepare(
      'SELECT COUNT(*) as count FROM run_tasks WHERE run_token = ?'
    ).bind(run.run_token).first() as any;

    // Use email from run or agent record only
    const recipientEmail = run.email || run.agent_email;

    // Send admin notification about the expired run
    if (env.RESEND_API_KEY) {
      await sendAdminNotificationEmail({
        subject: `Run expired — ${run.display_name || run.agent_id}`,
        body: `Run ${run.run_token} for agent "${run.display_name || run.agent_id}" expired.\n\nTasks completed: ${run.tasks_graded || 0} of ${total?.count || 0}\nAgent email: ${recipientEmail || 'none'}\nKey restored: ${run.coupon_code || 'n/a'}`,
      }, mailer).catch(() => {});

      await db.prepare(
        'UPDATE runs SET admin_notified = 1 WHERE run_token = ?'
      ).bind(run.run_token).run();
    }

    if (!recipientEmail) continue;
    if (recipientEmail && env.RESEND_API_KEY) {
      const result = await sendExpiredEmail({
        to: recipientEmail,
        agentName: run.display_name || run.agent_id,
        runToken: run.run_token,
        tasksGraded: run.tasks_graded || 0,
        totalTasks: total?.count || 114,
      }, mailer).catch(() => ({ ok: false }));

      if (result && (result as any).ok) {
        notified++;
        await db.prepare(
          'UPDATE runs SET failure_notified = 1 WHERE run_token = ?'
        ).bind(run.run_token).run();
      }
    }
  }

  // ── Abandoned eval (5d): a paid run that graded (reached eval_pending) but never finished its
  // multi-turn eval still gets exactly ONE attestation — anchored on its FINAL GRADED state. We
  // accept that graded state as final and mark the run completed, then attest (idempotent).
  // Guarded on the 1h completed_at floor (stamped when the run enters eval_pending) so a run whose
  // eval is still in flight is never swept. No upper ceiling (5f fix 6): a multi-day cron outage
  // must not strand paid runs unattested forever — the CAS in eval-turn + finalize idempotency make
  // re-touching safe. Because eval-turn short-circuits on status='completed', a belated eval poll
  // after this cannot change the score — the anchored graded state is genuinely final.
  // NOT gated on attested (5j): a pre-5d run can sit eval_pending with attested=1 (attested early,
  // eval never finished) — the old attested=0 gate stranded it forever. finalizeAttestation is
  // idempotent (returns already-attested, no re-broadcast), so widening to any attested is safe.
  let attestedAbandoned = 0;
  const abandoned = await db.prepare(`
    SELECT run_token, agent_id FROM runs
    WHERE status = 'eval_pending'
      AND includes_attestation = 1
      AND completed_at IS NOT NULL
      AND completed_at < datetime(?, '-1 hour')
  `).bind(nowSql).all();
  for (const r of (abandoned.results || []) as any[]) {
    // CAS: only proceed if WE flip eval_pending→completed (a concurrent eval-turn recalc may win).
    const won = await db.prepare(
      "UPDATE runs SET status = 'completed' WHERE run_token = ? AND status = 'eval_pending'"
    ).bind(r.run_token).run();
    if (!won.meta.changes) continue;
    // Referral qualifies on real completion, same as the eval path (idempotent — only flips a
    // 'pending' referral). Result-email parity for abandoned runs is flagged, not folded (needs a
    // shared completion-email helper; the agent can still retrieve results via /api/result).
    try { const { qualifyReferral } = await import('../lib/wallet'); await qualifyReferral(db, r.agent_id); } catch {}
    try {
      const { finalizeAttestation } = await import('../lib/attestation');
      const res = await finalizeAttestation(db, env, r.run_token);
      if (res.attested) attestedAbandoned++;
    } catch { /* best-effort — retry-anchors backstops a failed broadcast */ }
    // Result-email parity (5m): a customer whose run completes via the sweep must still get their
    // result email. Same shared helper the normal eval path uses; idempotent on result_email_sent.
    try { const { sendCompletionEmail } = await import('../lib/completion-email'); await sendCompletionEmail(db, env, r.run_token); } catch {}
  }

  // ── Abandoned GRADING runs (Codex HIGH #9, 2026-07-10): grade-batch only zeroes unsubmitted
  // answers and finalises when a client POLLS — a disconnected client's run sits in 'grading'
  // past expiry forever (the query above only touches open/in_progress). Drive the REAL grading
  // path by self-POSTing grade-batch as if we were the polling client: it zeroes post-expiry
  // stragglers, grades any submitted-but-ungraded answers, and runs the full finalize (validators,
  // attestation, emails) — zero duplicated logic. Fetched via the pages.dev hostname: a Worker
  // fetch to its own custom-domain zone is blocked, cross-zone is not. NOTE the project's
  // pages.dev subdomain is ratemyagent-bi4 (the original project name survives a rename), not
  // verigent. Bounded (≤2 runs, ≤8 polls each per sweep); leftovers caught by the next pass.
  let finalizedGrading = 0;
  const stuckGrading = await db.prepare(`
    SELECT run_token FROM runs
    WHERE status = 'grading'
      AND datetime(expires_at) < datetime(?1)
      AND datetime(expires_at) > datetime(?1, '-7 days')
    ORDER BY expires_at ASC LIMIT 2
  `).bind(nowSql).all();
  for (const g of (stuckGrading.results || []) as any[]) {
    for (let i = 0; i < 8; i++) {
      let j: any = null;
      try {
        const r = await fetch(`${SELF_API_BASE}/api/grade-batch`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ run_token: g.run_token }),
        });
        j = await r.json().catch(() => null);
      } catch (e: any) {
        console.error('sweep grading self-poll failed:', e?.message || e);
        break;
      }
      // Keep polling only while grade-batch reports actual grading progress. 'queued' means the
      // slot pool is saturated — immediate re-polls can't free a slot, so stop and let the next
      // sweep pass retry (code-review, 2026-07-10). Anything else is terminal for this pass.
      if (!j || j.status !== 'grading') break;
    }
    // Truth from the DB, not the poll response: count it finalized only if the status moved.
    const st = await db.prepare('SELECT status FROM runs WHERE run_token = ?').bind(g.run_token).first() as any;
    if (st && st.status !== 'grading') finalizedGrading++;
  }

  return new Response(JSON.stringify({
    ok: true,
    expired,
    notified,
    checked: runs.length,
    attested_abandoned: attestedAbandoned,
    finalized_grading: finalizedGrading,
  }), { status: 200, headers: CORS });
};
