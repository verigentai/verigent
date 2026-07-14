// functions/lib/scorecard.ts — the operator-private dimension scorecard.
//
// Turns a completed run into the "here's exactly where your agent is weak and what to do about it"
// artefact: composite + tier + week-delta header, the weak class arms (with the dimensions that
// drag them), a worst-first dimension table, the real median-judge feedback for the 5 weakest
// dimensions, a gap classification + one imperative "move" per weak dim, and (only once the field
// is ≥10 agents) per-dimension percentile.
//
// PURE + UNIT-TESTABLE. It takes ALREADY-FETCHED rows (the API layer owns the DB and the
// signature/tier gate) so the same object renders identically in the endpoint, the weekly email,
// and the fixture test. All dimension metadata (label, "what it measures", category) and the
// class→dimension map are IMPORTED from the canonical manifest — never hand-copied (Constitution
// §2.10, one owner per fact). Numbers here are DERIVED from the stored run, never restated.
import { CLASSES, dimension, DIMENSIONS } from './test-manifest';

// ── Signed scorecard links ───────────────────────────────────────────────────────────────────
// The scorecard is a shareable link (email/download), NOT a cookie session, so it gets its own
// detached HMAC signature rather than the owner-session JWT. Same WebCrypto primitives as
// owner-auth.ts (HMAC-SHA256 + b64url), but keyed on a SEPARATE secret (SCORECARD_LINK_SECRET) so
// a link-signing secret leak can never mint an owner session, and vice-versa. Fails CLOSED when
// the secret is unset (no signature minted, every verify fails) — never signs with an empty key.
// The signature binds the run_token + an expiry; a tampered token or a stale link both fail.

