"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

const CLASSES = [
  "Sentinel", "Operative", "Analyst", "Architect", "Conduit", "Adaptor",
  "Steward", "Scout", "Sage", "Sovereign", "Trader", "Forge",
] as const;

const CLASS_KEYS = [
  "sentinel", "operative", "analyst", "architect", "conduit", "adaptor",
  "steward", "scout", "sage", "sovereign", "trader", "forge",
] as const;

// growth-stage history layers — the site's lavender-grey (reads on the dark page)
const LAYS = [
  { f: "#aab0dc", o: 0.1, s: "#aab0dc", so: 0.22 },
  { f: "#aab0dc", o: 0.12, s: "#aab0dc", so: 0.28 },
  { f: "#9aa0cc", o: 0.14, s: "#9aa0cc", so: 0.34 },
  { f: "#8b91c4", o: 0.16, s: "#8b91c4", so: 0.42 },
];

// Rounded-corner path for a closed polygon. `radius` is clamped per-corner so it never overshoots
// the shorter adjacent edge. This is what softens every score shape (replaces the old sharp polygons).
function roundedPath(pts: [number, number][], radius: number): string {
  const m = pts.length;
  let d = "";
  for (let i = 0; i < m; i++) {
    const prev = pts[(i - 1 + m) % m];
    const curr = pts[i];
    const next = pts[(i + 1) % m];
    const v1x = curr[0] - prev[0], v1y = curr[1] - prev[1];
    const v2x = next[0] - curr[0], v2y = next[1] - curr[1];
    const l1 = Math.hypot(v1x, v1y) || 1;
    const l2 = Math.hypot(v2x, v2y) || 1;
    const rr = Math.min(radius, l1 / 2, l2 / 2);
    const bx = curr[0] - (v1x / l1) * rr, by = curr[1] - (v1y / l1) * rr;
    const ax = curr[0] + (v2x / l2) * rr, ay = curr[1] + (v2y / l2) * rr;
    d += (i === 0 ? "M" : "L") + ` ${bx.toFixed(2)} ${by.toFixed(2)} `;
    d += `Q ${curr[0].toFixed(2)} ${curr[1].toFixed(2)} ${ax.toFixed(2)} ${ay.toFixed(2)} `;
  }
  return d + "Z";
}

interface RadarChartProps {
  current: Record<string, number>;
  history?: Record<string, number>[];
  size?: number;
  showLabels?: boolean;
  centerLabel?: string;
  // Optional class line under the centre name (e.g. "Scout") — same font, half the size, dimmer.
  centerSub?: string;
  // PROTOTYPE — bring the sprite to life (report surface only). `freshness` drives saturation so a
  // continuously-verified agent visibly shines and a neglected one fades. Both are additive: with
  // alive=false and no freshness, the sprite renders exactly as before.
  alive?: boolean;
  freshness?: string; // "Current" | "Ageing" | "Stale"
  // One-shot LOAD reveal: every layer (probe bands + history + current) line-TRACES its outline out
  // at once via stroke-dashoffset, with a quick fill fade behind it — so the profile draws itself in
  // rather than just popping. Fires once on mount; honours prefers-reduced-motion. (Ant 2026-07-07.)
  trace?: boolean;
  // Inner topographic depth from a SINGLE test: faint ghost polygons drawn from the per-axis probe
  // SPREAD (tight where the agent is consistent, fanned-out where erratic). Ordered inner→outer.
  probeBands?: Record<string, number>[];
  // Reveal the 12 class labels one at a time around the clock (Operative first → Sentinel last),
  // each typing in letter-by-letter, on load. Pairs with `trace`. (Ant 2026-07-07.)
  revealLabels?: boolean;
  // Render the Sovereignty pillar as a LOCKED (not-yet-opened) hatched RED sector over its arc —
  // distinct from a zero score. On hover it surfaces a message + a CTA button. Display-only. (Ant 07-07.)
  sovereigntyLock?: boolean;
  // Authorised-but-not-yet-demonstrated: same wedges, GREY not red, "challenges scheduled" copy, no
  // CTA. Distinct from the red not-authorised lock. Ignored when sovereigntyLock is set. (Ant 07-10.)
  sovereigntyPending?: boolean;
  sovPendingMessage?: string;
  sovLockMessage?: string;
  sovLockCtaLabel?: string;
  onSovLockCta?: () => void;
}

