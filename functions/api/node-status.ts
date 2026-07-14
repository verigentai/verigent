// GET /api/node-status — node-health / maintenance readout (item 3) + outage-recovery notify (item 6).
//
// (a) Returns the effective run-gate state so the site/admin can show a maintenance banner and pause
//     the "get a key" / "start" CTAs client-side. Cheap: runGateState uses the ~45s-cached probe.
// (b) When the node is HEALTHY and there are un-notified outage-waitlist rows (people who tried to get
//     a key while it was down), it emails each "Verigent is back up — grab a fresh key" and stamps
//     notified_at so nobody is emailed twice. Idempotent — safe to hit from the health-check cron.
//
// Availability/eligibility only — no scoring. Public GET is fine (exposes open/closed, nothing secret).

import { runGateState } from '../lib/node-gate';
import { mailerFromEnv } from '../lib/email-send';
import { sendNotificationEmail } from '../lib/email';
import { freeRunsThisWeek, WEEKLY_FREE_TEST_CAP } from '../lib/free-cap';

interface Env {
  DB: D1Database;
  CLN_API_URL?: string;
  CLN_RUNE?: string;
  RESEND_API_KEY?: string;
}

const MAX_NOTIFY_PER_CALL = 50; // bound the work per request; the cron re-runs to drain the rest

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const gate = await runGateState(env);

  let notified = 0;
  if (gate.open && env.RESEND_API_KEY) {
    // Node's back — notify anyone who was turned away during the outage (item 6).
    let waiting: { results?: Array<{ email: string }> } = {};
    try {
      waiting = await env.DB.prepare(
        'SELECT email FROM outage_waitlist WHERE notified_at IS NULL ORDER BY requested_at ASC LIMIT ?'
      ).bind(MAX_NOTIFY_PER_CALL).all() as any;
    } catch { /* table not migrated — nothing to notify */ }

    for (const row of waiting.results || []) {
      const sent = await sendNotificationEmail({
        to: row.email,
        subject: 'Verigent is back up — grab a fresh test key',
        badge: 'Back online',
        leadHtml:
          "Good news — Verigent is back up. You tried to start a verification while our Bitcoin " +
          "infrastructure was briefly down; it's live again now. Grab a fresh test key and pick up " +
          "where you left off — nothing was charged during the pause.",
        ctaText: 'Get your test key',
        ctaUrl: 'https://verigent.ai/start',
      }, mailerFromEnv(env)).catch(() => ({ ok: false } as { ok: boolean }));
      if (sent.ok) {
        try {
          await env.DB.prepare("UPDATE outage_waitlist SET notified_at = datetime('now') WHERE email = ?").bind(row.email).run();
          notified++;
        } catch { /* best-effort */ }
      }
    }
  }

  // Free-cap waitlist (build-handoff item 1): when this week has free slots (a new week reset, or usage
  // still under the cap) and people are waiting, email them FIFO that the window's open. Rides this same
  // periodic invocation — no new scheduler. Best-effort; never affects the node-status response itself.
  let freeNotified = 0;
  if (gate.open && env.RESEND_API_KEY) {
    try {
      const slots = WEEKLY_FREE_TEST_CAP - (await freeRunsThisWeek(env.DB));
      if (slots > 0) {
        const waitingFree = await env.DB.prepare(
          'SELECT email FROM free_cap_waitlist WHERE notified_at IS NULL ORDER BY requested_at ASC LIMIT ?'
        ).bind(Math.min(slots, MAX_NOTIFY_PER_CALL)).all() as { results?: Array<{ email: string }> };
        for (const row of waitingFree.results || []) {
          const sent = await sendNotificationEmail({
            to: row.email,
            subject: 'Your free Verigent verification window is open',
            badge: 'Window open',
            leadHtml:
              "Good news — this week's free verification window is open. You asked us to tell you the " +
              "moment a slot came up, and one has. Head over and start your free verification while slots last.",
            ctaText: 'Start your free verification',
            ctaUrl: 'https://verigent.ai/start',
          }, mailerFromEnv(env)).catch(() => ({ ok: false } as { ok: boolean }));
          if (sent.ok) {
            try {
              await env.DB.prepare("UPDATE free_cap_waitlist SET notified_at = datetime('now') WHERE email = ?").bind(row.email).run();
              freeNotified++;
            } catch { /* best-effort */ }
          }
        }
      }
    } catch { /* table not migrated — nothing to notify */ }
  }

  return Response.json({
    open: gate.open,
    maintenance: !gate.open,
    source: gate.source,
    message: gate.open ? null : gate.message,
    notified, // how many outage-waitlist emails were sent this call
    free_notified: freeNotified, // free-cap "window open" emails sent this call
  });
};
