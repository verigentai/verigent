// GET /api/scorecard/:run_token — the operator-private dimension scorecard.
//
// Tiering (Ant-approved 2026-07-04; paid-signal corrected 2026-07-05, review 5kk #2):
//   • FREE (agent never topped up) → teaser only (composite, tier, top strength, top weakness, CTA).
//     No per-task feedback ever leaves for a free run. NOT keyed on run.attested — free tests also
//     attest since 5gg, so "attested" stopped meaning "paid".
//   • PAID (total_topped_up_cents > 0) → full scorecard. Default renders markdown (text/markdown, for
//     the signed download + the weekly email + the results-page section). ?format=json returns the
//     structured object; ?format=pdf is a planned fast-follow (503 for now — MD-first, don't block).
//
// Signature: the FULL scorecard requires a valid ?sig=<exp.sig> minted by signScorecardLink (keyed
// on SCORECARD_LINK_SECRET) — the link is private to the operator (email + signed link), so an
// unsigned request to an attested run gets the teaser, not the feedback. The teaser itself is
// low-sensitivity (it's already on the public report), so it needs no signature.
//
// PRIVACY: never returns another agent's feedback — the run_token + its signature scope the
// response to exactly one run.

import { buildScorecard, buildTeaser, renderScorecardMarkdown, renderTeaserMarkdown, verifyScorecardLink } from '../../lib/scorecard';
import type { ScorecardInput, ScorecardTaskRow } from '../../lib/scorecard';
import { isoWeekId } from '../../lib/weekly';

interface Env {
  DB: D1Database;
  SCORECARD_LINK_SECRET?: string;
}

