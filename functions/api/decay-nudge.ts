// POST /api/decay-nudge?secret=SWEEP_SECRET — cron. The LIFECYCLE NUDGE engine: one ordered stage
// ladder per agent (tracked in agents.last_nudge_stage, reset when the agent is Current again), two
// populations, five stages — so no agent can be double-nudged or skipped backwards:
//
//   CONVERSION (Ant 2026-07-08 — "we need the nudge templates 100%"): unpaid agents inside/at the
//   end of their 72h free continuous window, anchored to the WINDOW START (free_until − 72h):
//     nudge24 : ≥24h into the free window — "did it move overnight?"
//     nudge48 : ≥48h in — "last full day of free testing"
//     nudge72 : window CLOSED — "went cold with its weak spots showing"
//   Referred agents (7-day free week) are excluded — the nudge copy is written for the 72h arc;
//   they fall through to the decay stages after their week like before.
//
//   DECAY (reconciled 2026-07-08 to the 3/14-day freshness bands + admin template ids):
//     ageing : left Current (ageDays > CURRENT_MAX_DAYS)   → template id 'ageing'
//     stale  : past Ageing (ageDays > AGEING_MAX_DAYS)     → template id 'stale'
//
// Copy comes from the admin-edited email_templates table (stage id == template id — /email-preview
// is the live copy source; loader falls back to compiled defaults). Paying agents don't decay
// (continuously verified) → no slip emails.

import { sendTemplateEmail } from '../lib/email-template-loader';
import { mailerFromEnv } from '../lib/email-send';
import { simNow, sqlNow } from '../lib/sim-clock';
import { CURRENT_MAX_DAYS, AGEING_MAX_DAYS } from '../lib/freshness';
import { FREE_TRIAL_HOURS } from '../lib/pricing';
import { mintLoginCtaUrl } from '../lib/owner-auth';

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

export type NudgeStage = 'nudge24' | 'nudge48' | 'nudge72' | 'ageing' | 'stale';
export const STAGE_ORDER: NudgeStage[] = ['nudge24', 'nudge48', 'nudge72', 'ageing', 'stale'];

// Legacy last_nudge_stage values (pre-reconciliation rows in live D1) → their nearest new stage.
// 'day6' was the retired pre-warning: treat as nothing sent so the real 'ageing' email still goes.
export function sentIndex(stored: string | null): number {
  if (!stored || stored === 'day6') return -1;
  if (stored === 'day7') return STAGE_ORDER.indexOf('ageing');
  if (stored === 'day29') return STAGE_ORDER.indexOf('stale');
  return STAGE_ORDER.indexOf(stored as NudgeStage);
}

export function dueDecayStage(ageDays: number): NudgeStage | null {
  if (ageDays > AGEING_MAX_DAYS) return 'stale';
  if (ageDays > CURRENT_MAX_DAYS) return 'ageing';
  return null;
}

// Conversion stage from the free-window clock. Anchor = window START (free_until − FREE_TRIAL_HOURS)
// so "24h/48h after your free test" is literal; nudge72 fires only once the window has CLOSED.
export function dueConversionStage(freeUntilMs: number, nowMs: number): NudgeStage | null {
  if (nowMs >= freeUntilMs) return 'nudge72';
  const hoursIn = (nowMs - (freeUntilMs - FREE_TRIAL_HOURS * 3600_000)) / 3600_000;
  if (hoursIn >= 48) return 'nudge48';
  if (hoursIn >= 24) return 'nudge24';
  return null;
}