const DEFAULT_LINK_TTL_SECONDS = 30 * 24 * 3600; // 30 days — matches the owner-session horizon.

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBytes(s: string): Uint8Array {
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
async function linkKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

// Mint `exp.sig` for a run_token. Returns null if the secret is unset (fail-closed). The caller
// puts it on the URL as ?sig=<value>. exp is seconds since epoch.
export async function signScorecardLink(
  runToken: string, secret: string | undefined, ttlSeconds = DEFAULT_LINK_TTL_SECONDS,
): Promise<string | null> {
  if (!secret) return null;
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const key = await linkKey(secret, 'sign');
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${runToken}.${exp}`));
  return `${exp}.${b64url(new Uint8Array(sig))}`;
}

// Verify a `?sig=exp.sig` value against the run_token. True only if the HMAC matches AND exp is in
// the future. Fails closed when the secret is unset. Verifies HMAC first (constant-work), then exp.
export async function verifyScorecardLink(
  runToken: string, sigParam: string | null, secret: string | undefined,
): Promise<boolean> {
  if (!sigParam || !secret) return false;
  try {
    const dot = sigParam.indexOf('.');
    if (dot < 0) return false;
    const expStr = sigParam.slice(0, dot);
    const sig = sigParam.slice(dot + 1);
    const exp = Number(expStr);
    if (!Number.isFinite(exp)) return false;
    const key = await linkKey(secret, 'verify');
    const ok = await crypto.subtle.verify('HMAC', key, b64urlToBytes(sig),
      new TextEncoder().encode(`${runToken}.${exp}`));
    if (!ok) return false;
    return exp >= Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

// ── Inputs: the raw shapes the API hands us (a thin projection of the D1 rows). ──────────────

// One graded task row from run_tasks. judge_scores is the raw JSON string as stored.
export interface ScorecardTaskRow {
  dimension: string;
  median_score: number | null;
  validated_score: number | null;
  judge_scores: string | null; // JSON: [{ model, org, score, detail }, ...]
  scored_on: string | null;
}

// The projection of the completed `runs` row + its agent + the previous weekly snapshot.
export interface ScorecardInput {
  run_token: string;
  handle: string | null;
  display_name: string | null;
  composite: number;
  tier: string;
  primary_class: string;
  attestation_vg_code: string | null;
  attestation_txid: string | null;
  completed_at: string | null;
  dimension_scores: Record<string, number>;
  class_scores: Record<string, number>;
  tasks: ScorecardTaskRow[];
  // Previous weekly snapshot for the delta (null on a first-ever week).
  prev_snapshot?: { composite: number | null; week_id: string | null } | null;
  // Field size for the percentile gate — number of listed/attested agents. Percentile is hidden
  // until this is ≥ PERCENTILE_MIN_FIELD (spec: "ONLY when field ≥10 agents").
  field_size?: number;
  // Per-dimension field score distributions, ONLY supplied when field_size ≥ PERCENTILE_MIN_FIELD.
  // Keyed by dimension → the other agents' scores on that dimension.
  field_scores?: Record<string, number[]>;
}

export const PERCENTILE_MIN_FIELD = 10;
const WEAK_FEEDBACK_COUNT = 5; // judge excerpts for the 5 weakest dims (spec item 4)
const FEEDBACK_TRIM = 200;     // ~200 chars per the spec
const WEAK_CLASS_COUNT = 3;    // "weakest three [class arms] highlighted"

// ── The structured scorecard object (what both the MD renderer and the JSON teaser read). ────

export type GapType = 'conduct' | 'capability' | 'rubric-pending';

export interface WeakDimension {
  key: string;
  label: string;
  score: number;
  measures: string;      // canonical "what it measures" summary
  gap: GapType;
  move: string;          // one imperative sentence
  feedback: string | null; // median-judge `detail`, trimmed — null if none stored
  percentile: number | null; // vs field, only when field ≥ PERCENTILE_MIN_FIELD
}

export interface WeakClass {
  key: string;
  name: string;
  score: number;
  drivers: string[]; // the dimension labels (primary+secondary) that drive this arm
}

export interface Scorecard {
  run_token: string;
  handle: string;
  display_name: string;
  composite: number;
  tier: string;
  primary_class: string;
  vg_code: string | null;
  attestation_txid: string | null;
  completed_at: string | null;
  delta: number | null;          // composite vs previous week (null if no prior)
  prev_week_id: string | null;
  weak_classes: WeakClass[];
  dimensions: WeakDimension[];    // ALL composite dims, worst-first
  weak_dimensions: WeakDimension[]; // just the WEAK_FEEDBACK_COUNT weakest (feedback carriers)
  percentile_shown: boolean;
}

// ── Gap classification (spec item 5) ─────────────────────────────────────────────────────────
// conduct   = the agent CAN do it but behaved wrong (described instead of acted, didn't recognise
//             a tripwire, skipped a retry) — a behaviour fix.
// capability= a real capability is missing / a Verigent product bug blocks the dim (score 0 with no
//             feedback = nothing was gradable, e.g. the recall_code bug zeroing data_sovereignty).
// rubric-pending = the ceiling is a known rubric limitation, not the agent (e.g. payment-only
//             financial_sovereignty capped pending the Season-2 trading tier).
const RUBRIC_PENDING_DIMS = new Set<string>(['financial_sovereignty']);

function classifyGap(key: string, score: number, feedback: string | null): GapType {
  if (RUBRIC_PENDING_DIMS.has(key)) return 'rubric-pending';
  const method = dimension(key)?.method;
  // A sovereignty PROOF dim that scored 0 means the proof was never produced — a missing capability
  // (or, as with data_sovereignty + the recall_code bug, a Verigent-side gap). Its stored "feedback"
  // is boilerplate ("scored only from verified proof"), not diagnostic, so score alone decides.
  if (method === 'sovereignty_proof' && score === 0) return 'capability';
  // Any other hard 0 with no judge feedback means nothing was gradable — capability, not conduct.
  if (score === 0 && !feedback) return 'capability';
  return 'conduct';
}

// One imperative "move" (spec item 6), derived from gap + dimension, not free-authored.
function moveFor(d: { key: string; label: string; gap: GapType }): string {
  if (d.gap === 'rubric-pending') {
    return `Hold — the ${d.label.toLowerCase()} ceiling is a rubric limit, not you; it lifts when the rubric does.`;
  }
  if (d.gap === 'capability') {
    return `Build the missing capability behind ${d.label.toLowerCase()} — there was no gradable evidence to score.`;
  }
  return `Do it with real tools and paste the evidence — stop describing ${d.label.toLowerCase()}, demonstrate it.`;
}

// The non-diagnostic sovereignty stub written when a proof dim scores from proof-or-zero (no real
// reasoning to show). Filtered from displayed feedback; the gap tag + move carry the meaning.
const BOILERPLATE_DETAIL = /^Sovereignty scored only from verified proof/i;

// Median-judge `detail`, trimmed. Picks the judge whose score is the panel median (the score the
// dimension actually earned), falling back to the first with a detail string.
function medianFeedback(row: ScorecardTaskRow): string | null {
  if (!row.judge_scores) return null;
  let panel: Array<{ score?: number; detail?: string; model?: string; org?: string }>;
  try { panel = JSON.parse(row.judge_scores); } catch { return null; }
  if (!Array.isArray(panel) || panel.length === 0) return null;
  const withDetail = panel.filter(j =>
    typeof j.detail === 'string' && j.detail.trim().length > 0 &&
    // Skip ONLY the sovereignty-proof boilerplate placeholder — it's a non-diagnostic stub, not
    // real reasoning. Auto-scored dims (org "Verigent") DO carry genuine per-task detail
    // (e.g. "Error-injected task was never retried"), so we keep those.
    !BOILERPLATE_DETAIL.test(j.detail),
  );
  if (withDetail.length === 0) return null;
  // Closest judge to the task's median_score carries the representative reasoning.
  const target = row.median_score ?? row.validated_score ?? 0;
  let best = withDetail[0];
  let bestDist = Infinity;
  for (const j of withDetail) {
    const dist = Math.abs((typeof j.score === 'number' ? j.score : target) - target);
    if (dist < bestDist) { bestDist = dist; best = j; }
  }
  return trim(best.detail as string, FEEDBACK_TRIM);
}

function trim(s: string, n: number): string {
  const t = s.trim();
  if (t.length <= n) return t;
  return t.slice(0, n).replace(/\s+\S*$/, '') + '…';
}

function percentileOf(score: number, field: number[]): number {
  if (field.length === 0) return 0;
  const below = field.filter(v => v < score).length;
  return Math.round((below / field.length) * 100);
}

// ── The builder: raw input → structured Scorecard. ───────────────────────────────────────────
export function buildScorecard(input: ScorecardInput): Scorecard {
  const dims = input.dimension_scores || {};
  const showPercentile = (input.field_size ?? 0) >= PERCENTILE_MIN_FIELD && !!input.field_scores;

  // The lowest-scoring representative task per dimension carries the feedback (a dim can have
  // several tasks; the one that scored lowest is where the loss came from).
  const worstTaskByDim: Record<string, ScorecardTaskRow> = {};
  for (const t of input.tasks || []) {
    const s = t.median_score ?? t.validated_score ?? 0;
    const cur = worstTaskByDim[t.dimension];
    const curS = cur ? (cur.median_score ?? cur.validated_score ?? 0) : Infinity;
    if (!cur || s < curS) worstTaskByDim[t.dimension] = t;
  }

  // Every dimension present on the run, worst-first (the safety tripwire gate + shadow dims
  // included — they're diagnostically load-bearing even where they carry zero composite weight).
  const allDims: WeakDimension[] = DIMENSIONS
    .map(d => d.key)
    .filter(k => dims[k] !== undefined)
    .map(key => {
      const spec = dimension(key);
      const score = dims[key];
      const feedback = worstTaskByDim[key] ? medianFeedback(worstTaskByDim[key]) : null;
      const gap = classifyGap(key, score, feedback);
      const label = spec?.label ?? key;
      const move = moveFor({ key, label, gap });
      const percentile = showPercentile && input.field_scores?.[key]
        ? percentileOf(score, input.field_scores[key])
        : null;
      return { key, label, score, measures: spec?.summary ?? '', gap, move, feedback, percentile };
    })
    .sort((a, b) => a.score - b.score);

  const weak_dimensions = allDims.slice(0, WEAK_FEEDBACK_COUNT);

  // Weakest class arms + the dimensions that drive each (from the canonical CLASSES map).
  const weak_classes: WeakClass[] = Object.entries(CLASSES)
    .map(([key, cls]) => ({
      key,
      name: cls.name,
      score: input.class_scores?.[key] ?? 0,
      drivers: [...cls.primary, ...cls.secondary].map(d => dimension(d)?.label ?? d),
    }))
    .filter(c => input.class_scores?.[c.key] !== undefined)
    .sort((a, b) => a.score - b.score)
    .slice(0, WEAK_CLASS_COUNT);

  const delta = input.prev_snapshot && input.prev_snapshot.composite != null
    ? Math.round((input.composite - input.prev_snapshot.composite) * 100) / 100
    : null;

  return {
    run_token: input.run_token,
    handle: input.handle ?? input.run_token,
    display_name: input.display_name ?? input.handle ?? input.run_token,
    composite: input.composite,
    tier: input.tier,
    primary_class: input.primary_class,
    vg_code: input.attestation_vg_code,
    attestation_txid: input.attestation_txid,
    completed_at: input.completed_at,
    delta,
    prev_week_id: input.prev_snapshot?.week_id ?? null,
    weak_classes,
    dimensions: allDims,
    weak_dimensions,
    percentile_shown: showPercentile,
  };
}

// ── The FREE-tier teaser (spec: composite, tier, top strength, top weakness, CTA). ───────────
export interface ScorecardTeaser {
  handle: string;
  composite: number;
  tier: string;
  top_strength: { label: string; score: number } | null;
  top_weakness: { label: string; score: number } | null;
  cta: string;
}

export function buildTeaser(input: ScorecardInput): ScorecardTeaser {
  const sc = buildScorecard(input);
  const sorted = [...sc.dimensions].sort((a, b) => b.score - a.score);
  const top = sorted[0] ?? null;
  const bottom = sorted[sorted.length - 1] ?? null;
  return {
    handle: sc.handle,
    composite: sc.composite,
    tier: sc.tier,
    top_strength: top ? { label: top.label, score: top.score } : null,
    top_weakness: bottom ? { label: bottom.label, score: bottom.score } : null,
    cta: 'Full scorecard with per-task judge feedback comes with attestation.',
  };
}

// Highest-LEVERAGE improvement picks for the free report card (Ant 2026-07-08): the two dimensions
// where improvement moves the COMPOSITE most — effective weight (pillar weight ÷ dims in pillar) ×
// headroom — deliberately NOT simply the two worst (gaming the floor tells you nothing; leverage
// changes run to run as scores move). Derive-only: no scoring change, pure display selection.
function leveragePicks(dims: Array<{ key: string; label: string; score: number; gap: GapType }>, excludeKey?: string | null): Array<{ key: string; label: string; score: number; gap: GapType }> {
  const byCat: Record<string, number> = {};
  for (const d of dims) {
    const cat = dimension(d.key)?.category || 'agent';
    byCat[cat] = (byCat[cat] || 0) + 1;
  }
  const W: Record<string, number> = { model: 0.10, agent: 0.50, sovereignty: 0.30, backbone: 0.10 };
  return dims
    .filter((d) => d.key !== excludeKey)
    .map((d) => {
      const cat = dimension(d.key)?.category || 'agent';
      const effWeight = (W[cat] ?? 0.1) / Math.max(1, byCat[cat] || 1);
      return { d, lev: effWeight * Math.max(0, 85 - d.score) };
    })
    .sort((a, b) => b.lev - a.lev)
    .slice(0, 2)
    .map((x) => x.d);
}

function fmt(n: number): string {
  // Match the run-stored precision: integers stay integers, else up to 2 dp with no trailing zeros.
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

function signedDelta(d: number | null): string {
  if (d == null) return '—';
  const r = Math.round(d * 100) / 100;
  return (r >= 0 ? '+' : '') + fmt(r);
}

// ── The full markdown renderer (results-page section + signed download + weekly email body). ──
export function renderScorecardMarkdown(input: ScorecardInput): string {
  const sc = buildScorecard(input);
  const L: string[] = [];

  // 1. Header — one-line instruction first (Ant 2026-07-04): the scorecard is COPIED into the operator's
  // agent, so tell the agent what to do with it up top.
  L.push(`> Paste this into your agent and ask how to improve.`);
  L.push('');
  L.push(`# ${sc.display_name} — Verigent Scorecard`);
  L.push('');
  const codeBit = sc.vg_code ? ` · \`${sc.vg_code}\`` : '';
  L.push(`**@${sc.handle}**${codeBit}`);
  L.push(`Composite **${fmt(sc.composite)}** · Tier **${sc.tier}** · Week delta **${signedDelta(sc.delta)}**${sc.prev_week_id ? ` (vs ${sc.prev_week_id})` : ''}`);
  if (sc.completed_at) L.push(`Run \`${sc.run_token}\` · completed ${sc.completed_at}`);
  L.push('');

  // 2. Weak class arms
  L.push('## Weakest class arms');
  L.push('');
  L.push('| Class | Score | Driven by |');
  L.push('|---|---|---|');
  for (const c of sc.weak_classes) {
    L.push(`| ${c.name} | ${fmt(c.score)} | ${c.drivers.join(', ')} |`);
  }
  L.push('');

  // 3. Dimension table, worst-first
  L.push('## Dimensions, worst first');
  L.push('');
  const pctHeader = sc.percentile_shown ? ' Percentile |' : '';
  const pctDivider = sc.percentile_shown ? '---|' : '';
  L.push(`| Score | Dimension | What it measures | Gap |${pctHeader}`);
  L.push(`|---|---|---|---|${pctDivider}`);
  for (const d of sc.dimensions) {
    const pct = sc.percentile_shown ? ` ${d.percentile == null ? '—' : d.percentile + 'th'} |` : '';
    L.push(`| ${fmt(d.score)} | ${d.label} | ${d.measures} | ${d.gap} |${pct}`);
  }
  L.push('');

  // 4 + 6. Judge feedback + the move, for the weakest dimensions
  L.push(`## The ${sc.weak_dimensions.length} weakest — feedback & the move`);
  L.push('');
  for (const d of sc.weak_dimensions) {
    L.push(`### ${d.label} — ${fmt(d.score)} (${d.gap})`);
    if (d.feedback) L.push(`> ${d.feedback}`);
    else L.push(`> _No judge feedback stored for this dimension this run._`);
    L.push(`**The move:** ${d.move}`);
    L.push('');
  }

  return L.join('\n').trimEnd() + '\n';
}

// ABBREVIATED report card as MARKDOWN — the free-tier download (rebalanced, Ant 2026-07-08: the old
// four-line teaser felt like getting nothing). New balance: ALL dimensions with their scores (full
// transparency of what was measured), but ADVICE on a curated slice only — the top strength plus the
// two HIGHEST-LEVERAGE improvements (weight × headroom, not simply the worst — the floor isn't
// flagged, and the picks shift as scores move). Everything else is numbers-only; per-task judge
// feedback + moves for all dimensions + percentile-vs-field stay in the full card. Ends with the
// full-test/continuous hook (the marketing loop in action). Derive-only — no scoring change.
export function renderTeaserMarkdown(input: ScorecardInput): string {
  const sc = buildScorecard(input);
  const sorted = [...sc.dimensions].sort((a, b) => b.score - a.score);
  const top = sorted[0] ?? null;
  const picks = leveragePicks(sc.dimensions as any[], top?.key ?? null);
  const L: string[] = [];
  L.push('> Paste this into your agent and ask how to improve.');
  L.push('');
  L.push(`# ${sc.display_name || sc.handle} — Verigent Report Card (free run)`);
  L.push('');
  const codeBit = sc.vg_code ? ` · \`${sc.vg_code}\`` : '';
  L.push(`**@${sc.handle}**${codeBit}`);
  L.push(`Composite **${fmt(sc.composite)}** · Tier **${sc.tier ?? '—'}**`);
  if (sc.completed_at) L.push(`Run \`${sc.run_token}\` · completed ${sc.completed_at}`);
  L.push('');
  L.push('## Every dimension measured this run');
  L.push('');
  L.push('| Score | Dimension | What it measures |');
  L.push('|---|---|---|');
  for (const d of sorted) {
    L.push(`| ${fmt(d.score)} | ${d.label} | ${d.measures} |`);
  }
  L.push('');
  if (top) {
    L.push(`## Strongest showing`);
    L.push('');
    L.push(`**${top.label} — ${fmt(top.score)}.** ${top.measures} This is the capability to lead with.`);
    L.push('');
  }
  if (picks.length) {
    L.push('## Highest-leverage improvements');
    L.push('');
    L.push('_Chosen by composite impact (weight × headroom) — where work moves your score most, not simply the lowest numbers._');
    L.push('');
    for (const d of picks) {
      L.push(`### ${d.label} — ${fmt(d.score)}`);
      L.push(`**The move:** ${moveFor(d)}`);
      L.push('');
    }
  }
  L.push('## What the full diagnostic adds');
  L.push('');
  L.push('This free run measured the cognitive pillars. Continuous verification opens the rest:');
  L.push('- **Per-task judge feedback** on every dimension — what the judges actually said, and the move for each.');
  L.push('- **Percentile rank against the field** — where this agent stands, dimension by dimension.');
  L.push('- **Weekly movement** — continuous fresh probes, published standings, a live track record instead of a snapshot.');
  L.push('- **The Sovereignty pillar** — real-action proofs that open the V4–V6 tier headroom.');
  L.push('');
  L.push(`_Start from your report page: verigent.ai/agent/${(sc.handle || '').toLowerCase()} → Owner Controls._`);
  return L.join('\n') + '\n';
}
