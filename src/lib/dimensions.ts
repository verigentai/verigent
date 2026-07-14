// src/lib/dimensions.ts — the website's SINGLE source for the battery's dimension catalogue.
//
// Everything here DERIVES from the canonical backend manifest (functions/lib/test-manifest.ts,
// backend-owned, read-only). Add a dimension to the manifest and it appears across the site
// automatically — under the right pillar, with the right label/summary, and the counts update —
// with ZERO edits here or in the pages. Never re-list dimensions in a page; import from this file.

import {
  COMPOSITE_DIMENSIONS,
  COMPOSITE_WEIGHTS,
  BACKBONE_DIMENSIONS,
  TIERS,
  CLASSES,
  type DimensionSpec,
  type MeasuredFrom,
} from "../../functions/lib/test-manifest";
// The emitted seam carries the assembled shadow-dim metadata (label/method/howTested). Shadow dims
// are ADMIN-ONLY and never enter the composite — the drift gate asserts each stays weight 0.
import testSpec from "../../public/test-spec.json";

export type { DimensionSpec, MeasuredFrom };

// The 4 composite pillars in site display order. Membership + weight DERIVE from the manifest;
// only the presentation order of the four categories is fixed here.
type PillarKey = "model" | "backbone" | "agent" | "sovereignty";
const PILLAR_ORDER: { key: PillarKey; name: string }[] = [
  { key: "model", name: "Model" },
  { key: "backbone", name: "Backbone" },
  { key: "agent", name: "Agent" },
  { key: "sovereignty", name: "Sovereignty" },
];
const pct = (w: number) => `${Math.round(w * 100)}%`;

export type Pillar = { key: PillarKey; name: string; weight: string; dims: string[]; specs: DimensionSpec[] };

export const PILLARS: Pillar[] = PILLAR_ORDER.map((p) => {
  const specs = COMPOSITE_DIMENSIONS.filter((d) => d.category === p.key);
  return { key: p.key, name: p.name, weight: pct(COMPOSITE_WEIGHTS[p.key]), dims: specs.map((d) => d.key), specs };
});

// key → human label / one-line summary, straight from the manifest.
export const DIM_LABEL: Record<string, string> = Object.fromEntries(COMPOSITE_DIMENSIONS.map((d) => [d.key, d.label]));
export const DIM_SUMMARY: Record<string, string> = Object.fromEntries(COMPOSITE_DIMENSIONS.map((d) => [d.key, d.summary]));

const dimsOf = (k: PillarKey): string[] => PILLARS.find((p) => p.key === k)?.dims ?? [];
export const MODEL_DIM_KEYS = dimsOf("model");
export const AGENT_DIM_KEYS = dimsOf("agent");
export const SOVEREIGNTY_DIM_KEYS = dimsOf("sovereignty");
export const BACKBONE_DIMS: string[] = [...BACKBONE_DIMENSIONS];
export const COMPOSITE_DIM_KEYS: string[] = COMPOSITE_DIMENSIONS.map((d) => d.key);

// label/summary lookups with a manifest fallback — a page can override copy for the dims it has
// polished prose for; any dim NOT in the override (e.g. a brand-new one) falls back to the manifest.
export const labelOf = (key: string, override?: Record<string, string>): string => override?.[key] ?? DIM_LABEL[key] ?? key;
export const summaryOf = (key: string, override?: Record<string, string>): string => override?.[key] ?? DIM_SUMMARY[key] ?? "";

// Proof-scored dimensions — DERIVED from the manifest method (sovereignty_proof), never hand-listed.
// These dims score ONLY from real verified proof (a signed payment / signature / webhook HMAC /
// cross-session recall) or a bound eval — the per-task TEXT answer always scores 0 by design
// (grade-batch.ts autoScoreTask). Display surfaces use this to badge those 0s as "scored from proof"
// so a legitimate 0 never reads as a failed task.
export const PROOF_SCORED_DIMS: Set<string> = new Set(
  COMPOSITE_DIMENSIONS.filter((d) => d.method === "sovereignty_proof").map((d) => d.key),
);
export const isProofScoredDim = (key: string): boolean => PROOF_SCORED_DIMS.has(key);

// ── measuredFrom — WHEN a dimension's evidence can first exist (manifest-owned, derived here). ──
// The site uses this to show, HONESTLY and up-front, what a given run can and cannot measure:
//   'longitudinal' — needs a prior run to corroborate (cross-run memory). Unmeasurable on run 1; a
//                    paid/continuous viewer sees "measurement starts on your next run", a free/public
//                    viewer sees the positive "measured on continuous verification".
//   'paid'         — needs a real action only the paid Sovereignty tier performs. Already surfaced by
//                    the existing sovereignty lock/overlay; DIM_MEASURED_FROM keeps the two in sync.
// Never hand-list dims by name on a page — read DIM_MEASURED_FROM / measuredFromOf so the states move
// with the manifest (e.g. if a dim's measurability changes, or channel_reach shifts pillars).
export const DIM_MEASURED_FROM: Record<string, MeasuredFrom> = Object.fromEntries(
  COMPOSITE_DIMENSIONS.map((d) => [d.key, d.measuredFrom]),
);
export const measuredFromOf = (key: string): MeasuredFrom => DIM_MEASURED_FROM[key] ?? "run1";
export const isLongitudinalDim = (key: string): boolean => measuredFromOf(key) === "longitudinal";
export const isPaidDim = (key: string): boolean => measuredFromOf(key) === "paid";

