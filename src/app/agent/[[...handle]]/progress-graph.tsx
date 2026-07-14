"use client";

// Progress dashboard — the test-analysis chart on the report card. Plots each agent's
// trajectory over continuous testing: composite + the 4 pillar averages by default, with
// drill-down to all dimensions. Every point is a real dated run; clicking one loads the
// full report-card snapshot AS OF that moment (the snapshot IS the data point — no extra
// storage). Data-only: NO advice. Bespoke SVG, zero chart-lib dependency.

import { useState } from "react";
import { TOTAL_COMPOSITE_DIMS } from "@/lib/dimensions";

export type HistoryRun = {
  composite: number | null;
  tier: string | null;
  dimension_scores: Record<string, number>;
  tested_at: string | null;
  run_token: string | null;
};
export type PillarMeta = { name: string; weight: string; dims: { key: string; dim: string }[] };

const COMPOSITE_COLOR = "#6d4ad6";
const PILLAR_COLOR: Record<string, string> = {
  Model: "#5b8def",
  Backbone: "#e0699e",
  Agent: "#9b7ddb",
  Sovereignty: "#2fa98c",
};
// Per-dimension tint = its pillar colour (kept legible; the legend names each).
function dimColor(pillar: string): string {
  return PILLAR_COLOR[pillar] || "#888";
}

