// GET/POST /api/weekly-registry-email?secret=SWEEP_SECRET — the weekly "Monday registry update"
// (5s). Emails each continuously-verified owner their current standing + a link, tying to the
// weekly standings reveal (appointment-publication retention, docs/WEEKLY-STANDINGS.md).
//
// SECRET-GATED like the other cron endpoints (continuous-check, decay-nudge, sweep-expired). It is
// NOT yet wired to a live schedule — that's a scheduler decision flagged to the coordinator, and
// the secret gate means it never fires on its own. Runs nothing (and sends nothing) without the
// secret, so it's safe to ship dark.

import { sendScorecardEmail } from '../lib/email';
import { mailerFromEnv } from '../lib/email-send';
import { sendTemplateEmail, escHtml } from '../lib/email-template-loader';
import { isoWeekId } from '../lib/weekly';
import { COMPOSITE_DIMENSIONS } from '../lib/test-manifest';

// Canonical dimension labels (one owner per fact §2.10) — the check-in email must name a dimension
// exactly as the report page does, or "Security climbed 17 points" contradicts /agent/<handle>.
const DIM_LABEL_MAP = new Map(COMPOSITE_DIMENSIONS.map((d) => [d.key, d.label]));
const dimLabel = (k: string) => DIM_LABEL_MAP.get(k) ?? k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

interface Env {
  DB: D1Database;
  SWEEP_SECRET?: string;
  RESEND_API_KEY?: string;
  // GATED OFF by default: the per-attested-agent scorecard email only sends to EVERYONE when this
  // is explicitly '1'/'true'. Until then the scorecard pass runs ONLY for ?sample=<handle> (a single
  // preview to a real recipient, for Ant to approve) and the send-to-all path is skipped. This is
  // the "build the wiring, leave send-to-all off pending a sample" flag.
  SCORECARD_EMAIL_ENABLED?: string;
  // Secret for the private signed scorecard links embedded in the email.
  SCORECARD_LINK_SECRET?: string;
}

function isoWeekLabel(d: Date): string {
  return `Week of ${d.toISOString().slice(0, 10)}`;
}

// The per-attested-agent scorecard email pass. Off-by-default: sends to ALL attested agents only
// when SCORECARD_EMAIL_ENABLED is truthy; otherwise sends at most ONE sample (?sample=<handle>) so
// Ant can approve the format before it goes wide. Returns a small summary.
async function scorecardPass(
  env: Env, url: URL,
): Promise<{ mode: string; candidates: number; sent: number; skipped: number; enabled: boolean }> {
  const db = env.DB;
  const enabled = env.SCORECARD_EMAIL_ENABLED === '1' || env.SCORECARD_EMAIL_ENABLED === 'true';
  const sampleHandle = url.searchParams.get('sample');

  // Latest ATTESTED run per agent with a real recipient.
  let sql = `
    SELECT a.handle, a.display_name, COALESCE(a.email, o.email) AS email,
           r.run_token, r.composite_score AS composite, r.tier, r.primary_class,
           r.dimension_scores, r.class_scores, r.attestation_vg_code, r.attestation_txid, r.completed_at
    FROM agents a
    JOIN owners o ON o.owner_id = a.owner_id
    JOIN runs r ON r.run_token = (
      SELECT run_token FROM runs WHERE agent_id = a.agent_id AND status = 'completed' AND attested = 1
      ORDER BY completed_at DESC LIMIT 1
    )
    WHERE a.handle IS NOT NULL AND COALESCE(a.email, o.email) LIKE '%@%'`;
  const binds: any[] = [];
  if (sampleHandle) { sql += ' AND a.handle = ?'; binds.push(sampleHandle); }
  sql += ' ORDER BY r.composite_score DESC LIMIT 500';

  const rows = await db.prepare(sql).bind(...binds).all();
  let candidates = (rows.results || []).length;

  // Gate: with no ?sample and the flag off, DO NOT send to anyone.
  if (!sampleHandle && !enabled) {
    return { mode: 'gated-off', candidates, sent: 0, skipped: candidates, enabled };
  }
  // A sample must name a single handle; cap it to one recipient regardless.
  const targets = sampleHandle ? (rows.results || []).slice(0, 1) : (rows.results || []);
  candidates = targets.length;

  let sent = 0, skipped = 0;
  if (!env.RESEND_API_KEY) return { mode: sampleHandle ? 'sample' : 'all', candidates, sent: 0, skipped: candidates, enabled };

  const weekLabel = isoWeekLabel(new Date());
  for (const r of targets as any[]) {
    // Delta vs the agent's previous weekly snapshot — the only thing the nudge needs (progress hook).
    // week_id < current: the in-progress week gets stamped by report views/sweeps, so the naked
    // latest row made every delta read ~+0 (review 5kk #9).
    const prev = await db.prepare(
      'SELECT composite, week_id FROM weekly_snapshots WHERE agent_id = (SELECT agent_id FROM agents WHERE handle = ?) AND week_id < ? ORDER BY week_id DESC LIMIT 1'
    ).bind(r.handle, isoWeekId()).first().catch(() => null) as any;
    const delta = prev && prev.composite != null ? Math.round((r.composite - prev.composite) * 100) / 100 : null;
    const deltaLabel = delta == null ? '—' : (delta >= 0 ? '+' : '') + delta;
    // NUDGE-only (Ant 2026-07-04): the email bounces the operator to their REPORT page to COPY the
    // scorecard — no scorecard content, no signed scorecard-page link in the email.
    const reportUrl = `https://verigent.ai/agent/${r.handle}`;
    const res = await sendScorecardEmail({
      to: r.email, handle: r.handle, composite: r.composite, tier: r.tier || undefined,
      deltaLabel, reportUrl, weekLabel,
    }, mailerFromEnv(env)).catch(() => ({ ok: false }));
    if ((res as any)?.ok) sent++; else skipped++;
  }
  return { mode: sampleHandle ? 'sample' : 'all', candidates, sent, skipped, enabled };
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS });

