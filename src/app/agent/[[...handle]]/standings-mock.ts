// Dev-only mock for GET /api/standings/<handle>. Used ONLY when ?vgdemo=weekly is in the URL, so
// production never fabricates a published number. Shape is the FRONTEND-PROPOSED contract documented
// in docs/API-CONTRACTS.md; once the backend weekly_snapshots endpoint lands this file is unused.

import { PILLARS as MANIFEST_PILLARS } from "@/lib/dimensions";
import type { WeeklyData, WeeklySnapshot } from "./weekly-standings";

const ALL_DIM_KEYS = MANIFEST_PILLARS.flatMap((p) => p.dims);
const CLASS_KEYS = ["sentinel","operative","analyst","architect","conduit","adaptor","steward","scout","sage","sovereign","trader","forge"];

// Deterministic pseudo-random in [0,1) from a seed — keeps demo screenshots stable (no Math.random).
function rnd(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function tierFor(composite: number): string {
  if (composite >= 90) return "V6";
  if (composite >= 82) return "V5";
  if (composite >= 72) return "V4";
  if (composite >= 60) return "V3";
  if (composite >= 45) return "V2";
  return "V1";
}

// Eight weeks of a gently-climbing agent with one down week — a realistic publication history.
const WEEK_COMPOSITES = [58, 61, 64, 63, 68, 71, 70, 74];
const WEEK_LABELS = [
  "Week of 12 May", "Week of 19 May", "Week of 26 May", "Week of 2 Jun",
  "Week of 9 Jun", "Week of 16 Jun", "Week of 23 Jun", "Week of 30 Jun",
];
const WEEK_IDS = [
  "2026-W20", "2026-W21", "2026-W22", "2026-W23",
  "2026-W24", "2026-W25", "2026-W26", "2026-W27",
];
const WEEK_DATES = [
  "2026-05-12T09:00:00Z", "2026-05-19T09:00:00Z", "2026-05-26T09:00:00Z", "2026-06-02T09:00:00Z",
  "2026-06-09T09:00:00Z", "2026-06-16T09:00:00Z", "2026-06-23T09:00:00Z", "2026-06-30T09:00:00Z",
];

function snapshot(i: number, handle: string): WeeklySnapshot {
  const composite = WEEK_COMPOSITES[i];
  const dimension_scores: Record<string, number> = {};
  ALL_DIM_KEYS.forEach((key, k) => {
    // Centre each dim near the week composite, spread ±14, clamped 0–100. Sovereignty dims run lower.
    const lean = key.includes("sovereignty") || key.includes("identity") || key.includes("infrastructure") ? -12 : 0;
    const v = composite + lean + Math.round((rnd(i * 100 + k) - 0.5) * 28);
    dimension_scores[key] = Math.max(0, Math.min(100, v));
  });
  const class_scores: Record<string, number> = {};
  CLASS_KEYS.forEach((k, c) => {
    const lean = k === "trader" ? -24 : k === "sovereign" ? -12 : 0;
    class_scores[k] = Math.max(0, Math.min(100, composite + lean + Math.round((rnd(i * 50 + c + 7) - 0.5) * 20)));
  });
  return {
    week_id: WEEK_IDS[i],
    week_label: WEEK_LABELS[i],
    published_at: WEEK_DATES[i],
    composite,
    tier: tierFor(composite),
    dimension_scores,
    class_scores,
    delta_composite: i === 0 ? null : composite - WEEK_COMPOSITES[i - 1],
    run_token: `demo-${handle}-${WEEK_IDS[i]}`,
  };
}

export function buildDemoStandings(handle: string): WeeklyData {
  const snaps = WEEK_COMPOSITES.map((_, i) => snapshot(i, handle));
  const published_week = snaps[snaps.length - 1];
  const archive = snaps.slice(0, -1).reverse(); // newest-first, excludes current
  // Personal best across all published weeks.
  const best = snaps.reduce((a, b) => ((b.composite ?? 0) > (a.composite ?? 0) ? b : a));
  const is_personal_best = (published_week.composite ?? 0) >= (best.composite ?? 0);
  return {
    published_week,
    personal_best: { composite: best.composite ?? 0, week_id: best.week_id, week_label: best.week_label },
    is_personal_best,
    archive,
  };
}