function num(v: unknown): number | null {
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
}
function pillarAvg(scores: Record<string, number>, dims: { key: string }[]): number | null {
  const vals = dims.map((d) => num(scores[d.key])).filter((v): v is number => v !== null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
function fmtShort(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") || iso.includes(" ") ? iso.replace(" ", "T") + (iso.includes("Z") ? "" : "Z") : iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

type Series = { id: string; label: string; color: string; pillar?: string; valueOf: (r: HistoryRun) => number | null };

export default function ProgressGraph({
  history,
  pillars,
}: {
  history: HistoryRun[];
  pillars: PillarMeta[];
}) {
  // Chronological (API returns newest-first), keep only dated runs.
  const runs = [...history].filter((r) => r.tested_at).reverse();
  const [showDims, setShowDims] = useState(false);
  const [visible, setVisible] = useState<Set<string>>(
    () => new Set<string>(["__composite__", ...pillars.map((p) => `pillar:${p.name}`)]),
  );
  const [sel, setSel] = useState<number>(runs.length - 1);

  if (runs.length === 0) return null;

  // Series catalogue: composite, 4 pillars, then every dimension.
  const series: Series[] = [
    { id: "__composite__", label: "Composite", color: COMPOSITE_COLOR, valueOf: (r) => num(r.composite) },
    ...pillars.map((p) => ({
      id: `pillar:${p.name}`,
      label: p.name,
      color: PILLAR_COLOR[p.name] || "#888",
      valueOf: (r: HistoryRun) => pillarAvg(r.dimension_scores || {}, p.dims),
    })),
    ...pillars.flatMap((p) =>
      p.dims.map((d) => ({
        id: `dim:${d.key}`,
        label: d.dim,
        color: dimColor(p.name),
        pillar: p.name,
        valueOf: (r: HistoryRun) => num((r.dimension_scores || {})[d.key]),
      })),
    ),
  ];

  // Layout (responsive via viewBox).
  const W = 760, H = 320, padL = 30, padR = 14, padT = 14, padB = 30;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const xAt = (i: number) => (runs.length === 1 ? padL + innerW / 2 : padL + (i / (runs.length - 1)) * innerW);
  const yAt = (v: number) => padT + (1 - v / 100) * innerH;

  const visibleSeries = series.filter((s) => visible.has(s.id));
  const toggle = (id: string) =>
    setVisible((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // X-axis labels: thin them out so they never collide.
  const labelEvery = Math.max(1, Math.ceil(runs.length / 8));

  const selRun = runs[sel];

  return (
    <div className="pgraph">
      {/* Legend / series toggles */}
      <div className="pg-legend">
        <button
          className={`pg-chip${visible.has("__composite__") ? " on" : ""}`}
          style={{ ["--c" as string]: COMPOSITE_COLOR }}
          onClick={() => toggle("__composite__")}
        >
          <span className="pg-dot" /> Composite
        </button>
        {pillars.map((p) => (
          <button
            key={p.name}
            className={`pg-chip${visible.has(`pillar:${p.name}`) ? " on" : ""}`}
            style={{ ["--c" as string]: PILLAR_COLOR[p.name] || "#888" }}
            onClick={() => toggle(`pillar:${p.name}`)}
          >
            <span className="pg-dot" /> {p.name}
          </button>
        ))}
        <button className="pg-chip pg-more" onClick={() => setShowDims((s) => !s)}>
          {showDims ? "Hide dimensions" : `All ${TOTAL_COMPOSITE_DIMS} dimensions`}
        </button>
      </div>

      {showDims && (
        <div className="pg-dimlegend">
          {pillars.map((p) => (
            <div className="pg-dimgroup" key={p.name}>
              <div className="pg-dimgroup-h" style={{ color: PILLAR_COLOR[p.name] }}>{p.name}</div>
              {p.dims.map((d) => (
                <button
                  key={d.key}
                  className={`pg-chip sm${visible.has(`dim:${d.key}`) ? " on" : ""}`}
                  style={{ ["--c" as string]: dimColor(p.name) }}
                  onClick={() => toggle(`dim:${d.key}`)}
                >
                  <span className="pg-dot" /> {d.dim}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Chart */}
      <div className="pg-chartwrap">
        <svg className="pg-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Score trajectory over time">
          {/* gridlines + Y labels */}
          {[0, 25, 50, 75, 100].map((g) => (
            <g key={g}>
              <line className="pg-grid" x1={padL} y1={yAt(g)} x2={W - padR} y2={yAt(g)} />
              <text className="pg-ylab" x={padL - 6} y={yAt(g) + 3} textAnchor="end">{g}</text>
            </g>
          ))}

          {/* selected-run guide + clickable hit columns */}
          {runs.map((r, i) => (
            <g key={`hit-${i}`}>
              {i === sel && <line className="pg-guide" x1={xAt(i)} y1={padT} x2={xAt(i)} y2={padT + innerH} />}
              <rect
                className="pg-hit"
                x={xAt(i) - (innerW / Math.max(1, runs.length)) / 2}
                y={padT}
                width={innerW / Math.max(1, runs.length)}
                height={innerH}
                onClick={() => setSel(i)}
              >
                <title>{`${fmtShort(r.tested_at)} · composite ${r.composite != null ? Math.round(r.composite) : "—"}`}</title>
              </rect>
            </g>
          ))}

          {/* series lines + points */}
          {visibleSeries.map((s) => {
            const pts = runs
              .map((r, i) => ({ i, v: s.valueOf(r) }))
              .filter((p): p is { i: number; v: number } => p.v !== null);
            if (pts.length === 0) return null;
            const path = pts.map((p, k) => `${k === 0 ? "M" : "L"}${xAt(p.i).toFixed(1)} ${yAt(p.v).toFixed(1)}`).join(" ");
            const isComposite = s.id === "__composite__";
            return (
              <g key={s.id}>
                <path
                  className="pg-line"
                  d={path}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={isComposite ? 2.6 : 1.6}
                  strokeOpacity={isComposite ? 1 : 0.85}
                />
                {pts.map((p) => (
                  <circle
                    key={p.i}
                    className="pg-pt"
                    cx={xAt(p.i)}
                    cy={yAt(p.v)}
                    r={p.i === sel ? (isComposite ? 4.5 : 3.5) : isComposite ? 3 : 2}
                    fill={s.color}
                    onClick={() => setSel(p.i)}
                  >
                    <title>{`${s.label}: ${Math.round(p.v)} · ${fmtShort(runs[p.i].tested_at)}`}</title>
                  </circle>
                ))}
              </g>
            );
          })}

          {/* X labels */}
          {runs.map((r, i) =>
            i % labelEvery === 0 || i === runs.length - 1 ? (
              <text key={`xl-${i}`} className="pg-xlab" x={xAt(i)} y={H - 8} textAnchor="middle">
                {fmtShort(r.tested_at)}
              </text>
            ) : null,
          )}
        </svg>
      </div>

      {/* Snapshot of the selected run — the report card AS OF that point in time */}
      {selRun && (
        <div className="pg-snapshot">
          <div className="pg-snap-head">
            <div>
              <span className="pg-snap-date">{fmtShort(selRun.tested_at)}</span>
              <span className="pg-snap-meta">
                {selRun.tier || "—"} · composite {selRun.composite != null ? Math.round(selRun.composite) : "—"}
                {sel === runs.length - 1 ? " · latest" : ""}
              </span>
            </div>
            {selRun.run_token && (
              <a className="pg-snap-link" href={`/result?run=${encodeURIComponent(selRun.run_token)}`}>
                View this cert →
              </a>
            )}
          </div>
          <div className="pg-snap-grid">
            {pillars.map((p) => (
              <div className="pg-snap-pillar" key={p.name}>
                <div className="pg-snap-pillar-h" style={{ color: PILLAR_COLOR[p.name] }}>{p.name}</div>
                {p.dims.map((d) => {
                  const v = num((selRun.dimension_scores || {})[d.key]);
                  return (
                    <div className="pg-snap-row" key={d.key}>
                      <span className="pg-snap-dim">{d.dim}</span>
                      <span className="pg-snap-bar">
                        <span className="pg-snap-fill" style={{ width: `${v ?? 0}%`, background: PILLAR_COLOR[p.name] }} />
                      </span>
                      <span className="pg-snap-val">{v != null ? Math.round(v) : "—"}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