async function run(env: Env, request: Request): Promise<Response> {
  const headers = { 'Content-Type': 'application/json', ...CORS };
  const url = new URL(request.url);
  if (!env.SWEEP_SECRET || url.searchParams.get('secret') !== env.SWEEP_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
  }
  const db = env.DB;

  // Continuously-verified agents that have a real recipient + a published tier. Bounded per pass.
  const rows = await db.prepare(`
    SELECT a.agent_id, a.handle, a.current_tier AS tier, a.composite_score AS composite,
           a.balance_cents, a.display_name,
           COALESCE(a.email, o.email) AS email
    FROM agents a
    JOIN owners o ON o.owner_id = a.owner_id
    WHERE a.continuous_active = 1
      AND a.handle IS NOT NULL
      AND COALESCE(a.email, o.email) LIKE '%@%'
    ORDER BY a.composite_score DESC
    LIMIT 500
  `).all();

  let sent = 0, skipped = 0, checkins = 0;
  if (env.RESEND_API_KEY) {
    for (const r of (rows.results || []) as any[]) {
      // WEEKLY CHECK-IN (Ant 2026-07-08 — the last unbuilt lifecycle email): a PAYING agent whose
      // published week actually IMPROVED gets the 'checkin' template with its real deltas + live
      // scorecard block, instead of the generic standings note — never both. The improvement gate
      // (top dimension up ≥3) keeps the "your fix landed" narrative honest: flat/declining weeks
      // fall through to the standings email, which claims nothing.
      let checkinSent = false;
      if ((r.balance_cents ?? 0) > 0) {
        try {
          const snaps = await db.prepare(
            'SELECT composite, tier, dimension_scores FROM weekly_snapshots WHERE agent_id = ? ORDER BY week_id DESC LIMIT 2'
          ).bind(r.agent_id).all();
          const [cur, prev] = (snaps.results || []) as any[];
          if (cur && prev) {
            const curD = JSON.parse(cur.dimension_scores || '{}');
            const prevD = JSON.parse(prev.dimension_scores || '{}');
            const label = dimLabel;
            const deltas = Object.keys(curD)
              .filter((k) => typeof curD[k] === 'number' && typeof prevD[k] === 'number')
              .map((k) => ({ k, prev: Math.round(prevD[k]), now: Math.round(curD[k]), d: Math.round(curD[k] - prevD[k]) }))
              .sort((a, b) => b.d - a.d);
            const top = deltas[0];
            const second = deltas[1];
            if (top && top.d >= 3) {
              const weakest = [...deltas].sort((a, b) => a.now - b.now).slice(0, 3)
                .map((w) => ({ dim: label(w.k), score: w.now }));
              const res = await sendTemplateEmail(db, mailerFromEnv(env), 'checkin', {
                to: r.email,
                vars: {
                  Atlas: escHtml(r.display_name || r.handle),
                  'Security 41 → 58': `${label(top.k)} ${top.prev} → ${top.now}`,
                  'Security climbed 17 points': `${label(top.k)} climbed ${top.d} points`,
                  'and Tool Use is up too': second && second.d > 0 ? `and ${label(second.k)} is up too` : 'and the composite followed',
                  'Context Handling': weakest[0]?.dim || 'its weakest dimension',
                },
                card: {
                  agent: escHtml(r.display_name || r.handle),
                  composite: typeof cur.composite === 'number' ? Math.round(cur.composite) : undefined,
                  tier: cur.tier || undefined,
                  weak: weakest,
                },
                ctaUrl: `https://verigent.ai/agent/${r.handle}`,
              }).catch(() => ({ ok: false }));
              if ((res as any)?.ok) { checkinSent = true; checkins++; sent++; }
            }
          }
        } catch { /* fall through to the standings email */ }
      }
      if (checkinSent) continue;

      // 'weekly-registry' template (admin-edited copy). The standing figure lives one click away on
      // the report; substituting the standing into the phrase "here's where it stands on the public
      // board this week" keeps the email specific while degrading gracefully if Ant edits the line.
      const standing = r.tier ? `${r.tier}${typeof r.composite === 'number' ? ` · ${r.composite.toFixed(1)}` : ''}` : '';
      const res = await sendTemplateEmail(db, mailerFromEnv(env), 'weekly-registry', {
        to: r.email,
        vars: {
          'Your agent has been verified': `<strong>${r.handle}</strong> has been verified`,
          ...(standing ? { "here's where it stands on the public board this week": `this week it stands <strong>${standing}</strong> on the public board` } : {}),
        },
        ctaUrl: `https://verigent.ai/agent/${r.handle}`,
      }).catch(() => ({ ok: false }));
      if ((res as any)?.ok) sent++; else skipped++;
    }
  } else {
    skipped = (rows.results || []).length;
  }

  // Optional scorecard pass (?scorecards=1). Independent of the standings send above; gated off for
  // send-to-all unless SCORECARD_EMAIL_ENABLED, and supports ?sample=<handle> for a single preview.
  let scorecards: Awaited<ReturnType<typeof scorecardPass>> | undefined;
  if (url.searchParams.get('scorecards') === '1') {
    scorecards = await scorecardPass(env, url);
  }

  return Response.json({ ok: true, candidates: (rows.results || []).length, sent, checkins, skipped, scorecards }, { headers });
}

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => run(env, request);
export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => run(env, request);
