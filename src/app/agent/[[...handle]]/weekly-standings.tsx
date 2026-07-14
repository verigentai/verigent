"use client";

// Weekly Standings — the "appointment-publication" reveal surface (P1-C of docs/WEEKLY-STANDINGS.md).
// Testing runs continuously in the background; THIS surface is the weekly publication ritual: the
// PUBLISHED figure only moves on the weekly drop. The register is a RATINGS-AGENCY / EXAM-BOARD /
// index update — NEVER a game. No leaderboard/league/level-up/XP/win language; no confetti, streaks
// or mascots. The credential (tier + composite) stays the hero; weekly movement is the "stay sharp"
// layer underneath. Reuses ProgressGraph for the weekly trajectory.
//
// Data: GET /api/agent/<handle>.weekly (FRONTEND-PROPOSED shape in docs/API-CONTRACTS.md; mocked via
// ?vgdemo=weekly until the backend weekly_snapshots table lands). Frozen numbers come from
// freshly-drawn random challenges (the challenge-draw moat) — never a fixed published challenge set.

import { useState } from "react";
import ProgressGraph, { type HistoryRun, type PillarMeta } from "./progress-graph";
import { tierName } from "@/lib/dimensions";

export type WeeklySnapshot = {
  week_id: string; // ISO week, e.g. "2026-W27"
  week_label: string; // human, e.g. "Week of 30 Jun"
  published_at: string | null;
  composite: number | null;
  tier: string | null;
  dimension_scores: Record<string, number>;
  class_scores?: Record<string, number>; // 12-class profile for the hero radar (gated to this week)
  delta_composite: number | null; // vs the previous published week; null = first week
  run_token: string | null; // links to that week's frozen cert
};

export type WeeklyData = {
  published_week: WeeklySnapshot | null; // the latest frozen drop = the public number
  personal_best: { composite: number; week_id: string; week_label: string } | null;
  is_personal_best: boolean; // did the latest drop set a new personal best?
  archive: WeeklySnapshot[]; // past published weeks, newest-first (excludes published_week)
};


const PILLAR_COLOR: Record<string, string> = {
  Model: "#5b8def", Backbone: "#e0699e", Agent: "#9b7ddb", Sovereignty: "#2fa98c",
};

function num(v: unknown): number | null {
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
}
function pillarAvg(scores: Record<string, number>, dims: { key: string }[]): number | null {
  const vals = dims.map((d) => num(scores[d.key])).filter((v): v is number => v !== null);
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
}
// The single calmest "sharpen next" nudge — lowest-scoring dimension this week. Functional, not
// loss-charged (copy firewall: positive functional framing only).
function weakestDim(scores: Record<string, number>, pillars: PillarMeta[]): { label: string; value: number } | null {
  let best: { label: string; value: number } | null = null;
  for (const p of pillars) {
    for (const d of p.dims) {
      const v = num(scores[d.key]);
      if (v === null) continue;
      if (!best || v < best.value) best = { label: d.dim, value: Math.round(v) };
    }
  }
  return best;
}

// Down weeks read as "the field keeps moving" (Red Queen), never "you fell". Up weeks stay flat and
// factual — no celebration. This is a publication, not a scoreboard.
function movementLabel(delta: number | null): { text: string; tone: "up" | "down" | "flat" | "new" } {
  if (delta === null) return { text: "First published result — your baseline.", tone: "new" };
  if (delta > 0) return { text: `+${delta} on last week's published score.`, tone: "up" };
  if (delta < 0) return { text: `${delta} on last week — the field keeps moving.`, tone: "down" };
  return { text: "Held last week's published score.", tone: "flat" };
}

function snapToHistoryRun(s: WeeklySnapshot): HistoryRun {
  return {
    composite: s.composite,
    tier: s.tier,
    dimension_scores: s.dimension_scores || {},
    tested_at: s.published_at,
    run_token: s.run_token,
  };
}

export default function WeeklyStandings({
  weekly,
  pillars,
  isOwner,
}: {
  weekly: WeeklyData;
  pillars: PillarMeta[];
  isOwner: boolean;
}) {
  const pub = weekly.published_week;
  const [openWeek, setOpenWeek] = useState<string | null>(null);
  if (!pub) return null;


  // Weekly trajectory feeds ProgressGraph: oldest → newest, published week last.
  const weeklyRuns: HistoryRun[] = [...weekly.archive].reverse().concat(pub).map(snapToHistoryRun);

  // The published-weeks list: current published week first, then the archive. No "results published"
  // card — the current standing already lives at the top of the report. Public = score + tier only.
  const publishedWeeks = [pub, ...weekly.archive];

  return (
    <div className="wkly">
      {/* Weekly trajectory — owner-only deeper view (reuses the continuous-run graph on weekly cadence). */}
      {isOwner && weeklyRuns.length > 1 && (
        <div className="wkly-graph">
          <ProgressGraph history={[...weeklyRuns].reverse()} pillars={pillars} />
        </div>
      )}

      {/* Published weeks — the history. Public: score + tier per week; owners can expand each. */}
      {publishedWeeks.length > 0 && (
        <div className="wkly-archive">
          <div className="wkly-arch-list">
            {publishedWeeks.map((w) => {
              const isOpen = openWeek === w.week_id;
              const wMove = movementLabel(w.delta_composite);
              return (
                <div className={`wkly-arch-row${isOpen && isOwner ? " open" : ""}`} key={w.week_id}>
                  {/* Public: score + tier only, no drill-down. Owners get the expandable breakdown. */}
                  {isOwner ? (
                    <button className="wkly-arch-head" onClick={() => setOpenWeek(isOpen ? null : w.week_id)}>
                      <span className="wkly-arch-week">{w.week_label}</span>
                      <span className="wkly-arch-comp">{w.composite != null ? Math.round(w.composite) : "—"}</span>
                      <span className="wkly-arch-tier">{w.tier ? `${w.tier} · ${tierName(w.tier)}` : "—"}</span>
                      <span className={`wkly-arch-move ${wMove.tone}`}>
                        {w.delta_composite === null ? "baseline" : w.delta_composite > 0 ? `+${w.delta_composite}` : `${w.delta_composite}`}
                      </span>
                    </button>
                  ) : (
                    <div className="wkly-arch-head wkly-arch-static">
                      <span className="wkly-arch-week">{w.week_label}</span>
                      <span className="wkly-arch-comp">{w.composite != null ? Math.round(w.composite) : "—"}</span>
                      <span className="wkly-arch-tier">{w.tier ? `${w.tier} · ${tierName(w.tier)}` : "—"}</span>
                    </div>
                  )}
                  {isOwner && isOpen && (
                    <div className="wkly-arch-detail">
                      <div className="wkly-arch-pillars">
                        {pillars.map((p) => {
                          const avg = pillarAvg(w.dimension_scores || {}, p.dims);
                          return (
                            <div className="wkly-arch-pillar" key={p.name}>
                              <span className="wkly-arch-pname" style={{ color: PILLAR_COLOR[p.name] || "#888" }}>{p.name}</span>
                              <span className="wkly-arch-bar">
                                <span className="wkly-arch-fill" style={{ width: `${avg ?? 0}%`, background: PILLAR_COLOR[p.name] || "#888" }} />
                              </span>
                              <span className="wkly-arch-pval">{avg ?? "—"}</span>
                            </div>
                          );
                        })}
                      </div>
                      {w.run_token && (
                        <a className="wkly-certlink sm" href={`/result?run=${encodeURIComponent(w.run_token)}`}>
                          View this week&apos;s cert →
                        </a>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