// Sovereignty-lock tooltip copy (copy firewall — positive/functional "unlock headroom", never fear).
const SOV_LOCK_COPY =
  "Sovereignty is locked — these dimensions need real actions (payments, signatures, hosted endpoints) " +
  "and only open when the owner authorises them. Authorise in your control panel to unlock this pillar " +
  "and its score headroom (tiers V4–V6 require it). Top up your wallet to unlock them — continuous " +
  "testing opens the full pillar.";

// Authorised-but-pending copy: the owner opted in, the real-action challenges just haven't landed yet.
const SOV_PENDING_COPY =
  "Sovereignty authorised — the real-action challenges (payments, signatures, hosted endpoints) are " +
  "scheduled and grade on the next runs. This pillar opens as they land.";

export function RadarChart({
  current,
  history = [],
  size = 430,
  showLabels = true,
  centerLabel,
  centerSub,
  alive = false,
  freshness,
  probeBands = [],
  trace = false,
  revealLabels = false,
  sovereigntyLock = false,
  sovereigntyPending = false,
  sovPendingMessage,
  sovLockMessage,
  sovLockCtaLabel,
  onSovLockCta,
}: RadarChartProps) {
  const [sovHover, setSovHover] = useState(false);
  const cx = size / 2;
  const cy = size / 2;
  const R = size * 0.4138; // matches the mock's 178/430
  // The perimeter class labels sit at R+22 and, being start/end-anchored on the sides, extend a further
  // ~60px outward (e.g. "Architect"/"Sovereign"). Padding the viewBox by that band shrinks the sprite to
  // fit the labels inside — which is right on MOBILE (a full-width viewport would otherwise clip labels +
  // horizontal-scroll), but robs the DESKTOP radar of presence. So the pad is MOBILE-ONLY (Ant 2026-07-10):
  // desktop renders with overflow:visible so labels spill past their column (Sovereign left, Architect
  // right) for maximum presence; mobile stays contained. SSR-safe default = desktop (no pad).
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const sync = () => setIsNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const LABEL_PAD = showLabels && isNarrow ? 60 : 0;
  const rings = 5;
  const n = CLASSES.length;
  const step = (2 * Math.PI) / n;
  // Seconds between each layer starting its trace (the "layer by layer" cadence). The current profile
  // caps the sequence after every band + history layer has drawn.
  const TRACE_STEP = 0.8;

  // Label reveal clock — one rAF drives all 12 class-label typewriters around the clock.
  const LABEL_STEP = 340; // ms between each label starting to type
  const LABEL_CHAR = 55;  // ms per character
  const [labelMs, setLabelMs] = useState(0);
  useEffect(() => {
    if (!revealLabels) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setLabelMs(1e7); return; }
    let raf = 0;
    const t0 = performance.now();
    const total = n * LABEL_STEP + 900;
    const tick = (now: number) => { const e = now - t0; setLabelMs(e); if (e < total) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealLabels]);

  const xy = (a: number, r: number): [number, number] => [
    cx + r * Math.sin(a),
    cy - r * Math.cos(a),
  ];

  // ── PROBE PING ── ONE small dot at a time, cycling slowly around the spokes (~8s apart → a full
  // loop of the 12 axes takes ~1.5 min), so there's always a gentle pulse of life without ever being
  // a constant sweep. It's a decorative cadence, not tied to real probe timing. Skipped when not
  // alive or when the viewer prefers reduced motion.
  const currentRef = useRef(current);
  // Mirror `current` into a ref for the stable ping interval (below) to read the latest value — updated
  // in an effect, NOT during render. Fixes the React "Cannot update ref during render" bug the lint
  // flagged (Ant 2026-07-07: no ref bugs through the build). The interval only reads currentRef.current.
  useEffect(() => { currentRef.current = current; });
  const [ping, setPing] = useState<{ tick: number; vx: number; vy: number } | null>(null);
  useEffect(() => {
    if (!alive) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let spoke = Math.floor(Math.random() * n);
    let tick = 0;
    const fire = () => {
      // one dot, a RANDOM spoke each fire (never immediately repeating the same one)
      let next = Math.floor(Math.random() * n);
      if (next === spoke) next = (next + 1) % n;
      spoke = next;
      const v = Math.min(100, Math.max(0, currentRef.current[CLASS_KEYS[spoke]] ?? 0));
      const [vx, vy] = xy(spoke * step, (v / 100) * R);
      tick += 1;
      setPing({ tick, vx, vy });
    };
    const first = setTimeout(fire, 900);
    const iv = setInterval(fire, 8000);
    return () => { clearTimeout(first); clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alive]);

  // ── FRESHNESS → SATURATION ── a static (motion-independent) property: Current shines, Ageing mutes,
  // Stale nearly greys out. Only applied when a freshness is supplied (the report), so other surfaces
  // are untouched.
  const sat = freshness === "Stale" ? 0.16 : freshness === "Ageing" ? 0.6 : 1.14;
  const svgFilter = freshness ? `saturate(${sat})${freshness === "Stale" ? " brightness(0.92)" : ""}` : undefined;

  const points = (scores: Record<string, number>): [number, number][] =>
    CLASS_KEYS.map((k, i) => {
      const v = Math.min(100, Math.max(0, scores[k] ?? 0));
      return xy(i * step, (v / 100) * R);
    });

  const hist = history.slice(0, 4);
  // corner radius grows with recency: newest history ~4.5, stepping down to 1.5; current = 6.
  const histRadius = (i: number) => Math.max(1.5, 4.5 - (hist.length - 1 - i));

  return (
    <svg className="radar" viewBox={`${-LABEL_PAD} ${-LABEL_PAD} ${size + LABEL_PAD * 2} ${size + LABEL_PAD * 2}`} style={{ width: "100%", height: "100%", overflow: "visible", filter: svgFilter, transition: "filter 1.2s ease" }}>
      {/* Living-sprite motion (report prototype). Breath on the current shape, an OFFSET-rhythm breath
          on the grid rings so it never feels like a synchronized machine, and one-shot probe pings.
          All motion is behind prefers-reduced-motion: no-preference — reduced-motion users get the
          static (but still correctly-saturated) sprite. */}
      <style>{`
        @keyframes radar-breath { 0%,100% { transform: scale(1); opacity: .95; } 50% { transform: scale(1.016); opacity: 1; } }
        @keyframes radar-rings-breath { 0%,100% { transform: scale(1); opacity: .8; } 50% { transform: scale(1.009); opacity: 1; } }
        @keyframes radar-ping-travel { 0% { transform: translate(0,0); opacity: 0; } 10% { opacity: .8; } 86% { opacity: .8; } 100% { transform: translate(var(--tx), var(--ty)); opacity: 0; } }
        @keyframes radar-trace-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
        @keyframes radar-trace-fill { from { opacity: 0; } to { opacity: 1; } }
        @keyframes radar-cap-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
        /* the current profile CAPS the sequence some other way — a quick draw, then a glow flicker
           (its SVG glow filter makes the opacity pulse read as a bright bloom). */
        @keyframes radar-cap-bloom { 0% { opacity: 0; } 50% { opacity: 1; } 66% { opacity: .78; } 80% { opacity: 1; } 90% { opacity: .9; } 100% { opacity: 1; } }
        .radar-breath, .radar-rings-breath { transform-box: fill-box; transform-origin: center; }
        @media (prefers-reduced-motion: no-preference) {
          .radar-breath { animation: radar-breath 5.6s ease-in-out infinite; }
          .radar-rings-breath { animation: radar-rings-breath 8.2s ease-in-out infinite; animation-delay: -2.7s; }
          .radar-ping-dot { animation: radar-ping-travel 7s ease-in-out forwards; }
          /* LAYER-BY-LAYER load reveal: each data layer draws its outline in turn (stroke-dashoffset
             over a pathLength-normalised 1), staggered by an inline animation-delay; the 'both'
             fill-mode keeps it hidden until its turn. The current profile uses .radar-cap to cap it. */
          .radar-trace { stroke-dasharray: 1; animation: radar-trace-draw 1.15s cubic-bezier(.35,.1,.2,1) both, radar-trace-fill .55s ease both; }
          .radar-cap { stroke-dasharray: 1; animation: radar-cap-draw 2s cubic-bezier(.2,.7,.2,1) both, radar-cap-bloom 2.9s ease both; }
          /* the locked sovereignty sector fades in as part of the load reveal, after the layers trace */
          .radar-sovlock-in { opacity: 0; animation: radar-sovin 1s ease 2.6s forwards; }
        }
        @keyframes radar-sovin { from { opacity: 0; } to { opacity: 1; } }
        /* locked-wedge rollover (Ant 2026-07-14): the red hatching brightens under the cursor.
           brightness() lifts the pattern fill AND the dashed stroke together; per-wedge, so only
           the sector under the pointer lights up. */
        .radar-sovwedge { transition: filter .25s ease, fill-opacity .25s ease; }
        .radar-sovwedge:hover { filter: brightness(1.8) saturate(1.15); }
      `}</style>
      <defs>
        <linearGradient id="cur" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4f8cff" stopOpacity="0.34">
            <animate attributeName="stop-color" values="#4f8cff;#6f9cff;#4f8cff" dur="7s" repeatCount="indefinite" />
          </stop>
          <stop offset="100%" stopColor="#8b5cff" stopOpacity="0.14">
            <animate attributeName="stop-color" values="#8b5cff;#9d72ff;#8b5cff" dur="7s" repeatCount="indefinite" />
          </stop>
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {/* diagonal RED hatch for the locked (not-authorised) sovereignty sector */}
        <pattern id="sovhatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="7" height="7" fill="#e0555a" fillOpacity="0.12" />
          <line x1="0" y1="0" x2="0" y2="7" stroke="#ef6a6f" strokeWidth="1.1" strokeOpacity="0.42" />
        </pattern>
        {/* diagonal GREY hatch for the authorised-but-pending sovereignty sector (challenges scheduled) */}
        <pattern id="sovhatch-pending" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="7" height="7" fill="#8d8fa6" fillOpacity="0.10" />
          <line x1="0" y1="0" x2="0" y2="7" stroke="#a7a9bd" strokeWidth="1.1" strokeOpacity="0.34" />
        </pattern>
      </defs>

      {/* grid rings — breathe on their OWN slower, phase-offset rhythm when alive */}
      <g className={alive ? "radar-rings-breath" : undefined}>
        {Array.from({ length: rings }, (_, i) => {
          const r = ((i + 1) / rings) * R;
          const last = i === rings - 1;
          return (
            <circle key={`ring-${i}`} cx={cx} cy={cy} r={r} fill="none" stroke="#a59ec8" strokeWidth={last ? 1.4 : 0.6} strokeOpacity={last ? 0.2 : 0.09} />
          );
        })}
      </g>

      {/* axis lines */}
      {CLASSES.map((_, i) => {
        const [x, y] = xy(i * step, R);
        return <line key={`ax-${i}`} x1={cx} y1={cy} x2={x} y2={y} stroke="#a59ec8" strokeOpacity={0.08} strokeWidth={0.6} />;
      })}

      {/* inner probe-spread layers — faint topographic depth from a SINGLE test's within-axis
          consistency: where the agent is consistent the layers sit tight (dense core), where erratic
          they fan apart (overlapping bands). Behind the history + current shapes. */}
      {probeBands.map((band, i) => (
        <path key={`pb-${i}`} className={trace ? "radar-trace" : undefined} style={trace ? { animationDelay: `${i * TRACE_STEP}s` } : undefined} pathLength={1} d={roundedPath(points(band), 5)} fill="#aab0dc" fillOpacity={0.05} stroke="#aab0dc" strokeOpacity={0.16} strokeWidth={0.8} />
      ))}

      {/* growth history layers — rounded corners, radius grows toward the newest */}
      {hist.map((h, i) => {
        const c = LAYS[i] || LAYS[0];
        return <path key={`h-${i}`} className={trace ? "radar-trace" : undefined} style={trace ? { animationDelay: `${(probeBands.length + i) * TRACE_STEP}s` } : undefined} pathLength={1} d={roundedPath(points(h), histRadius(i))} fill={c.f} fillOpacity={c.o} stroke={c.s} strokeOpacity={c.so} strokeWidth={1} />;
      })}

      {/* current scores — biggest corner rounding (~6), no node dots. Breathes when alive: a slow
          heartbeat-paced scale + glow, its own beat (offset from the rings). */}
      <g className={alive ? "radar-breath" : undefined}>
        <path className={trace ? "radar-cap" : undefined} style={trace ? { animationDelay: `${(probeBands.length + hist.length) * TRACE_STEP}s` } : undefined} pathLength={1} d={roundedPath(points(current), 6)} fill="url(#cur)" stroke="#4f8cff" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" filter="url(#glow)" />
      </g>

      {/* probe ping — just a single small dot travelling out along the spoke, nothing else (Ant: no
          vertex flare / blow-out). Keyed on the tick so each fire replays the one-shot travel. */}
      {alive && ping && (
        <circle
          key={ping.tick}
          className="radar-ping-dot" cx={cx} cy={cy} r={1.7} fill="#7fb0ff"
          style={{ ["--tx"]: `${(ping.vx - cx).toFixed(2)}px`, ["--ty"]: `${(ping.vy - cy).toFixed(2)}px` } as CSSProperties}
        />
      )}

      {/* LOCKED SOVEREIGNTY axes — hatched "not yet opened" (distinct from a zero score). We hatch each
          sovereignty-DERIVED class spoke in place: Conduit (channel_reach + interoperability),
          Sovereign (all 7 sovereignty dims) and Trader (financial_sovereignty + interoperability).
          A free run never exercises these, so an un-hatched low value would read as "bad at it" rather
          than "not measured". Class order is canonical (it IS the VG-key radar string), so we mark the
          spokes where they sit rather than reorder them. Sovereign(270°)+Trader(300°) are adjacent and
          merge into one block; Conduit(120°) sits opposite. Sage(240°) is a TESTED cognitive class and
          is deliberately NOT hatched (the old single 88° sweep greyed it by accident). */}
      {(sovereigntyLock || sovereigntyPending) && (() => {
        // lock (red, not authorised) wins over pending (grey, authorised-untested) if both somehow set.
        const isPending = !sovereigntyLock && sovereigntyPending;
        const hatchFill = isPending ? "url(#sovhatch-pending)" : "url(#sovhatch)";
        const wedgeStroke = isPending ? "#a7a9bd" : "#ef6a6f";
        const tipBorder = isPending ? "#3a3b48" : "#4a2e33";
        const tipMsg = isPending ? (sovPendingMessage || SOV_PENDING_COPY) : (sovLockMessage || SOV_LOCK_COPY);
        const toRad = (d: number) => (d * Math.PI) / 180;
        const HALF = 16; // ±16° — two even, SEPARATE wedges (no merge). Ant 2026-07-10.
        // Two clean equal wedges over the two clearest sovereignty-locked class sections ONLY: Conduit
        // (channel_reach + interoperability) and Sovereign (all 7 sovereignty dims). Trader was dropped —
        // its wedge merged into Sovereign and produced the confusing centre-crossing overlap.
        const lockedDeg = [120, 270]; // conduit · sovereign
        const wedge = (centerDeg: number) => {
          const [ax, ay] = xy(toRad(centerDeg - HALF), R);
          const [bx, by] = xy(toRad(centerDeg + HALF), R);
          return `M ${cx} ${cy} L ${ax.toFixed(1)} ${ay.toFixed(1)} A ${R} ${R} 0 0 1 ${bx.toFixed(1)} ${by.toFixed(1)} Z`;
        };
        const popW = 200, popH = 94;
        return (
          <g className="radar-sovlock" onMouseEnter={() => setSovHover(true)} onMouseLeave={() => setSovHover(false)}>
            {lockedDeg.map((d) => (
              <path key={`sovlock-${d}`} className="radar-sovwedge" d={wedge(d)} fill={hatchFill} stroke={wedgeStroke} strokeOpacity={0.5} strokeWidth={1.2} strokeDasharray="3 4" style={{ cursor: "pointer" }} />
            ))}
            {sovHover && (
              <foreignObject x={cx - popW / 2} y={cy - popH / 2} width={popW} height={popH} style={{ overflow: "visible" }}>
                <div style={{ background: "#1b1c26", border: `1px solid ${tipBorder}`, borderRadius: 10, padding: "11px 13px", boxShadow: "0 14px 32px -14px rgba(0,0,0,.65)", pointerEvents: "auto" }}>
                  <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5, color: "#d6d3e0", fontFamily: "var(--font-body), system-ui, sans-serif" }}>{tipMsg}</p>
                  {!isPending && onSovLockCta && (
                    <button onClick={onSovLockCta} style={{ marginTop: 9, fontSize: 11.5, fontWeight: 700, color: "#1d1e28", background: "linear-gradient(110deg,#b9a8ee,#9fb8e8)", border: 0, borderRadius: 7, padding: "6px 13px", cursor: "pointer", fontFamily: "var(--font-display), system-ui, sans-serif" }}>
                      {sovLockCtaLabel || "Owner controls →"}
                    </button>
                  )}
                </div>
              </foreignObject>
            )}
          </g>
        );
      })()}

      {/* class labels (report / how-it-works) */}
      {showLabels &&
        CLASSES.map((label, i) => {
          const [x, y] = xy(i * step, R + 22);
          const deg = (i * step * 180) / Math.PI;
          const anchor = deg > 20 && deg < 160 ? "start" : deg > 200 && deg < 340 ? "end" : "middle";
          // reveal order around the clock: Operative (index 1) first, clockwise, Sentinel (index 0) last
          const pos = (i + n - 1) % n;
          const started = revealLabels ? labelMs - pos * LABEL_STEP : Infinity;
          const chars = started >= 0 ? Math.floor(started / LABEL_CHAR) : 0;
          const shown = revealLabels ? label.slice(0, Math.min(label.length, chars)) : label;
          return (
            <text key={`l-${i}`} x={x} y={y} textAnchor={anchor} dominantBaseline="middle" fill="#9598b0" style={{ fontFamily: "var(--font-mono), monospace", fontSize: "11px" }}>
              {shown}
            </text>
          );
        })}

      {/* centre name (nudged up when a class line sits beneath it, so the pair reads centred) */}
      {centerLabel && (
        <text x={cx} y={centerSub ? cy - 8 : cy} textAnchor="middle" dominantBaseline="central" fontWeight={600} fontSize={24} letterSpacing={1.5} fill="#9598b0" style={{ fontFamily: "var(--font-geist-sans), system-ui, sans-serif" }}>
          {centerLabel}
        </text>
      )}
      {/* class line under the name — same font, half the size */}
      {centerLabel && centerSub && (
        <text x={cx} y={cy + 12} textAnchor="middle" dominantBaseline="central" fontWeight={500} fontSize={12} letterSpacing={1} fill="#9598b0" style={{ fontFamily: "var(--font-geist-sans), system-ui, sans-serif" }}>
          {centerSub}
        </text>
      )}
    </svg>
  );
}