// ── Honest first-run state copy — DEFINED ONCE, used identically across report / track / result ──
// (Ant 2026-07-07, locked). Copy firewall: positive functional framing only — never fear, never
// "expires", never churn language. Two audiences for a not-yet-measurable dimension:
//   • the paid/continuous owner on their FIRST run — it genuinely lands next run, so say so plainly;
//   • the free/public viewer who never gets a run 2 — frame it as what continuous verification adds.
// PROVISIONAL is the small, honest composite qualifier when a shown dim isn't measured yet.
export const MEASURE_STATE_COPY = {
  // longitudinal (cross-run memory) — the run-1 pending state. Short pill labels (Ant 2026-07-07 — the
  // full-sentence version bunched up on the dimension row); the full explanation stays in the expanded
  // row + a hover title on the pill.
  longitudinalPaid: "Starts next run",
  longitudinalFree: "Tested continuously",
  // paid/sovereignty tier — mirrors the existing sovereignty overlay grammar
  paidOwner: "Included in the paid tier",
  paidPublic: "Measured on continuous verification",
  // composite qualifier when any shown dimension is still pending this run
  provisional: "Provisional",
  provisionalNote:
    "Provisional — one or more dimensions are measured from your next run onward, so they're not yet in this score.",
} as const;

// Counts — derived, never hardcoded.
export const TOTAL_COMPOSITE_DIMS = COMPOSITE_DIMENSIONS.length;
export const PILLAR_COUNT = PILLARS.length;
export const BACKBONE_COUNT = BACKBONE_DIMENSIONS.length;

// ── Tiers + classes — canonical names/codes from the manifest (the seam). Never hardcode these in a
// page (tier names drifted across email/grade/result once; the VG-key class codes must match the cert). ──
export type TierInfo = { tier: string; name: string; minComposite: number; requiresSovereignty: boolean };
export const TIER_LIST: TierInfo[] = TIERS.map((t) => ({ tier: t.tier, name: t.name, minComposite: t.minComposite, requiresSovereignty: t.requiresSovereignty }));
// V1→"Verified" … V6→"Apex"
export const TIER_NAMES: Record<string, string> = Object.fromEntries(TIER_LIST.map((t) => [t.tier, t.name]));
export const tierName = (tier: string | null | undefined): string => (tier && TIER_NAMES[tier]) || "Verified";

export type ClassInfo = { key: string; name: string; code: string };
// In VG-key radar order (manifest declaration order = Se Op An Ar Co Ad St Sc Sa So Tr Fo).
export const CLASS_LIST: ClassInfo[] = Object.entries(CLASSES).map(([key, c]: [string, any]) => ({ key, name: c.name, code: c.code }));
export const CLASS_KEYS: string[] = CLASS_LIST.map((c) => c.key);
export const CLASS_CODES: Record<string, string> = Object.fromEntries(CLASS_LIST.map((c) => [c.key, c.code]));
// class → its constituent composite dimensions (primary + secondary), straight from the manifest.
// Used to map per-dimension probe detail onto the 12 radar class axes (within-class consistency spread).
export const CLASS_DIMS: Record<string, string[]> = Object.fromEntries(
  Object.entries(CLASSES).map(([key, c]: [string, any]) => [key, [...(c.primary ?? []), ...(c.secondary ?? [])]]),
);
export const CLASS_NAMES: Record<string, string> = Object.fromEntries(CLASS_LIST.map((c) => [c.key, c.name]));

// Battery version — bump when the dimension set, weights, or scoring rubric change in a way that
// would move scores. Surfaced on reports so a score is always read against the battery that produced
// it; stored scores are snapshots and are never retro-recomputed when the battery advances.
export const BATTERY_VERSION = "1.0";

// Current scoring-rubric (band) version. One owner in the front-end lane for static copy; the per-RUN
// version is authoritative from the API (checkpoints.rubric_version, now echoed on /api/result +
// /api/agent). Prefer the live field where a run's data is available; use this constant only for
// version-agnostic marketing copy (e.g. the FAQ).
// F1 (review 2026-07-09): DERIVE from the one owner (rubric-bands.ts → emitted into test-spec.json),
// never a hardcoded literal — this shim showed "v4" while the rubric was v5/v6 (contradictory on-screen).
export const RUBRIC_VERSION = (testSpec as { rubric_version?: string }).rubric_version ?? "v6";

// ── Shadow / calibration dims. Split boundary (Codex H4, narrowed by Ant 2026-07-14):
//   • PUBLIC — names/summaries only (shadow_public in test-spec.json): what is being calibrated,
//     zero weight, target pillar. Derived below for the public /dimensions page (§2.6 transparency).
//   • ADMIN-ONLY — method/howTested calibration detail: never enters the client bundle; the admin
//     Calibration panel fetches it at runtime from the admin-authed GET /api/admin/shadow-dims.
// The drift gate whitelists the public fields and fails the build if calibration detail leaks. ──
export interface ShadowDim {
  key: string;
  label: string;
  method: string;
  howTested: string;
  targetBucket: string;
  status: string;
  weight: number;
}

export type ShadowPublicDim = { key: string; label: string; summary: string; targetBucket: string; weight: 0; status: "shadow" };
const shadowBlock = (testSpec as { shadow_public?: { note?: string; dims?: ShadowPublicDim[] } }).shadow_public;
export const SHADOW_PUBLIC_DIMS: ShadowPublicDim[] = shadowBlock?.dims ?? [];
export const SHADOW_PUBLIC_NOTE: string = shadowBlock?.note ?? "";
export const SHADOW_PUBLIC_COUNT = SHADOW_PUBLIC_DIMS.length;