const PERCENTILE_MIN_FIELD = 10;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const runToken = context.params.run_token as string;
  if (!runToken) return json({ error: 'run_token is required' }, 400);

  const db = context.env.DB;
  const url = new URL(context.request.url);
  const format = (url.searchParams.get('format') || 'markdown').toLowerCase();
  const sigParam = url.searchParams.get('sig');

  const run = await db.prepare('SELECT * FROM runs WHERE run_token = ?').bind(runToken).first() as any;
  if (!run) return json({ error: 'INVALID_RUN_TOKEN' }, 404);
  if (run.status !== 'completed') return json({ error: 'RUN_NOT_COMPLETE', status: run.status }, 202);

  const agent = await db.prepare('SELECT agent_id, handle, display_name, total_topped_up_cents FROM agents WHERE agent_id = ?')
    .bind(run.agent_id).first() as any;

  // Previous weekly snapshot for the composite delta (may be absent on a first week). Excludes the
  // CURRENT week: ensureWeeklySnapshot stamps the in-progress week on report views, so the latest row
  // usually holds THIS run's composite and the delta read +0 (review 5kk #9).
  const prevSnap = await db.prepare(
    'SELECT week_id, composite FROM weekly_snapshots WHERE agent_id = ? AND week_id < ? ORDER BY week_id DESC LIMIT 1'
  ).bind(run.agent_id, isoWeekId()).first().catch(() => null) as any;

  // Field size for the percentile gate. Only when >= PERCENTILE_MIN_FIELD do we build the
  // per-dimension distribution (the extra query is wasted below the gate).
  const fieldRow = await db.prepare('SELECT COUNT(*) as n FROM registry WHERE listed = 1')
    .first().catch(() => ({ n: 0 })) as any;
  const fieldSize = fieldRow?.n ?? 0;

  let dimensionScores: Record<string, number> = {};
  try { dimensionScores = JSON.parse(run.dimension_scores || '{}'); } catch {}
  let classScores: Record<string, number> = {};
  try { classScores = JSON.parse(run.class_scores || '{}'); } catch {}

  const baseInput: ScorecardInput = {
    run_token: runToken,
    handle: agent?.handle ?? null,
    display_name: agent?.display_name ?? null,
    composite: run.composite_score,
    tier: run.tier,
    primary_class: run.primary_class,
    attestation_vg_code: run.attestation_vg_code || null,
    attestation_txid: run.attestation_txid || null,
    completed_at: run.completed_at || null,
    dimension_scores: dimensionScores,
    class_scores: classScores,
    tasks: [],
    prev_snapshot: prevSnap ? { composite: prevSnap.composite ?? null, week_id: prevSnap.week_id ?? null } : null,
    field_size: fieldSize,
  };

  // PAID = the agent's wallet has actually been topped up. NOT run.attested: free first tests also
  // attest since 5gg (75b6f3a), so attested stopped implying paid — gating full on attested handed
  // the paid scorecard to every free run (review 5kk #2). Tested is free; paid is the wallet.
  const paid = ((agent?.total_topped_up_cents as number) || 0) > 0;

  // Teaser (abbreviated) responder — markdown by default (the copy-into-agent flow), JSON on ?format=json
  // (API consumers). Ant 2026-07-05: unpaid/unattested owners get the abbreviated MARKDOWN, not raw JSON.
  const teaserResponse = (extra: Record<string, unknown>) =>
    format === 'json'
      ? json({ tier_gate: 'teaser', ...extra, ...buildTeaser(baseInput) })
      : new Response(renderTeaserMarkdown(baseInput), {
          status: 200,
          headers: {
            'Content-Type': 'text/markdown; charset=utf-8',
            'Content-Disposition': `inline; filename="verigent-scorecard-${agent?.handle || runToken}-abbreviated.md"`,
          },
        });

  // ── FREE (never topped up) → teaser only (no feedback, no full table, no signature needed). ──
  if (!paid) {
    return teaserResponse({ paid: false });
  }

  // ── PAID but the full scorecard needs a valid signature. Unsigned → teaser. ──
  const signed = await verifyScorecardLink(runToken, sigParam, context.env.SCORECARD_LINK_SECRET);
  if (!signed) {
    return teaserResponse({ paid: true, signed: false });
  }

  // ── Full scorecard: load the per-task feedback + (above the gate) the field distribution. ──
  const taskRows = await db.prepare(
    'SELECT dimension, median_score, validated_score, judge_scores, scored_on FROM run_tasks WHERE run_token = ?'
  ).bind(runToken).all();
  const tasks: ScorecardTaskRow[] = (taskRows.results || []).map((t: any) => ({
    dimension: t.dimension,
    median_score: t.median_score,
    validated_score: t.validated_score,
    judge_scores: t.judge_scores,
    scored_on: t.scored_on,
  }));

  let fieldScores: Record<string, number[]> | undefined;
  if (fieldSize >= PERCENTILE_MIN_FIELD) {
    // Other agents' latest per-dimension scores, for the percentile. Only queried above the gate.
    const dist = await db.prepare(
      `SELECT dimension, COALESCE(validated_score, median_score, 0) AS score
         FROM run_tasks WHERE run_token IN (
           SELECT run_token FROM runs WHERE attested = 1 AND agent_id != ?
         )`
    ).bind(run.agent_id).all().catch(() => ({ results: [] }));
    fieldScores = {};
    for (const r of ((dist as any).results || [])) {
      (fieldScores[r.dimension] ||= []).push(r.score);
    }
  }

  const fullInput: ScorecardInput = { ...baseInput, tasks, field_scores: fieldScores };

  if (format === 'pdf') {
    // MD-first; PDF is a planned fast-follow (renders the same markdown server-side). Not a blocker.
    return json({ error: 'PDF_NOT_YET_AVAILABLE', hint: 'Use the default markdown; ?format=json for structured.' }, 503);
  }
  if (format === 'json') {
    return json({ tier_gate: 'full', attested: true, signed: true, ...buildScorecard(fullInput) });
  }
  // Default: markdown (download + email + results-page section).
  return new Response(renderScorecardMarkdown(fullInput), {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `inline; filename="verigent-scorecard-${agent?.handle || runToken}.md"`,
    },
  });
};