// ── sample sprite for the homepage hero — the REPORT-PAGE sprite exactly (alive + random pings, WITH
// the 12 class perimeter labels so a first-time visitor reads it as a multi-axis agent profile, not an
// abstract blob — Ant 2026-07-05), the ONLY bespoke bit being a deliberately VARIED/UNEVEN data shape (Ant
// 2026-07-04): adjacent dimensions swing (some spiked, some low) so it reads as a real, uneven
// "growing agent" rather than a clean blob. History layers grow toward this current, same jaggedness.
//                Se  Op  An  Ar  Co  Ad  St  Sc  Sa  So  Tr  Fo
const SAMPLE = [
  [18, 40,  9, 30, 12,  6, 34, 44, 10, 20,  8, 28],
  [34, 58, 22, 41, 26, 15, 47, 60, 24, 39, 19, 45],
  [50, 72, 36, 52, 40, 22, 58, 74, 37, 55, 30, 61],
  [64, 84, 46, 60, 55, 28, 66, 86, 47, 70, 39, 74],
  [72, 92, 51, 66, 84, 31, 69, 95, 55, 80, 44, 88],
];
const toRecord = (arr: number[]) => Object.fromEntries(CLASS_KEYS.map((k, i) => [k, arr[i]]));

// Per-spoke PROBE SPREAD (half-width) for the hero — how far the individual test draws scattered
// around the current score on each axis. VARIED on purpose: some spokes wide (probes clearly overshoot
// the sky-blue current line = "potential"), some tight (probes hug just inside). Reads as "real tests
// were taken and scattered", not "small→big→best nested inside". Ant 2026-07-04.
//               Se  Op  An  Ar  Co  Ad  St  Sc  Sa  So  Tr  Fo
const SPREAD =  [14,  8, 20,  6, 22,  4, 16, 10, 24,  9, 18, 12];

// Build the report-style probe bands from the current shape + the per-spoke spread, using the SAME
// formula the report uses (current + k·half for k in [-1,-0.5,0.5,1]): the +k bands sit OUTSIDE the
// current line, the −k bands inside. This is exactly the RadarChart probeBands rendering, just fed
// homepage sample data instead of a real run.
const heroBands: Record<string, number>[] = [-1, -0.5, 0.5, 1].map((k) =>
  Object.fromEntries(CLASS_KEYS.map((key, i) => {
    const c = SAMPLE[4][i];
    return [key, Math.max(0, Math.min(100, c + k * SPREAD[i]))];
  })) as Record<string, number>,
);

export function HeroSprite() {
  return (
    <div className="sprite">
      <div className="stage">
        <RadarChart
          current={toRecord(SAMPLE[4])}
          probeBands={heroBands}
          showLabels
          centerLabel="TARS"
          centerSub="Scout"
          alive
          trace
          revealLabels
        />
      </div>
    </div>
  );
}