export function onRequestOptions(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const headers = { 'Content-Type': 'application/json', ...CORS };
  const url = new URL(request.url);
  if (!env.SWEEP_SECRET || request.headers.get('X-Sweep-Secret') !== env.SWEEP_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
  }
  if (!env.RESEND_API_KEY) {
    return Response.json({ ok: false, error: 'email not configured' }, { status: 503, headers });
  }

  const db = env.DB;
  await (await import('../lib/cron-heartbeat')).stampCronHeartbeat(db, 'decay-nudge'); // 5v-a heartbeat
  // Sim-clock (staging fleet exercise): the whole nudge ladder — conversion window, reverify grace,
  // decay ages — reads sim-now when the driver warps time. Heartbeat + auth stay REAL.
  const now = await simNow(env as any, request);
  const nowMs = now.getTime();
  const nowSql = sqlNow(now);
  const mailer = mailerFromEnv(env, now.toISOString());

  const { escHtml } = await import('../lib/email-template-loader');
  const send = async (a: any, due: NudgeStage): Promise<boolean> => {
    const name = escHtml(a.display_name || a.handle || 'your agent'); // untrusted → escape into HTML
    const agentPath = `/agent/${a.handle || a.agent_id}`;
    // Auto-login CTA (Ant 2026-07-10): sign the owner in + land on their agent page. Falls back to the
    // plain page link if the token mint fails — the CTA always works, just may need a manual sign-in.
    const ctaUrl = (await mintLoginCtaUrl(db, a.email, agentPath)) || `https://verigent.ai${agentPath}`;
    const r = await sendTemplateEmail(db, mailer, due, {
      to: a.email,
      vars: { Atlas: name },
      ctaUrl,
    });
    if (r.ok) {
      await db.prepare('UPDATE agents SET last_nudge_stage = ? WHERE agent_id = ?').bind(due, a.agent_id).run();
    }
    return r.ok;
  };

  // ── CONVERSION: unpaid, non-referred agents with a free window armed in the last 14 days.
  // total_topped_up_cents = 0 is the honest "never paid" (a paid agent may legitimately sit at a
  // zero BALANCE). Baselines excluded; referred (7d week) excluded — copy is written for 72h.
  let conversionSent = 0;
  const conv = await db.prepare(`
    SELECT a.agent_id, a.handle, a.display_name, a.email, a.last_nudge_stage, a.free_until
    FROM agents a JOIN owners o ON o.owner_id = a.owner_id
    WHERE a.free_until IS NOT NULL
      AND a.free_until > datetime(?, '-14 days')
      AND a.email IS NOT NULL
      AND COALESCE(a.total_topped_up_cents, 0) = 0
      -- A positive balance = a FUNDED wallet being drawn down, however it got there (referral
      -- credit, contribution award, admin grant) — a paying customer in every sense that matters,
      -- and per-challenge billing runs seamlessly past the free window. "Last free day" / "went
      -- cold" conversion copy is wrong for them, and paying agents never get pay-nudges (hard
      -- rule). total_topped_up_cents=0 alone missed this: it only sees the topup_* rails.
      -- (Found by the staging fleet 14-sim-day exercise, assertion 2 — 2026-07-13.)
      AND COALESCE(a.balance_cents, 0) <= 0
      AND COALESCE(a.is_public_baseline, 0) = 0
      AND o.referred_by_code IS NULL
    LIMIT 200
  `).bind(nowSql).all();
  for (const a of (conv.results || []) as any[]) {
    const freeUntilMs = Date.parse(String(a.free_until).replace(' ', 'T') + (String(a.free_until).includes('Z') ? '' : 'Z'));
    if (!Number.isFinite(freeUntilMs)) continue;
    const due = dueConversionStage(freeUntilMs, nowMs);
    if (!due) continue;
    if (STAGE_ORDER.indexOf(due) <= sentIndex(a.last_nudge_stage)) continue;
    if (await send(a, due)) conversionSent++;
  }

  // ── REVERIFY-ONLINE (Ant 2026-07-10): a topped-up agent whose first re-verification check hasn't
  // landed yet. While reverifying_until is still set (probe/finish clears it the moment a real check
  // lands) AND the ~2h first-check window has passed, send ONE email asking the owner to bring the
  // agent online so its provisional badge confirms to true Current. Fires once per top-up window
  // (reverify_nudge_sent_at guard); the provisional badge itself reverts on its own at 24h grace expiry.
  let reverifySent = 0;
  const reverify = await db.prepare(`
    SELECT agent_id, handle, display_name, email
    FROM agents
    WHERE reverifying_until IS NOT NULL
      AND reverifying_until > datetime(?1)
      AND reverify_nudge_sent_at IS NULL
      AND datetime(?1) >= datetime(reverifying_until, '-22 hours')
      AND email IS NOT NULL
      AND COALESCE(is_public_baseline, 0) = 0
    LIMIT 200
  `).bind(nowSql).all();
  for (const a of (reverify.results || []) as any[]) {
    const name = escHtml(a.display_name || a.handle || 'your agent');
    const agentPath = `/agent/${a.handle || a.agent_id}`;
    const ctaUrl = (await mintLoginCtaUrl(db, a.email, agentPath)) || `https://verigent.ai${agentPath}`;
    const r = await sendTemplateEmail(db, mailer, 'reverify-online', {
      to: a.email,
      vars: { Atlas: name },
      ctaUrl,
    });
    if (r.ok) {
      await db.prepare('UPDATE agents SET reverify_nudge_sent_at = ? WHERE agent_id = ?').bind(nowSql, a.agent_id).run();
      reverifySent++;
    }
  }

  // ── DECAY: non-paying, non-continuous, outside any free window (unchanged population).
  const agents = await db.prepare(`
    SELECT agent_id, handle, display_name, email, last_nudge_stage,
           CAST(julianday(?1) - julianday(COALESCE(last_certified_at, updated_at)) AS INTEGER) AS age_days
    FROM agents
    WHERE vg_code IS NOT NULL AND email IS NOT NULL
      AND (balance_cents IS NULL OR balance_cents <= 0)
      -- Never nudge an agent that is being kept current by continuous probing, is one of Verigent's
      -- own public baselines, or is inside a free window (Ant 2026-07-07). A "re-verify to stay
      -- Current" email contradicts the continuous model (the agent IS being verified), spams our own
      -- verify@ inbox with baseline nudges, and would nag free-window continuous customers. A LAPSED
      -- continuous agent (continuous_active flipped to 0 on depletion) still qualifies — re-engaging it
      -- is correct.
      AND COALESCE(continuous_active, 0) = 0
      AND COALESCE(is_public_baseline, 0) = 0
      AND (free_until IS NULL OR free_until <= datetime(?1))
    LIMIT 200
  `).bind(nowSql).all();

  let decaySent = 0;
  let reset = 0;
  for (const a of (agents.results || []) as any[]) {
    const age = a.age_days || 0;

    // Back to Current (re-verified) → clear DECAY stages so the next decay cycle can nudge again.
    // CRITICAL (Ant review fix): a just-lapsed unpaid agent still has age≤CURRENT (it probed during
    // its free window) AND matches this decay population — but the conversion loop above just stamped
    // it nudge24/48/72. Wiping that here would make the conversion loop re-send the SAME nudge every
    // cron run for ~3 days. So NEVER reset a conversion stage; those age out naturally once free_until
    // passes the 14-day lookback. Only re-arm genuine decay recoveries (ageing/stale/legacy day7/29).
    if (age <= CURRENT_MAX_DAYS) {
      const stage = a.last_nudge_stage;
      const isConversion = stage === 'nudge24' || stage === 'nudge48' || stage === 'nudge72';
      if (stage && !isConversion) {
        await db.prepare('UPDATE agents SET last_nudge_stage = NULL WHERE agent_id = ?').bind(a.agent_id).run();
        reset++;
      }
      continue;
    }

    const due = dueDecayStage(age);
    if (!due) continue;
    if (STAGE_ORDER.indexOf(due) <= sentIndex(a.last_nudge_stage)) continue; // stage (or later) already sent
    if (await send(a, due)) decaySent++;
  }

  return Response.json({
    ok: true,
    conversion_sent: conversionSent,
    decay_sent: decaySent,
    reverify_sent: reverifySent,
    reset,
    scanned: ((conv.results || []).length + (agents.results || []).length),
  }, { headers });
};
