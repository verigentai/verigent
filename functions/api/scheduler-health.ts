// POST /api/scheduler-health — cron (auth: X-Sweep-Secret header).
//
// PROF-INBOX:inbox-0008 — detects a DUD/QUIET scheduler on a continuous (MCP-pull) agent and
// emails the user to fix it, BEFORE the cert ages out. Continuous verification is delivered by
// the agent pulling a random probe ~5×/day; every completed pull stamps agents.last_self_pull_at.
// If that heartbeat goes quiet while the agent is still continuous_active, the agent's own
// scheduler has likely died — so we nudge the HUMAN (never the agent: surprise = validity).
//
// Self-correcting: the alert is throttled (scheduler_alert_sent_at) and CLEARED the moment a
// self-pull resumes, so a fixed scheduler re-arms the alert for next time.

import { sendTemplateEmail } from '../lib/email-template-loader';
import { mailerFromEnv } from '../lib/email-send';
import { simNow, sqlNow } from '../lib/sim-clock';

interface Env {
  DB: D1Database;
  SWEEP_SECRET?: string;
  RESEND_API_KEY?: string;
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Quiet threshold: ~5 pulls/day means a healthy agent pulls every few hours. 24h with no pull is
// past even an overnight-off part-timer (who pulls daily in their active block) and alerts the
// owner with days of Fresh-window runway left to fix the scheduler (Ant ruling 2026-07-14: owner
// must know within 24h, minimum). Called HOURLY by the nudge sweep; the scheduler_alert_sent_at
// throttle re-alerts at most once per QUIET_HOURS, so hourly calls cannot spam.
// Pinned by professor/canonical-check.mjs — change only with a deliberate pin update.
const QUIET_HOURS = 24;

export function onRequestOptions(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const headers = { 'Content-Type': 'application/json', ...CORS };
  // X-Sweep-Secret header, matching the rest of the sweep family (2026-07-10 hardening: secrets
  // out of URLs so they never land in request logs). This endpoint kept the old ?secret= form
  // until 2026-07-12 because it predated the sweep and had no caller to break.
  if (!env.SWEEP_SECRET || request.headers.get('X-Sweep-Secret') !== env.SWEEP_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
  }
  if (!env.RESEND_API_KEY) {
    return Response.json({ ok: false, error: 'email not configured' }, { status: 503, headers });
  }

  const db = env.DB;

  // Sim-clock (staging fleet exercise): quiet-hours + alert throttling read sim-now when warped.
  const now = await simNow(env as any, request);
  const nowSql = sqlNow(now);
  const mailer = mailerFromEnv(env, now.toISOString());

  let rows: any;
  try {
    rows = await db.prepare(`
      SELECT agent_id, handle, display_name, email, scheduler_alert_sent_at, last_self_pull_at,
             CAST((julianday(?1) - julianday(COALESCE(last_self_pull_at, last_billed_at, updated_at))) * 24 AS REAL) AS quiet_hours,
             CASE WHEN scheduler_alert_sent_at IS NULL THEN 999999
                  ELSE CAST((julianday(?1) - julianday(scheduler_alert_sent_at)) * 24 AS REAL) END AS hours_since_alert
      FROM agents
      WHERE continuous_active = 1 AND email IS NOT NULL
        -- Never nag Verigent's own baselines (found live 2026-07-10: a quiet baseline emailed
        -- verify@ — self-spam; same exclusion decay-nudge has always had).
        AND COALESCE(is_public_baseline, 0) = 0
      LIMIT 200
    `).bind(nowSql).all();
  } catch (e: any) {
    // Columns land with schema-v22 — fail soft until applied rather than 500 the cron.
    return Response.json({ ok: false, error: 'scheduler-health columns not migrated yet (schema-v22)' }, { status: 503, headers });
  }

  let alerted = 0;
  let cleared = 0;
  for (const a of (rows.results || []) as any[]) {
    const quiet = (a.quiet_hours ?? 0) >= QUIET_HOURS;

    if (!quiet) {
      // Scheduler healthy — if we'd previously alerted, clear it so it re-arms.
      if (a.scheduler_alert_sent_at) {
        await db.prepare('UPDATE agents SET scheduler_alert_sent_at = NULL WHERE agent_id = ?').bind(a.agent_id).run();
        cleared++;
      }
      continue;
    }

    // Quiet — alert at most once per QUIET_HOURS window.
    if ((a.hours_since_alert ?? 999999) < QUIET_HOURS) continue;

    const { escHtml } = await import('../lib/email-template-loader');
    const name = escHtml(a.display_name || a.handle || 'your agent'); // untrusted → escape into HTML
    // Copy from the admin-edited 'scheduler' template (loader falls back to defaults). The template's
    // sample literals are the substitution tokens: "Atlas" → agent name, "48 hours" → real quiet time.
    const quietLabel = `${Math.max(QUIET_HOURS, Math.floor(a.quiet_hours ?? 0))} hours`;
    const r = await sendTemplateEmail(db, mailer, 'scheduler', {
      to: a.email,
      vars: { Atlas: name, '48 hours': quietLabel },
      ctaUrl: `https://verigent.ai/start?handle=${encodeURIComponent(a.handle || '')}`,
    });

    if (r.ok) {
      await db.prepare('UPDATE agents SET scheduler_alert_sent_at = ? WHERE agent_id = ?').bind(nowSql, a.agent_id).run();
      alerted++;
    }
  }

  return Response.json({ ok: true, alerted, cleared, scanned: (rows.results || []).length }, { headers });
};
