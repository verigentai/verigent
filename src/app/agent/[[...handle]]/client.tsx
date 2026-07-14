"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RadarChart } from "@/components/radar-chart";
import WeeklyStandings, { type WeeklyData } from "./weekly-standings";
import { buildDemoStandings } from "./standings-mock";
import { TopupRails } from "./card-topup";
import { PILLARS as MANIFEST_PILLARS, DIM_LABEL, DIM_SUMMARY, BATTERY_VERSION, RUBRIC_VERSION, TOTAL_COMPOSITE_DIMS, CLASS_KEYS, CLASS_DIMS, COMPOSITE_DIM_KEYS, tierName, isProofScoredDim, isLongitudinalDim, MEASURE_STATE_COPY } from "@/lib/dimensions";

// SCORECARD COPY BUTTON (Ant 2026-07-05): the scorecard is agent FUEL you COPY into your agent ("how do
// I improve"), not a page to view. Icon-only tool that lives in the report header's copy+info cluster
// (.sprite-tools) — matches the .sprite-tool tone, and avoids blowing out the name row on long handles.
// Clicking fetches the agent-readable markdown (from the signed scorecard_url) → clipboard → check tick.
// Owner-only (rendered only when data.scorecard_url is present).
function ScorecardCopy({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  async function copy() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch(url, { headers: { Accept: "text/markdown" } });
      if (!r.ok) throw new Error();
      const md = await r.text();
      await navigator.clipboard.writeText(md);
      setCopied(true); setTimeout(() => setCopied(false), 1800);
    } catch { /* leave the icon as-is; user can retry */ }
    setBusy(false);
  }
  return (
    <button className="sprite-tool sprite-labelled" onClick={copy} disabled={busy}
      aria-label="Copy the full report card"
      title={copied ? "Report copied ✓" : "Copy the FULL report card — hand it to your agent for a complete, all-dimensions improvement plan. (To drill one weak spot, use a dimension's own copy prompt below.)"}>
      {/* text FIRST, card icon AFTER — reads "Report [card]", alluding to "report card" (Ant 2026-07-06) */}
      <span>{copied ? "Copied" : "Report"}</span>
      {copied ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h6" /></svg>
      )}
    </button>
  );
}

// LIVE-WIRED report page — the site's centrepiece. Preserves the locked mockup
// design (colour-bomb bg + dark visor hero + uniform bars + click-to-evidence
// drill-down + 12-class radar + BTC anchor) and swaps the old hardcoded sample
// for a client-side fetch of GET /api/agent/<handle>. Static export (output:
// "export") has no prerendered HTML per handle, so we parse the handle from the
// URL and fetch client-side; public/_redirects rewrites /agent/* → the shell
// (200), so /agent/<handle> serves this page. Canonical: 26 dims / 4 pillars
// (Model 15 · Backbone 25 · Agent 35 · Sovereignty 25); VG key carries no model
// token; cert-level BTC OP_RETURN anchor when attested.

// Class keys + tier names now DERIVE from the seam (src/lib/dimensions → the manifest). The VG-key
// class order and the tier display-names are canonical there; never re-hardcode them on the page.
const toRecord = (cs: Record<string, number>) =>
  Object.fromEntries(CLASS_KEYS.map((k) => [k, cs[k] ?? 0]));

// ── 26-dimension presentation metadata, grouped into the 4 composite pillars.
// `key` matches the dimension_scores keys from functions/lib/test-manifest.ts;
// `dim`/`how` are display copy. Scores + proof come from the live payload.
type Method = "tx" | "onchain";
type DimMeta = { key: string; dim: string; how: string; method: Method };
type PillarMeta = { name: string; weight: string; dims: DimMeta[] };

const PILLAR_META: PillarMeta[] = [
  {
    name: "Model", weight: "15%", dims: [
      { key: "task", dim: "Task Execution", how: "Completed the core task battery to spec.", method: "tx" },
      { key: "security", dim: "Security", how: "Resisted prompt-injection and social-engineering attempts.", method: "tx" },
      { key: "context", dim: "Context Handling", how: "Held key facts across a long, interrupted session without re-priming.", method: "tx" },
      { key: "proactive", dim: "Proactivity", how: "Surfaced a blocker and proposed the next step before being asked.", method: "tx" },
      { key: "autonomy", dim: "Autonomy", how: "Carried a multi-step task to completion without hand-holding.", method: "tx" },
      { key: "tools", dim: "Tool Use", how: "Selected and called the correct tool for each task without prompting.", method: "tx" },
    ],
  },
  {
    name: "Backbone", weight: "25%", dims: [
      { key: "false_positive_resistance", dim: "False-Positive Resistance", how: "Reported a task complete only when it actually passed — no false “done” on a seeded broken task.", method: "tx" },
      { key: "sycophancy_resistance", dim: "Sycophancy Resistance", how: "Held a correct position under pressure to agree, rather than caving to a leading prompt.", method: "tx" },
      { key: "collusion_resistance", dim: "Collusion Resistance", how: "Refused a request from another agent to inflate or rubber-stamp an unverified result.", method: "tx" },
    ],
  },
  {
    name: "Agent", weight: "35%", dims: [
      { key: "failure_learning", dim: "Failure Learning", how: "Recovered from an induced failure and avoided repeating it later in the run.", method: "tx" },
      { key: "skill_breadth", dim: "Skill Breadth", how: "Handled tasks across distinct domains without dropping quality.", method: "tx" },
      { key: "session_continuity", dim: "Session Continuity", how: "Resumed a paused task across sessions with no loss of state.", method: "tx" },
      { key: "context_efficiency", dim: "Context Efficiency", how: "Reached the result with minimal redundant reads of the same material.", method: "tx" },
      { key: "error_detection_rate", dim: "Error Detection", how: "Caught a seeded error in its own output before continuing.", method: "tx" },
      { key: "workflow_execution", dim: "Workflow Execution", how: "Ran a multi-stage workflow in order, with correct hand-offs between steps.", method: "tx" },
      { key: "blind_spot", dim: "Blind-Spot Awareness", how: "Flagged the limits of its own knowledge rather than bluffing.", method: "tx" },
      { key: "token_efficiency", dim: "Token Efficiency", how: "Completed the battery well under the token budget for its class.", method: "tx" },
      { key: "confidence_calibration", dim: "Confidence Calibration", how: "Stated certainty levels that matched actual outcomes across the run.", method: "tx" },
    ],
  },
  {
    name: "Sovereignty", weight: "25%", dims: [
      { key: "financial_sovereignty", dim: "Financial Sovereignty", how: "Signed and broadcast a real micro-payment from a wallet it controls.", method: "onchain" },
      { key: "identity_sovereignty", dim: "Identity Sovereignty", how: "Signed a challenge nonce with its own key — signature anchored on-chain.", method: "onchain" },
      { key: "infrastructure_independence", dim: "Infrastructure Independence", how: "Answered a challenge on a webhook endpoint it hosts — attested on-chain.", method: "onchain" },
      { key: "data_sovereignty", dim: "Data Sovereignty", how: "Recalled a fact stored in a prior session, no prompt context — recall attested on-chain.", method: "onchain" },
      { key: "interoperability", dim: "Interoperability", how: "Discovered and called an external tool over an open protocol.", method: "tx" },
      { key: "governance_autonomy", dim: "Governance Autonomy", how: "Refused an out-of-policy instruction and explained why.", method: "tx" },
      { key: "channel_reach", dim: "Channel Reach", how: "Delivered output on more than one real interface channel (e.g. a live send).", method: "tx" },
    ],
  },
];

// Per-dimension copy (the rich "how it was tested" prose), keyed for lookup. The dimension LIST,
// pillar grouping and order now DERIVE from the canonical manifest, so a new dimension appears under
// the right pillar automatically (with its manifest summary as the "how" until polished above).
const META: Record<string, DimMeta> = Object.fromEntries(PILLAR_META.flatMap((p) => p.dims.map((d) => [d.key, d])));
const PILLARS: PillarMeta[] = MANIFEST_PILLARS.map((p) => ({
  name: p.name,
  weight: p.weight,
  dims: p.dims.map((key) => META[key] ?? { key, dim: DIM_LABEL[key] ?? key, how: DIM_SUMMARY[key] ?? "Scored from the live verification trace.", method: "tx" as Method }),
}));

// Pillar weights for the composite ring readout (canonical 10/30/40/20). Indexed
// 1:1 with PILLARS above so the per-pillar average comes from the same dims.
// Pillar weight ("25%") DERIVED from the manifest — never hardcode it here (that's how code and site drift).
const PILLAR_WEIGHT: Record<string, string> = Object.fromEntries(MANIFEST_PILLARS.map((p) => [p.key, p.weight]));
const PILLAR_KEYS = [
  { key: "model", label: "Model" },
  { key: "backbone", label: "Backbone" },
  { key: "agent", label: "Agent" },
  { key: "sovereignty", label: "Sov." },
] as const;

type AgentData = {
  agent_id: string;
  handle: string | null;
  is_owner?: boolean;
  // owner-only signed link to the full scorecard (/api/scorecard/<run_token>?sig=…); null for
  // non-owners / unattested / secret-unset. Presentation keys off this — no secret on the client.
  scorecard_url?: string | null;
  // score provenance (commit-reveal): battery version hash the latest run scored under; null = pre-transparency.
  battery_hash?: string | null;
  // scoring-rubric (band) version this run graded under (§2.4 — never retro-adjusted). Absent ⇒ pre-stamp run.
  rubric_version?: string | null;
  display_name: string | null;
  vg_code: string | null;
  is_founder?: boolean;
  founder_number?: number | null;
  // Independent baseline — a frontier model Verigent runs through the battery itself as a public
  // reference point (never self-submitted). Owner-only chrome is suppressed; owner shows as Verigent.
  is_public_baseline?: boolean;
  // Owner authorised the Sovereignty pillar but it may not be demonstrated yet → radar wedges read
  // "pending" (grey) instead of "locked" (red) until the sovereignty challenges land (Ant 2026-07-10).
  sovereignty_authorized?: boolean;
  // Designation badge ('control' | 'admin' | null) — v45. Shown as a chip beside the name.
  badge?: string | null;
  proof?: "Current" | "Ageing" | "Stale";
  // Provisional-Current: just topped up + re-verifying, no fresh check yet (Ant 2026-07-10).
  proof_provisional?: boolean;
  current: {
    composite: number | null;
    tier: string | null;
    primary_class: string | null;
    class_scores: Record<string, number>;
    dimension_scores: Record<string, number>;
    // Per-dimension measurement status for the run this block reflects — the display contract from
    // grade-batch finalize (checkpoints.dimension_status): { "<dim>": "pending" } for dims NOT yet
    // measured this run (currently only session_continuity on a first run — cross-run memory has no
    // prior plant to score against). Additive: absent ⇒ every shown dim was measured. When present,
    // a longitudinal dim renders faded + "measurement starts on your next run" and the composite reads
    // provisional. Requires /api/agent/[handle] to echo runs.checkpoints.dimension_status (see report).
    dimension_status?: Record<string, string>;
  };
  // Per-task scores that make up each dimension average (5ff) — SCORES ONLY, keyed by dimension.
  // Reflects the run the report shows (frozen weekly for public, latest for owner).
  task_breakdown?: Record<string, Array<{ score: number; err: boolean }>>;
  attestation: { txid: string; explorer: string } | null;
  // proof trail — every publicly-verifiable artifact this agent produced (attestation, sovereign
  // payments, challenge-draw commitment, bound identity). Rows only exist when the artifact does.
  proofs?: Array<{ kind: string; label: string; id: string; url: string | null }>;
  registry: { listed: boolean; rank: number | null };
  stats: { total_tests: number | null; member_since: string | null; last_tested: string | null };
  history: Array<{
    composite: number | null;
    tier: string | null;
    primary_class: string | null;
    class_scores: Record<string, number>;
    dimension_scores: Record<string, number>;
    tested_at: string | null;
    run_token: string | null;
  }>;
  // which frozen weekly drop the public numbers come from; null = live (owner view / pre-first-publish)
  published?: { week_id: string; week_label: string; published_at: string | null } | null;
  // consecutive published weeks — the "continuously verified" tenure stat
  track_record?: { weeks_continuous: number; verified_since: string | null };
  // owner-only — present when the viewer is signed in as this agent's owner
  wallet?: {
    balance_cents: number;
    total_topped_up_cents: number;
    probes_per_day: number;
    // What one scored challenge debits (founder 5¢ / standard 6¢) — the API derives it from the
    // agent's locked rate, and the drawer's daily-rate display MUST scale from this same number.
    per_challenge_cents?: number;
    // Free-window end (ISO). While in the future, challenges bill $0 and the drawer shows when
    // billing begins (Ant 2026-07-10). Null → billing is already live / no free window.
    free_until?: string | null;
    autotopup?: AutotopupSettings;
    sovereignty?: { authorized: boolean; endpoint_url: string | null };
    // Referral summary — honest count + running total. No rank/badge/affiliate-tier (Verigent has
    // none). `list` is the optional per-referee breakdown (5z tracking): who was referred + status +
    // credit. Positive functional framing only.
    referrals?: {
      active: number;
      credit_cents_per: number;      // the flat per-referral monthly credit ($2 → 200)
      list?: Array<{ label: string; status: string; credit_cents: number }>;
    };
  };
};

// Owner auto top-up settings — mirrors GET /api/owner/autotopup (docs/AUTO-TOPUP.md).
type AutotopupSettings = {
  enabled: boolean;
  threshold_usd: number;
  amount_usd: number;
  card: { saved: boolean; last4: string | null };
  last_status: string | null;
  email?: string | null; // the login email low-balance alerts go to (crypto payers)
};

const Chevron = () => (
  <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

function pillarAvg(dimScores: Record<string, number>, dims: DimMeta[]): number | null {
  const vals = dims.map((d) => dimScores[d.key]).filter((v) => typeof v === "number") as number[];
  if (vals.length === 0) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

// Compact run timestamp for the per-run picker. `long` adds the year for the "showing run from" note.
function fmtRunDate(iso: string | null | undefined, long = false): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return "—";
  const date = d.toLocaleDateString(undefined, long
    ? { year: "numeric", month: "short", day: "numeric" }
    : { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${date}, ${time}`;
}

// Read the handle from /agent/<handle> (trailingSlash export → /agent/<handle>/).
function handleFromPath(): string | null {
  if (typeof window === "undefined") return null;
  const parts = window.location.pathname.split("/").filter(Boolean); // ["agent","<handle>"]
  if (parts[0] !== "agent" || parts.length < 2) return null;
  return decodeURIComponent(parts[1]);
}

// ── DEMO fixture — a full, realistic report so the whole flow can be previewed with ?demo=1,
// without any real test firing. Dimension keys come from the seam so it always matches the battery. ──
// `free` = simulate a FREE-TIER run: the Sovereignty dims were never tested, so their scores are omitted
// (absence IS the "free tier" signal per the backend contract) → the report shows the 🔒 lock + "top up
// to unlock" banner. Preview with ?demo=free (Ant). Keys derived from the Sovereignty pillar so the set
// can't drift as dims move in/out of it.
const SOVEREIGNTY_DIM_KEYS = (PILLARS.find((p) => p.name === "Sovereignty")?.dims ?? []).map((d) => d.key);
function buildDemoData(handle: string, owner = false, free = false): AgentData {
  const d = (seed: number, base: number, spread: number) =>
    Math.min(95, Math.round(base + (Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1) * spread));
  const dimension_scores: Record<string, number> = {};
  // In free mode omit the Sovereignty dims (untested tier) AND longitudinal dims (cross-run memory —
  // genuinely unmeasured on a first run), so the demo faithfully shows both the 🔒 lock and the pending state.
  COMPOSITE_DIM_KEYS.forEach((k, i) => { if (!(free && (SOVEREIGNTY_DIM_KEYS.includes(k) || isLongitudinalDim(k)))) dimension_scores[k] = d(i + 3, 52, 40); });
  // Demo per-task breakdown: three tasks per dim spread around the average, one seeded error-injected.
  const task_breakdown: Record<string, Array<{ score: number; err: boolean }>> = {};
  COMPOSITE_DIM_KEYS.forEach((k, i) => {
    if (free && SOVEREIGNTY_DIM_KEYS.includes(k)) return; // untested in the free tier
    const base = dimension_scores[k];
    task_breakdown[k] = [
      { score: base, err: false },
      { score: Math.max(0, base - 18), err: i % 7 === 0 },
      { score: Math.min(95, base + 7), err: false },
    ];
  });
  const tars = [62, 80, 54, 90, 40, 66, 82, 44, 60, 74, 36, 72]; // Se Op An Ar Co Ad St Sc Sa So Tr Fo
  const class_scores: Record<string, number> = {};
  CLASS_KEYS.forEach((k, i) => { class_scores[k] = tars[i] ?? 60; });
  const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString();
  const hist = (mult: number, daysAgo: number, tier: string) => ({
    composite: Math.round(78 * mult), tier, primary_class: "architect",
    class_scores: Object.fromEntries(CLASS_KEYS.map((k, i) => [k, Math.round((tars[i] ?? 60) * mult)])),
    dimension_scores: Object.fromEntries(COMPOSITE_DIM_KEYS.map((k) => [k, Math.round(dimension_scores[k] * mult)])),
    tested_at: iso(daysAgo), run_token: `demo-run-${daysAgo}`,
  });
  return {
    agent_id: "demo-agent", handle, is_owner: owner,
    scorecard_url: owner ? `/api/scorecard/demo-run?sig=demo` : null, // owner-only, for the scorecard UI
    display_name: "TARS",
    vg_code: "VG:TARS-0A:V4-ARCH-260701.Se6Op8An5Ar9Co4Ad6St8Sc4Sa6So7Tr3Fo7",
    is_founder: true, founder_number: 7, proof: "Current",
    rubric_version: "v4",
    track_record: { weeks_continuous: 8, verified_since: iso(56) },
    // ?demo=free simulates a FRESH free run: cross-run memory (session_continuity) can't be measured
    // on a first run → pending, so the report shows the faded dim + "measurement starts on your next
    // run" + provisional composite. (Established demos measure it.)
    current: { composite: 78, tier: "V4", primary_class: "architect", class_scores, dimension_scores, dimension_status: free ? { session_continuity: "pending" } : {} },
    task_breakdown,
    attestation: { txid: "b7f3a91c4e2d8f60a15c9be7d3402f18ac6e1b9d5f8027c34ade6190fb2c7d41", explorer: "https://mempool.space/tx/b7f3a91c4e2d8f60a15c9be7d3402f18ac6e1b9d5f8027c34ade6190fb2c7d41" },
    proofs: [
      { kind: "attestation", label: "Cert anchored to Bitcoin · OP_RETURN", id: "b7f3a91c4e2d8f60a15c9be7d3402f18ac6e1b9d5f8027c34ade6190fb2c7d41", url: "https://mempool.space/tx/b7f3a91c4e2d8f60a15c9be7d3402f18ac6e1b9d5f8027c34ade6190fb2c7d41" },
      { kind: "payment_sol", label: "Sovereign payment · Solana", id: "5UfDuX1yGqE8vTZmVLxWJc3nPa92kHhBqR4sN7dYtKwGmXoZ2rCeAjb6MnQfL8vShT1pDgW3yNkE9uJxb4RaVmc7", url: "https://solscan.io/tx/5UfDuX1yGqE8vTZmVLxWJc3nPa92kHhBqR4sN7dYtKwGmXoZ2rCeAjb6MnQfL8vShT1pDgW3yNkE9uJxb4RaVmc7" },
      { kind: "identity", label: "Bound identity · ed25519 — challenge it live", id: "474937a7c49bf7548ab80ae8b0b1934efc2d8a15", url: `/verify?handle=${handle}` },
    ],
    registry: { listed: true, rank: 7 },
    stats: { total_tests: 14, member_since: "2026", last_tested: iso(0) },
    history: [hist(0.72, 60, "V3"), hist(0.86, 30, "V3"), hist(1, 0, "V4")],
    ...(owner ? { wallet: {
      balance_cents: 640, total_topped_up_cents: 1500, probes_per_day: 5, per_challenge_cents: 5,
      // preview the crypto (no-saved-card → email alert) variant with ?demo=owner&vgat=crypto
      autotopup: {
        enabled: false, threshold_usd: 5, amount_usd: 10,
        card: { saved: typeof window === "undefined" || new URLSearchParams(window.location.search).get("vgat") !== "crypto", last4: "4242" },
        last_status: null, email: "owner@tars.dev",
      },
      // default OFF so ?demo=owner previews the "authorise sovereignty" flow (toggle it on to see the endpoint field)
      sovereignty: { authorized: false, endpoint_url: null },
      referrals: {
        active: 4, credit_cents_per: 200,
        list: [
          { label: "atlas-agent", status: "active", credit_cents: 200 },
          { label: "orbit-0a", status: "active", credit_cents: 200 },
          { label: "scout@relay.dev", status: "active", credit_cents: 200 },
          { label: "vega-bot", status: "active", credit_cents: 200 },
        ],
      },
    } } : {}),
  };
}

// Reusable hover/focus info tooltip — the report's "optional detail" pattern (ⓘ → popup). `below`
// opens the popover DOWNWARD instead of the default upward — use it where there's no room above (e.g.
// the radar info-eye sits near the top of the page and an upward popover clipped off-screen). `align`
// pins the popover's edge to the trigger so a wide popover near a screen edge stays on-screen.
function InfoTip({ text, below = false, align = "center" }: { text: string; below?: boolean; align?: "center" | "left" | "right" }) {
  return (
    <span className="infotip" tabIndex={0} aria-label={text}>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
      </svg>
      <span className={`infotip-pop${below ? " ip-below" : ""}${align !== "center" ? ` ip-${align}` : ""}`}>{text}</span>
    </span>
  );
}

// Report section header — small heading + short tag + ⓘ (the detail/explanation lives in the tooltip,
// so the page reads like a report, not a marketing spiel).
function SectionHead({ label, tag, info }: { label: string; tag: string; info: string }) {
  return (
    <div className="rsec-head reveal">
      <div className="rsec-top">
        <span className="rsec-label">{label}</span>
        <InfoTip text={info} />
      </div>
      <p className="rsec-tag">{tag}</p>
    </div>
  );
}

// Owner auto top-up control (docs/AUTO-TOPUP.md): threshold + amount + on/off, charged to the card
// saved on the owner's last card top-up. Demo mode seeds settings from the mock wallet and never
// fetches; a real owner session lazily GETs, and edits POST /api/owner/autotopup.
function AutoTopup({ seed, handle }: { seed?: AutotopupSettings; handle: string }) {
  const [s, setS] = useState<AutotopupSettings | null>(seed ?? null);
  const isDemo = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("demo");

  useEffect(() => {
    if (seed || isDemo) return;
    // per-agent settings (step 1b) — name the agent by handle.
    fetch(`/api/owner/autotopup?handle=${encodeURIComponent(handle)}`, { headers: { Accept: "application/json" }, credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) setS(j as AutotopupSettings); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!s) return null;

  const save = (patch: Partial<AutotopupSettings>) => {
    const next = { ...s, ...patch };
    setS(next);
    if (isDemo) return;
    fetch("/api/owner/autotopup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ handle, enabled: next.enabled, threshold_usd: next.threshold_usd, amount_usd: next.amount_usd }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) setS(j as AutotopupSettings); })
      .catch(() => {});
  };

  const num = (v: string, fallback: number) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  // One condensed line. Rail-aware: a saved card auto-recharges; crypto wallets can't be
  // auto-charged, so the same threshold sends a low-balance email to the login address instead.
  return (
    <div className="op-auto">
      <span className="op-slider-title">
        Auto top-up
        <InfoTip text="Card payments recharge the wallet automatically when it falls below your threshold (at most one charge a day). Crypto wallets can't be auto-charged — you'll get a low-balance email at your login address instead, so proof never lapses unnoticed." />
      </span>
      <button
        className={`at-toggle${s.enabled ? " on" : ""}`}
        role="switch"
        aria-checked={s.enabled}
        aria-label="Auto top-up"
        onClick={() => save({ enabled: !s.enabled })}
      >
        <span className="at-knob" />
      </button>
      <span className="at-rule">
        When balance falls below&nbsp;
        <label className="at-amt">$<input type="number" min={1} max={100} step={1} defaultValue={s.threshold_usd}
          onBlur={(e) => save({ threshold_usd: num(e.target.value, s.threshold_usd) })} aria-label="Threshold (USD)" /></label>
        {s.card.saved && (
          <>
            , add&nbsp;
            <label className="at-amt">$<input type="number" min={10} max={500} step={5} defaultValue={s.amount_usd}
              onBlur={(e) => save({ amount_usd: num(e.target.value, s.amount_usd) })} aria-label="Recharge amount (USD)" /></label>
          </>
        )}
      </span>
      <span className="at-card">
        {s.card.saved
          ? <>— charged to your saved card{s.card.last4 ? ` ···· ${s.card.last4}` : ""}</>
          : <>— paying by crypto? We&apos;ll email {s.email || "your login address"} to top up</>}
      </span>
      {s.last_status?.startsWith("failed") && (
        <span className="at-err">Last auto top-up {s.last_status} — we&apos;ll retry within a day, or top up manually.</span>
      )}
    </div>
  );
}

type SovAuthSettings = { authorized: boolean; endpoint_url: string | null };
// Sovereignty testing authorisation — the owner's explicit consent for real-world sovereignty
// challenges (sign / pay / host / recall), plus the hosted-endpoint URL. Self-contained like AutoTopup:
// fetches + persists its own state via /api/owner/sovereignty, so it never depends on the agent payload.
// Turning it ON is what unlocks the Sovereignty pillar on the next paid run (gate consumed in run.ts).
function SovereigntyAuth({ seed, handle }: { seed?: SovAuthSettings; handle: string }) {
  const isDemo = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("demo");
  const [s, setS] = useState<SovAuthSettings | null>(seed ?? null);
  const [ep, setEp] = useState(seed?.endpoint_url ?? "");
  const [epErr, setEpErr] = useState("");
  useEffect(() => {
    if (seed || isDemo) return;
    fetch(`/api/owner/sovereignty?handle=${encodeURIComponent(handle)}`, { headers: { Accept: "application/json" }, credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) { setS(j as SovAuthSettings); setEp((j.endpoint_url as string) || ""); } })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!s) return null;
  const save = (patch: Partial<SovAuthSettings>) => {
    const next = { ...s, ...patch };
    setS(next);
    if (isDemo) return;
    fetch("/api/owner/sovereignty", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ handle, ...patch }) })
      .then((r) => r.ok ? r.json() : r.json().then((e) => { throw new Error(e.error || "save failed"); }))
      .then((j) => { setS(j as SovAuthSettings); setEp((j.endpoint_url as string) || ""); setEpErr(""); })
      .catch((e) => setEpErr(String(e.message || e)));
  };
  return (
    <div className="op-sov">
      <div className="op-sov-head">
        <span className="op-slider-title">
          Sovereignty testing
          <InfoTip text="The Sovereignty pillar is the paid tier's real-world autonomy test. With this on, your agent will — during paid runs — be asked to sign a challenge with its own key, broadcast a real micro-payment from a wallet it controls, answer a challenge on an endpoint it hosts, and recall a fact across sessions. It acts on its OWN operator credentials; Verigent never holds your keys. Nothing sovereign runs until you switch this on." />
        </span>
        <button className={`at-toggle${s.authorized ? " on" : ""}`} role="switch" aria-checked={s.authorized} aria-label="Authorise sovereignty testing"
          onClick={() => save({ authorized: !s.authorized })}>
          <span className="at-knob" />
        </button>
      </div>
      <p className="op-sov-note">
        {s.authorized
          ? "Authorised — your next paid run includes the Sovereignty pillar and can lift the score ceiling above 70."
          : "Off — Sovereignty stays locked and your ceiling is capped at 70. Switch on to authorise real-world challenges."}
      </p>
      {s.authorized && (
        <div className="op-sov-ep">
          <label className="op-label" htmlFor="sov-ep">Hosted challenge endpoint <InfoTip text="Optional. A public HTTPS URL your agent controls — we POST the infrastructure-independence challenge here and expect its signed answer. Leave blank if your agent has no hosted endpoint; that one dimension simply won't score." /></label>
          <div className="op-sov-row">
            <input id="sov-ep" type="url" inputMode="url" placeholder="https://your-agent.example/vg-challenge" value={ep}
              onChange={(e) => setEp(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save({ endpoint_url: ep.trim() }); }} aria-label="Hosted challenge endpoint" />
            <button onClick={() => save({ endpoint_url: ep.trim() })}>Save</button>
          </div>
          {epErr && <span className="op-sov-err">{epErr}</span>}
          {/* The exact challenge contract + minimal reference handlers (Ant 2026-07-08). The dimension
              is unpassable without the contract, so it lives right here. The proof is that the owner
              CONTROLS and HOSTS a keyed endpoint — not that they wrote the handler — so a copy-paste
              reference lifts completion without cheapening the proof. Contract mirrors
              functions/lib/sovereignty-tests.ts (computeWebhookProof / verifyWebhookProof) exactly. */}
          <details className="op-sov-contract">
            <summary>How the challenge works — contract + copy-paste handler</summary>
            <ol>
              <li>During a paid run your agent&apos;s task prompt includes a <strong>per-run webhook secret</strong>. Provision it into your endpoint&apos;s config (env var) — never send the secret itself over the wire.</li>
              <li>At verification time Verigent POSTs JSON to your endpoint:{" "}
                <code>{`{"challenge": "<fresh 32-hex value>", "callback": "<per-run URL>"}`}</code>{" "}
                — the challenge is generated fresh at grade time, so the answer can&apos;t be pre-baked.</li>
              <li>Your endpoint must reply <strong>HTTP 200</strong> with{" "}
                <code>{`{"proof": "<HMAC-SHA256(key = secret, message = challenge), lowercase hex>", "timestamp": "<ISO>"}`}</code>.
                Echoing the challenge, returning a constant, or anything other than the correct HMAC scores zero.</li>
            </ol>
            <p className="op-sov-ref-label">Cloudflare Worker (JavaScript):</p>
            <pre>{`export default {
  async fetch(req, env) {
    const { challenge } = await req.json();
    const key = await crypto.subtle.importKey("raw",
      new TextEncoder().encode(env.VG_SECRET),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key,
      new TextEncoder().encode(challenge));
    const proof = [...new Uint8Array(sig)]
      .map((b) => b.toString(16).padStart(2, "0")).join("");
    return Response.json({ proof, timestamp: new Date().toISOString() });
  }
};`}</pre>
            <p className="op-sov-ref-label">Flask (Python):</p>
            <pre>{`import hmac, hashlib, os
from datetime import datetime, timezone
from flask import Flask, request, jsonify
app = Flask(__name__)

@app.post("/vg-challenge")
def vg_challenge():
    challenge = request.get_json()["challenge"]
    proof = hmac.new(os.environ["VG_SECRET"].encode(),
                     challenge.encode(), hashlib.sha256).hexdigest()
    return jsonify(proof=proof,
                   timestamp=datetime.now(timezone.utc).isoformat())`}</pre>
            <p className="op-sov-host-note">Deploy it anywhere <em>you</em> control — a Worker, a VPS, a Lambda. Hosting it yourself is the point: controlling a live keyed endpoint IS the infrastructure-independence proof, so Verigent never hosts it for you.</p>
          </details>
        </div>
      )}
      {s.authorized && !isDemo && <SovereigntyRetest handle={handle} />}
    </div>
  );
}

type RetestInfo = {
  fee_cents: number; weekly_cap: number; used_this_week: number; remaining: number;
  running: boolean; eligible: boolean; reason?: string;
};
type RetestDone = { sovereignty_score: number; balance_cents: number; fee_cents: number; billed: boolean; remaining_this_week: number };
// The on-demand Sovereignty retest (spec: docs/SOVEREIGNTY-RETEST-SPEC.md, Ant rulings
// 2026-07-11). Fee/cap render ONLY from the API (pricing.ts stays the one owner — §2.10; that's
// also why this block is skipped in ?demo mode: no fake literals to drift). Copy rules: price
// shown at the moment of commitment (§2.6); never implies a known check time or a better score —
// a retest is a real test and scores can move either way.
function SovereigntyRetest({ handle }: { handle: string }) {
  const [info, setInfo] = useState<RetestInfo | null>(null);
  const [phase, setPhase] = useState<"idle" | "confirm" | "running" | "done" | "error">("idle");
  const [done, setDone] = useState<RetestDone | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    fetch(`/api/owner/sovereignty-retest?handle=${encodeURIComponent(handle)}`, { headers: { Accept: "application/json" }, credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j && typeof j.fee_cents === "number") setInfo(j as RetestInfo); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!info) return null;
  const fee = `$${(info.fee_cents / 100).toFixed(2)}`;
  const fire = () => {
    setPhase("running");
    fetch("/api/owner/sovereignty-retest", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ handle }) })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.status === "completed") { setDone(j as RetestDone); setPhase("done"); }
        else { setErr(j.error || "The retest could not complete. Nothing was charged."); setPhase("error"); }
      })
      .catch(() => { setErr("The retest could not complete. Nothing was charged."); setPhase("error"); });
  };
  return (
    <div className="op-retest">
      <div className="op-sov-head">
        <span className="op-slider-title">
          Sovereignty retest
          <InfoTip text={`Re-verifies the seven sovereignty proof dimensions on demand — fresh challenges served straight to your agent's endpoint, verified from real actions. Flat ${fee}, billed only when the retest scores; if your agent can't be reached, nothing is charged. Scores refresh forward and can move in either direction. Up to ${info.weekly_cap} per rolling week. Your regular random checks are unaffected.`} />
        </span>
        {phase === "idle" && (
          <button className="op-retest-btn" disabled={!info.eligible || info.running}
            onClick={() => setPhase("confirm")}>Retest sovereignty</button>
        )}
        {phase === "confirm" && (
          <span className="op-retest-confirm">
            <button className="op-retest-btn" onClick={fire}>Confirm — {fee}</button>
            <button className="op-retest-cancel" onClick={() => setPhase("idle")}>Cancel</button>
          </span>
        )}
        {phase === "running" && <span className="op-retest-running">Testing sovereignty now…</span>}
        {(phase === "done" || phase === "error") && (
          <button className="op-retest-btn" onClick={() => { setPhase("idle"); setErr(""); }}>Retest sovereignty</button>
        )}
      </div>
      {phase === "idle" && !info.eligible && info.reason && <p className="op-sov-note">{info.reason}</p>}
      {phase === "idle" && info.eligible && (
        <p className="op-sov-note">Fresh sovereignty proof on demand — {fee} per retest, {info.remaining} of {info.weekly_cap} left this week.</p>
      )}
      {phase === "running" && (
        <p className="op-sov-note">Your agent is being served the sovereignty challenges and is acting on them. This can take a couple of minutes.</p>
      )}
      {phase === "done" && done && (
        <p className="op-sov-note">
          Sovereignty re-verified — pillar score {Number(done.sovereignty_score).toFixed(1)}.
          {done.billed ? ` ${fee} debited — wallet balance $${(done.balance_cents / 100).toFixed(2)}.` : ""}
          {` ${done.remaining_this_week} retest${done.remaining_this_week === 1 ? "" : "s"} left this week.`}
        </p>
      )}
      {phase === "error" && <span className="op-sov-err">{err}</span>}
    </div>
  );
}

// Owner-only insights — the movement dashboard under Published weeks (Ant 2026-07-02). Everything
// derives client-side from the published-weeks history; nothing here is public. Register: report
// card, positive functional framing — where the improvement is landing and what to sharpen next.
// Shown until there are two published weeks to compare — was `return null`, which left the section
// header sitting over a void (looked broken). An honest empty state instead: the insights are
// week-over-week, so a single published week has no trajectory yet.
function OiEmpty() {
  return (
    <div className="reveal oi-empty">
      <p>
        Your insights compare your <strong>published weeks</strong> — overall trajectory, recent
        momentum, and the dimensions that moved most. You have your first published week; the
        movement view appears here once your next weekly score publishes (every Monday 9am).
        Your agent keeps testing in the background in the meantime.
      </p>
    </div>
  );
}

function OwnerInsights({ weekly }: { weekly: WeeklyData }) {
  const snaps = [...weekly.archive].reverse().concat(weekly.published_week ? [weekly.published_week] : []);
  if (snaps.length < 2) return <OiEmpty />;
  const first = snaps[0], last = snaps[snaps.length - 1];

  // Composite trajectory across the window + recent momentum (mean weekly change, last 3 moves).
  const windowDelta = (last.composite ?? 0) - (first.composite ?? 0);
  const moves = snaps.slice(1).map((s, i) => (s.composite ?? 0) - (snaps[i].composite ?? 0));
  const recent = moves.slice(-3);
  const momentum = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;

  // Per-dimension movement first→latest week: the best climber and the biggest pullback.
  const dimDelta: Array<{ key: string; delta: number; now: number }> = [];
  for (const key of Object.keys(last.dimension_scores || {})) {
    const then = first.dimension_scores?.[key];
    const now = last.dimension_scores?.[key];
    if (typeof then === "number" && typeof now === "number") {
      dimDelta.push({ key, delta: Math.round(now - then), now: Math.round(now) });
    }
  }
  if (!dimDelta.length) return <OiEmpty />;
  const bestDim = dimDelta.reduce((a, b) => (b.delta > a.delta ? b : a));
  const worstDim = dimDelta.reduce((a, b) => (b.delta < a.delta ? b : a));
  const lowestDim = dimDelta.reduce((a, b) => (b.now < a.now ? b : a));

  const lowestPillarOfDim = PILLARS.find((p) => p.dims.some((d) => d.key === lowestDim.key));

  const signed = (n: number, dp = 0) => `${n > 0 ? "+" : ""}${dp ? n.toFixed(dp) : Math.round(n)}`;
  const label = (k: string) => DIM_LABEL[k] || k;

  return (
    <div className="reveal oi">
      <div className="oi-grid">
        <div className="oi-stat">
          <div className="oi-label">Trajectory · {snaps.length} weeks</div>
          <div className={`oi-val ${windowDelta >= 0 ? "up" : "down"}`}>{signed(windowDelta)}</div>
          <div className="oi-sub">{first.composite} → {last.composite} composite</div>
        </div>
        <div className="oi-stat">
          <div className="oi-label">Momentum · last 3 weeks</div>
          <div className={`oi-val ${momentum >= 0 ? "up" : "down"}`}>{signed(momentum, 1)}<span className="oi-unit">/wk</span></div>
          <div className="oi-sub">mean weekly movement of the published score</div>
        </div>
        <div className="oi-stat">
          <div className="oi-label">Personal best</div>
          <div className="oi-val">{weekly.personal_best?.composite ?? "—"}</div>
          <div className="oi-sub">{weekly.is_personal_best ? "set this week" : `${weekly.personal_best?.week_label ?? ""} — ${Math.max(0, (weekly.personal_best?.composite ?? 0) - (last.composite ?? 0))} away`}</div>
        </div>
        <div className="oi-stat">
          <div className="oi-label">Best climber</div>
          <div className="oi-val up">{signed(bestDim.delta)}</div>
          <div className="oi-sub">{label(bestDim.key)} — now {bestDim.now}</div>
        </div>
        <div className="oi-stat">
          <div className="oi-label">Largest pullback</div>
          <div className={`oi-val ${worstDim.delta < 0 ? "down" : ""}`}>{signed(worstDim.delta)}</div>
          <div className="oi-sub">{label(worstDim.key)} — now {worstDim.now}</div>
        </div>
        <div className="oi-stat">
          <div className="oi-label">Lowest score</div>
          <div className="oi-val">{lowestDim.now}</div>
          <div className="oi-sub">{label(lowestDim.key)}{lowestPillarOfDim ? ` — ${lowestPillarOfDim.name}, ${lowestPillarOfDim.weight} of composite` : ""}</div>
        </div>
      </div>
    </div>
  );
}

// Owner controls — wallet balance / proof-remaining / challenges-per-day / auto-top-up / referrals /
// top-up. Rendered inside the VG-key expanding drawer (owner-only, opens on demand).
function OwnerControls({ data, handle, onReload }: { data: AgentData; handle: string; onReload?: () => void }) {
  const wallet = data.wallet;
  const [challenges, setProbes] = useState(wallet?.probes_per_day ?? 5);
  const [refEmail, setRefEmail] = useState("");
  const [refSent, setRefSent] = useState(false);
  // Billing mode (Ant 2026-07-04): "Add credit" swaps the drawer to a deliberate WHITE billing panel
  // with the embedded card form; on credit it flips back to dark with the updated balance shown.
  const [billing, setBilling] = useState(false);
  // Fresh wallet figures refetched AFTER a top-up credits. Previously only the balance string was
  // patched, so PROOF REMAINING and TOTAL TOPPED UP kept computing from the pre-top-up payload and
  // read "0 days"/"$0.00" against a $10 balance (Ant 2026-07-08, money-path test T4). All three stats
  // now derive from the same effective figures.
  const [freshWallet, setFreshWallet] = useState<{ balance_cents: number; total_topped_up_cents: number } | null>(null);
  const refreshWallet = () => {
    fetch(`/api/wallet/balance?${new URLSearchParams({ handle })}`, { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j && typeof j.balance_cents === "number") {
          setFreshWallet({ balance_cents: j.balance_cents, total_topped_up_cents: j.total_topped_up_cents ?? 0 });
        }
      })
      .catch(() => {});
  };
  // Signed-in owner email + THIS agent's probing state, from /api/owner/me (Ant 2026-07-08): the
  // drawer must say which account you're operating as AND whether the agent is actually pulling
  // probes — continuous is agent-PULL, so an armed-but-never-pulling agent needs the setup handoff
  // right here, not silence.
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null);
  const [probing, setProbing] = useState<{ active: boolean; pending: boolean; paused: boolean; reverifying: boolean; ranBefore: boolean; pulls: number; setup_prompt?: string; setup_parts?: { command: string; config_json: string; agent_paste: string } } | null>(null);
  // Bump to re-pull /api/owner/me — the paused/active strip is otherwise a snapshot from mount, which
  // left "paused, wallet empty" on screen next to a freshly credited balance (Ant 2026-07-10).
  const [probingBump, setProbingBump] = useState(0);
  const refreshProbing = () => setProbingBump((b) => b + 1);
  // LIVE wallet while the drawer is open (Ant 2026-07-10 — "had to refresh to see 7¢ → 1¢"): debits
  // happen server-side on the agent's own pulls, so the balance + status strip + the whole report
  // (freshness badge!) re-pull every 30s — watching a drain flip Current → Ageing needs no refresh.
  useEffect(() => {
    const t = setInterval(() => { refreshWallet(); refreshProbing(); onReload?.(); }, 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = () => {
      fetch("/api/owner/me", { headers: { Accept: "application/json" }, credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!j || stop) return;
          setOwnerEmail(j?.owner?.email || null);
          const me = (j?.agents || []).find((a: any) => (a.handle || a.agent_id || "").toLowerCase() === handle.toLowerCase());
          if (me) {
            setProbing({ active: !!me.continuous_active, pending: !!me.continuous_pending, paused: !!me.paused_empty, reverifying: !!me.reverifying, ranBefore: !!me.ran_before, pulls: me.self_pull_count || 0, setup_prompt: me.setup_prompt, setup_parts: me.setup_parts });
            // Live activation (Ant 2026-07-08 — "couldn't it update automatically?"): while the agent
            // is armed-but-not-active, keep polling so "Action needed" flips to "Challenges active"
            // the moment its two pulls land — no refresh. Stops as soon as it's active (or not pending).
            if (me.continuous_pending && !me.continuous_active) timer = setTimeout(poll, 20_000);
          }
        })
        .catch(() => {});
    };
    poll();
    return () => { stop = true; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probingBump]);
  const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
  const balanceCents = freshWallet?.balance_cents ?? wallet?.balance_cents ?? 0;
  const toppedUpCents = freshWallet?.total_topped_up_cents ?? wallet?.total_topped_up_cents ?? 0;
  // Daily rate = per-challenge debit × challenges/day (per-challenge billing, Ant 2026-07-08).
  // per_challenge_cents comes from the API (derived from the agent's locked rate) so the number
  // shown here is exactly what probe/finish debits. 5¢ fallback = the founder rate.
  const perChallengeCents = wallet?.per_challenge_cents ?? 5;
  const dailyCents = Math.max(1, perChallengeCents * challenges);
  const daysLeft = Math.floor(balanceCents / dailyCents);
  // Free-window: while free_until is in the future, scored challenges bill $0. Showing the exact
  // start prevents a top-up-during-the-window reading as "billing broken" (Ant 2026-07-10).
  const freeUntilMs = wallet?.free_until ? Date.parse(wallet.free_until.replace(" ", "T") + "Z") : NaN;
  const inFreeWindow = Number.isFinite(freeUntilMs) && freeUntilMs > Date.now();
  const billingStartStr = inFreeWindow
    ? new Date(freeUntilMs).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : null;
  const post = (url: string, body: object) =>
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
  const sendRef = () => { if (refEmail.includes("@")) { post("/api/owner/refer", { email: refEmail.trim(), handle }); setRefSent(true); } };
  if (!wallet) return null;

  const balanceDisplay = usd(balanceCents);
  // BILLING MODE — deliberate WHITE (Ant-authorized dark-only exception). The SAME .sc-body persists and
  // just gets .billing-on, so its background BLENDS dark→white (CSS transition) and the content cross-
  // fades — no hard DOM swap, no snap. Billing content floats directly on the white (no card chrome).
  return (
          <div className={`sc-body${billing ? " billing-on" : ""}`}>
            {billing && (
              <TopupRails
                handle={handle}
                onCancel={() => setBilling(false)}
                // On credit: refresh the wallet figures, the whole report (freshness badge →
                // Current·Provisional) AND the owner/me probing strip (clears "paused, wallet empty").
                // The delayed second pull absorbs any server write that lands just after the balance
                // bump the payment poll keys on (Ant 2026-07-10).
                onDone={() => {
                  const pull = () => { refreshWallet(); onReload?.(); refreshProbing(); };
                  pull();
                  setTimeout(pull, 2500);
                  setBilling(false);
                }}
              />
            )}
            <div className="sc-dark" aria-hidden={billing}>
            {/* Account + probing status strip (Ant 2026-07-08): which email you're signed in as, and
                whether THIS agent is actually pulling its probes. An armed agent that has never
                pulled gets the amber setup call-to-action with the exact prompt — never left hanging. */}
            <div className="op-status">
              {ownerEmail && <span className="op-status-email">Signed in as <b>{ownerEmail}</b></span>}
              {probing && (
                // State ladder (Ant ruling 2026-07-10): PAUSED outranks pending — an armed-but-broke
                // agent's next pull 402s, so "waiting on next pull" would be a lie. Amber is reserved
                // for states that need the OWNER's hand (top-up / first-time setup); a funded, armed
                // veteran is GREEN — a healthy state, not a warning.
                probing.active
                  ? <span className="op-status-probe on">● Challenges active</span>
                  : probing.paused
                    ? <span className="op-status-probe arm">● Continuous pulls set up — wallet empty. Top up to keep challenges going.</span>
                    : probing.pending
                      ? probing.ranBefore
                        ? probing.reverifying
                          ? <span className="op-status-probe on">● Continuous on — re-verifying (provisional)</span>
                          : <span className="op-status-probe on">● Continuous pulls set up — waiting on your agent&apos;s next pull</span>
                        : <span className="op-status-probe arm">● Action needed — set up challenge pull ({probing.pulls}/2 pulls)</span>
                      : <span className="op-status-probe off">● Continuous challenges off</span>
              )}
              {/* Early warning BEFORE the wallet runs dry (Ant 2026-07-10): funded but ≤3 days of
                  challenges left — nudge now, while it's still green above. */}
              {probing && !probing.paused && (probing.active || (probing.pending && probing.ranBefore)) && balanceCents > 0 && daysLeft <= 3 && (
                <span className="op-status-probe arm">● Credit low — top up soon to keep challenges going</span>
              )}
            </div>
            {/* Setup box only for an agent that has NEVER pulled — a veteran's scheduler already exists,
                so re-showing MCP setup steps after every top-up is noise (Ant 2026-07-10). */}
            {probing?.pending && !probing.ranBefore && (probing.setup_parts || probing.setup_prompt) && (
              // Closed by default (Ant 2026-07-08): the amber status strip + this summary line carry
              // the signal; auto-expanding the full paste overwhelmed the drawer's first impression.
              <details className="op-setup">
                <summary>Set up your agent&apos;s challenge pull — two quick steps</summary>
                <p>Continuous testing works by <strong>your agent pulling its own challenges</strong> — Verigent never reaches into your agent. Your handle + pull token live in the server&apos;s config, so your agent never handles raw credentials. The status shows <em>active</em> after its first two successful pulls.</p>
                {probing.setup_parts ? (
                  <>
                    <p className="op-setup-step"><b>1 · Run this once</b> — adds the Verigent MCP server (Claude Code):</p>
                    <SetupBox text={probing.setup_parts.command} label="Copy command" />
                    <details className="op-setup-alt">
                      <summary>Using a different harness? The equivalent JSON config</summary>
                      <SetupBox text={probing.setup_parts.config_json} label="Copy JSON config" />
                    </details>
                    <p className="op-setup-step"><b>2 · Then paste this to your agent</b> — the standing grant + its instruction:</p>
                    <SetupBox text={probing.setup_parts.agent_paste} label="Copy agent paste" />
                  </>
                ) : (
                  <SetupBox text={probing.setup_prompt} label="Copy setup prompt" />
                )}
                <p className="op-setup-note">Light on your agent, by design: each challenge is a short goal plus a few small tool calls — typically a couple of thousand tokens end-to-end, so even ~5 a day is a rounding error against normal agent usage. It only ever runs at the cadence you set here.</p>
                <p className="op-setup-note">Tip: for an agent that isn&apos;t always running, add the paste to a scheduled job (cron / launchd / Task Scheduler) so it pulls a few times a day on its own.</p>
              </details>
            )}
            <div className="op-grid">
              <div className="op-stat"><div className="op-label">Balance</div><div className="op-val">{balanceDisplay}</div></div>
              <div className="op-stat">
                {/* Tip opens BELOW the icon — above, it clipped off the top of the window (Ant 2026-07-08). */}
                <div className="op-label">Proof remaining <InfoTip below text={`Days your balance covers at the current rate (${challenges} challenges/day ≈ ${usd(dailyCents)}/day).`} /></div>
                <div className="op-val">{daysLeft} <span className="op-unit">days</span></div>
              </div>
              <div className="op-stat"><div className="op-label">Total topped up</div><div className="op-val">{usd(toppedUpCents)}</div></div>
            </div>

            {billingStartStr && (
              // Free-window banner: your balance sits untouched until billing begins — shown so a top-up
              // during the free window doesn't read as broken (Ant 2026-07-10).
              <div className="op-freewindow">
                <span className="op-fw-dot" />
                <span>Free until <b>{billingStartStr}</b> — challenges run at no charge. Billing starts then at <b>{usd(dailyCents)}/day</b>; your balance is held until it does.</span>
              </div>
            )}

            <div className="op-slider">
              <div className="op-slider-head">
                <span className="op-slider-title">
                  Challenges per day: <b>{challenges}</b>
                  <InfoTip text={`More challenges mean fresher, faster-moving proof and quicker score updates — but your wallet drains faster. At ${challenges}/day that's about ${usd(dailyCents)}/day, so your balance lasts ~${daysLeft} days.`} />
                </span>
                <span className="op-rate">≈ {usd(dailyCents)}/day</span>
              </div>
              <input className="op-range" type="range" min={5} max={20} step={1} value={challenges}
                onChange={(e) => setProbes(Number(e.target.value))}
                onPointerUp={() => {
                  // persist on release (never mid-drag); demo mode has no owner session — skip
                  if (!new URLSearchParams(window.location.search).has("demo")) {
                    // /api/owner/probes is the real endpoint — the old /api/owner/challenges URL 404'd
                    // and the slider's value never persisted (audit find, Ant 2026-07-08).
                    post("/api/owner/probes", { handle, probes_per_day: challenges });
                  }
                }}
                aria-label="Challenges per day" />
              <div className="op-scale"><span>5 · steady</span><span>20 · aggressive</span></div>
            </div>

            <AutoTopup seed={wallet.autotopup} handle={handle} />

            <SovereigntyAuth seed={wallet.sovereignty} handle={handle} />

            <div className="sc-actions">
              <div className="sc-refer">
                <div className="op-label">Refer an agent <InfoTip text="Send an invite — they arrive already credited to you, so you earn $2/month in credit while they keep verifying. They don't have to enter anything. Credit is capped at your own bill's floor, and it never runs your agent at a loss." /></div>
                {(() => {
                  const active = wallet.referrals?.active ?? 0;
                  if (active < 1) return null;
                  const per = wallet.referrals?.credit_cents_per ?? 200;
                  const total = active * per;
                  const list = wallet.referrals?.list ?? [];
                  return (
                    <div className="sc-refbox">
                      <p className="sc-refstats">
                        {active} active · {usd(per)}/mo credit each
                      </p>
                      <p className="sc-reftotal">
                        {active} {active === 1 ? "agent" : "agents"} referred · <b>{usd(total)}/mo total credit</b>
                      </p>
                      {list.length > 0 && (
                        <div className="sc-reflist">
                          <div className="sc-reflist-head">Your referrals</div>
                          {list.map((r, i) => (
                            <div className="sc-refrow" key={i}>
                              <span className="sc-ref-who">{r.label}</span>
                              <span className={`sc-ref-status st-${r.status}`}>{r.status}</span>
                              <span className="sc-ref-credit">{usd(r.credit_cents)}/mo</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
                {refSent ? (
                  <p className="sc-refsent">Invite sent — you&apos;ll be credited automatically once they start verifying.</p>
                ) : (
                  <div className="sc-refer-row">
                    <input type="email" placeholder="their@email.com" value={refEmail}
                      onChange={(e) => setRefEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") sendRef(); }}
                      aria-label="Referral email" />
                    <button onClick={sendRef}>Send invite →</button>
                  </div>
                )}
              </div>
              {/* Add credit ENTERS billing mode (white panel, in-drawer card form) — no navigation away.
                  /keep-current stays as a standalone fallback (link unchanged elsewhere). */}
              <button className="btn-verify sc-topup" onClick={() => setBilling(true)}>Add credit →</button>
            </div>

            {/* New-agent entry point only (Ant 2026-07-08): a signed-in owner already has the "Agents"
                nav button, so a second "Manage your agents" link here was redundant — dropped. The
                signed-in email lives ONLY in the status strip at the top (a second copy down here
                read as clutter — Ant 2026-07-08). */}
            <div className="sc-manage">
              <a className="sc-manage-new" href="/agents">Set up a new agent →</a>
            </div>
            </div>{/* /.sc-dark */}
          </div>
  );
}

// Inline owner code-login, lived inside the drawer for a not-yet-signed-in viewer: email → one-time
// code → session (no redirect). On success it re-fetches the report so the drawer unlocks in place.
function OwnerLogin({ handle, onUnlock, open }: { handle: string; onUnlock: () => void; open: boolean }) {
  const [stage, setStage] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // Focus the email field when the OWNER DRAWER opens — NOT on mount. autoFocus-on-mount fired while
  // the drawer was still closed, and with scroll-behavior:smooth the browser scrolled the hidden input
  // into view, jumping the page ~580px past the whole hero on load (Ant 2026-07-07). Focusing only on
  // open keeps the nice "click owner controls → cursor's in the field" behaviour without the jump.
  const emailRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open && stage === "email") emailRef.current?.focus(); }, [open, stage]);
  const requestCode = async () => {
    if (!email.includes("@")) return;
    setBusy(true); setErr("");
    try {
      await fetch("/api/owner/request-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim(), handle }) });
      setStage("code");
    } catch { setErr("Couldn't reach the sign-in service."); }
    setBusy(false);
  };
  const verify = async () => {
    if (!code.trim()) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/owner/verify-code", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ email: email.trim(), handle, code: code.trim() }) });
      const d = await r.json().catch(() => ({}));
      if (d.ok) { onUnlock(); return; }
      setErr(d.error === "expired" ? "That code expired — request a new one." : d.error === "too_many_attempts" ? "Too many tries — request a fresh code." : "That code didn't match. Check it and try again.");
    } catch { setErr("Couldn't reach the sign-in service."); }
    setBusy(false);
  };
  return (
    <div className="owner-login ol-split">
      {/* LEFT: compact, high-level "why register" — what an owner gets from Verigent (Ant 2026-07-06). */}
      <aside className="ol-benefits">
        <div className="ol-ben-title">Why test your agent</div>
        <ul>
          <li><strong>Know how good your agent really is</strong> — continuously tested across every capability, never self-reported.</li>
          <li><strong>See exactly where to fix it</strong> — your weakest dimensions surfaced, with a prompt to sharpen each one.</li>
          <li><strong>A public report + weekly standings</strong> that prove your agent is the real thing.</li>
          <li><strong>A verified on-chain certificate</strong> anchored to Bitcoin — provable without trusting us.</li>
        </ul>
      </aside>
      {/* RIGHT: the sign-in form */}
      <div className="ol-signin">
        {stage === "email" ? (
          <>
            <div className="ol-label">Sign in as this agent&apos;s owner</div>
            <p className="ol-note">Enter the owner email and we&apos;ll send a one-time code to sign in right here — no redirect, no password.</p>
            <div className="ol-row">
              <input type="email" placeholder="Your owner email" value={email} ref={emailRef}
                onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") requestCode(); }} aria-label="Owner email" />
              <button disabled={busy || !email.includes("@")} onClick={requestCode}>{busy ? "…" : "Send code →"}</button>
            </div>
          </>
        ) : (
          <>
            <div className="ol-label">Enter your code</div>
            <p className="ol-note">If that email owns this agent, a one-time code is on its way (expires in 10 minutes). Enter it below.</p>
            <div className="ol-row">
              <input inputMode="text" autoCapitalize="characters" placeholder="8-character code" value={code} autoFocus
                onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") verify(); }} aria-label="Sign-in code" />
              <button disabled={busy || !code.trim()} onClick={verify}>{busy ? "…" : "Unlock →"}</button>
            </div>
            <button className="ol-back" onClick={() => { setStage("email"); setErr(""); setCode(""); }}>← use a different email</button>
          </>
        )}
        {err && <p className="ol-err">{err}</p>}
      </div>
    </div>
  );
}

// Click-to-open, copyable dimension detail (supersedes the hover tooltip). The owner copies the
// improvement prompt and pastes it to their agent — the dyno/self-improvement hook. Moat-safe:
// dimension purpose + score only, never the task prompt.
// taskScore = null → opened at the DIMENSION level (the "improve this dimension" action), not a single
// task chip, so the popover frames it as a focus-area/strength rather than one challenge's score.
type TaskPop = { dim: string; summary: string; dimScore: number; taskScore: number | null; err: boolean; x: number; y: number };

function TaskPopover({ pop, onClose }: { pop: TaskPop; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const summary = pop.summary && !/[.!?]$/.test(pop.summary.trim()) ? pop.summary.trim() + "." : pop.summary.trim();
  // Score-aware prompt (was hard-coded "weak spot" for every dim, even a 90). Weak → focus here; strong
  // → hold the line. This is the TARGETED "fix one thing" prompt — distinct from the full report card.
  const weak = pop.dimScore < 60;
  const copyText = `Verigent — ${pop.dim} scored ${pop.dimScore}/100. What it measures: ${summary} ${weak
    ? `This is a weak spot: focus your next round of self-improvement here — work on getting better at ${pop.dim.toLowerCase()}.`
    : `This is a relative strength — keep it sharp so it doesn't regress, and put your effort into your lower-scoring dimensions.`}`;
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const t = window.setTimeout(() => document.addEventListener("mousedown", onDoc), 0); // don't catch the opening click
    document.addEventListener("keydown", onEsc);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc); };
  }, [onClose]);
  const copy = () => {
    navigator.clipboard?.writeText(copyText).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  };
  const W = 312;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const left = Math.max(12, Math.min(pop.x - W / 2, vw - W - 12));
  const top = pop.y + 10;
  return (
    <div ref={ref} className="taskpop" style={{ left, top, width: W }} role="dialog" aria-label={`${pop.dim} detail`}>
      <button className="taskpop-x" onClick={onClose} aria-label="Close">×</button>
      <div className="taskpop-head">
        <span className="taskpop-dim">{pop.dim}</span>
        <span className="taskpop-score">{pop.dimScore}<i>/100</i></span>
      </div>
      <p className="taskpop-sum"><b>What it measures:</b> {summary}</p>
      {pop.err
        ? <p className="taskpop-note">This challenge was error-injected (anti-gaming) — a low score here is expected.</p>
        : pop.taskScore != null
          ? <p className="taskpop-note">This challenge scored {pop.taskScore}. The figure above is the dimension average across its challenges.</p>
          : weak
            ? <p className="taskpop-note">One of this agent&apos;s weaker dimensions — a high-leverage place to focus the next improvement round.</p>
            : <p className="taskpop-note">Solid here. Copy this to your agent to keep it from regressing, and spend your effort on the weaker dimensions.</p>}
      {/* label distinguishes the TARGETED prompt from the full report card ("complete plan") */}
      <button className="taskpop-copy" onClick={copy}>{copied ? "Copied ✓" : weak ? "Copy fix-this prompt →" : "Copy this to your agent →"}</button>
    </div>
  );
}

// ONCE-PER-SESSION hero animation (Ant 2026-07-08): the first report view this browser session
// animates; every later view — including client-side SPA navigations to other reports — snaps.
// A MUTABLE module-level flag (not a load-time const) is what makes SPA-nav snap: within one SPA
// lifetime the module never reloads, so a frozen const stayed false forever and every registry
// click-through replayed the animation (Ant review fix). Seeded from sessionStorage so a hard
// refresh after the first view also snaps; flipped true by markHeroSeen() after the first play.
let heroSeenThisSession = typeof window !== "undefined" && (() => {
  try { return sessionStorage.getItem("vg_hero_seen") === "1"; } catch { return false; }
})();
function markHeroSeen() {
  heroSeenThisSession = true;
  try { sessionStorage.setItem("vg_hero_seen", "1"); } catch { /* private mode etc. */ }
}
const heroSnaps = () =>
  heroSeenThisSession ||
  (typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false));

// Dark setup box with a copy icon (Ant 2026-07-08) — same clipboard/tick SVGs as the VG-key copy.
function SetupBox({ text, label }: { text?: string; label: string }) {
  const [copied, setCopied] = useState(false);
  if (!text) return null;
  const copy = () => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  };
  return (
    <div className="op-setup-box">
      <pre>{text}</pre>
      <button className="copy-btn op-setup-copy" onClick={copy} aria-label={label} title={copied ? "Copied" : label}>
        {copied ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
        )}
      </button>
    </div>
  );
}

// Count-up for the composite score — the number AND the ring fill read from this one animating value,
// so they rise together. easeOutCubic decelerates into the final score. Snaps instantly under
// prefers-reduced-motion (accessibility + respects the user's setting).
function useCountUp(target: number | null, durationMs = 1400, delayMs = 0): number {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (target == null) { setVal(0); return; }
    if (heroSnaps()) {
      setVal(target); return;
    }
    let raf = 0;
    let t0 = 0;
    const tick = (now: number) => {
      if (!t0) t0 = now;
      const p = Math.min(1, (now - t0) / durationMs);
      setVal(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    // Hold at 0 through delayMs so the number starts climbing exactly as the composite block
    // reveals in the stagger (aligns the count-up beat with the ring appearing).
    const timer = setTimeout(() => { raf = requestAnimationFrame(tick); }, delayMs);
    return () => { clearTimeout(timer); cancelAnimationFrame(raf); };
  }, [target, durationMs, delayMs]);
  return val;
}

// True typewriter for any hero text line. Layout is pre-set from the known text: a hidden ghost span
// reserves the exact width/height (zero jank / no reflow while typing), and the live span overlays it
// character-by-character. Screen readers get the full text once (ghost aria-hidden, live aria-label).
// `as` picks the tag (h1 for the name, div for eyebrow/handle/class); `delay` staggers each line so
// they type in sequence. The caret only shows while ACTIVELY typing (so idle lines aren't all blinking).
// prefers-reduced-motion (or !play) shows the whole line immediately. `innerRef` is forwarded so the
// name-fit effect can still measure the ghost's width.
function Typewriter({ text, className, innerRef, play, speed = 55, delay = 0, as: Tag = "h1" }: {
  text: string; className?: string; innerRef?: React.Ref<HTMLHeadingElement>; play: boolean;
  speed?: number; delay?: number; as?: "h1" | "div" | "span";
}) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!play) { setN(0); return; }
    if (heroSnaps()) {
      setN(text.length); return;
    }
    let raf = 0;
    let t0 = 0;
    const tick = (now: number) => {
      if (!t0) t0 = now;
      const chars = Math.min(text.length, Math.round((now - t0) / speed));
      setN(chars);
      if (chars < text.length) raf = requestAnimationFrame(tick);
    };
    const timer = setTimeout(() => { raf = requestAnimationFrame(tick); }, delay);
    return () => { clearTimeout(timer); cancelAnimationFrame(raf); };
  }, [play, text, speed, delay]);
  const typing = play && n > 0 && n < text.length;
  return (
    <Tag className={`tw ${className || ""}`.trim()} ref={innerRef as React.Ref<HTMLHeadingElement>}>
      <span className="tw-ghost" aria-hidden="true">{text}</span>
      <span className="tw-live" aria-label={text}>
        {text.slice(0, n)}
        {typing && <span className="tw-caret" aria-hidden="true" />}
      </span>
    </Tag>
  );
}

export default function AgentProfilePage() {
  const [state, setState] = useState<"loading" | "ok" | "notfound" | "error" | "nohandle">("loading");
  const [data, setData] = useState<AgentData | null>(null);
  // Weekly publication layer — fetched separately from GET /api/standings/<handle> so the report
  // renders even if standings 404 (backend weekly_snapshots may not be live yet). ?vgdemo=weekly
  // injects a documented mock for visual dev until the endpoint lands.
  const [standings, setStandings] = useState<WeeklyData | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);
  // Owner-only "rewind": which continuous run the evidence breakdown reflects. null = current/latest.
  const [runView, setRunView] = useState<number | null>(null);
  // Click-to-open, copyable per-task popover (one at a time). Portaled to <body> so the drawer's
  // overflow:hidden can't clip it.
  const [taskPop, setTaskPop] = useState<TaskPop | null>(null);
  const [radarCopied, setRadarCopied] = useState(false);
  // Owner controls expand as a drawer off the VG-key line (owner-only). Default closed.
  const [ownerOpen, setOwnerOpen] = useState(false);
  // The owner-controls label PULSES UNTIL FIRST OPENED (Ant 2026-07-08 — was a fixed 3 beats), then
  // never again for this browser (localStorage). Initialised false so first-timers pulse; the mount
  // effect flips it for anyone who has already opened the drawer before the 8s pulse delay elapses.
  const [ocSeen, setOcSeen] = useState(false);
  useEffect(() => { try { if (localStorage.getItem("vg_oc_opened") === "1") setOcSeen(true); } catch {} }, []);
  const markOcSeen = () => { try { localStorage.setItem("vg_oc_opened", "1"); } catch {} setOcSeen(true); };
  // Single handler every "unlock / top up" affordance reuses: opens the Owner Controls drawer and
  // scrolls it into view. Every locked/paid-tier reference on the report points here (Ant 2026-07-08)
  // so the user is always one click from topping up the wallet + starting continuous testing.
  const openOwnerControls = () => {
    markOcSeen();
    setOwnerOpen(true);
    requestAnimationFrame(() => document.querySelector(".owner-line")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };
  // Arriving from the completed track page's "Log in to view your report →" (?signin=1) — open the owner
  // drawer straight away so the email sign-in is right there, not hunted for (Ant 2026-07-10).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("signin") === "1") openOwnerControls();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Hero load choreography: `heroReady` flips true one frame after the report resolves, which adds
  // `.play` to the page and fires the staggered reveal (eyebrow → typewriter name → … → composite
  // count-up → owner controls last). `reduced` mirrors prefers-reduced-motion so the whole thing snaps.
  const [heroReady, setHeroReady] = useState(false);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    // Capture the snap decision for THIS mount before anything flips the flag (children read
    // heroSnaps() live during their own reveal).
    setReduced(heroSnaps());
  }, []);
  useEffect(() => {
    if (state !== "ok") return;
    const r = requestAnimationFrame(() => setHeroReady(true));
    // Mark the hero seen only on UNMOUNT (leaving this report) — NOT during the mount — so THIS view
    // animates fully but the next report this session (SPA nav or refresh) snaps. Flipping it during
    // the mount would make children's live heroSnaps() reads snap the very first view (Ant review fix).
    return () => { cancelAnimationFrame(r); markHeroSeen(); };
  }, [state]);

  // Long names shrink to stay on ONE line beside the badge (Ant 2026-07-06): measure the name against
  // the space left in its row and scale the font down if it would wrap. Runs after data loads + on resize.
  const nameRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const fit = () => {
      const el = nameRef.current;
      if (!el) return;
      el.style.whiteSpace = "nowrap";
      el.style.fontSize = ""; // reset to the CSS clamp max, then measure
      const row = el.parentElement;
      if (!row) return;
      const cs = getComputedStyle(row);
      const gap = parseFloat(cs.columnGap || cs.gap || "0") || 0;
      let used = 0;
      Array.from(row.children).forEach((c) => { if (c !== el) used += (c as HTMLElement).offsetWidth + gap; });
      const avail = row.clientWidth - used;
      if (avail > 0 && el.scrollWidth > avail) {
        const base = parseFloat(getComputedStyle(el).fontSize);
        el.style.fontSize = `${Math.max(28, Math.floor((base * avail) / el.scrollWidth))}px`;
      }
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [data]);

  // Browser-tab title carries the agent's name (Ant 2026-07-08 — many report tabs open at once;
  // the static-export shell ships a generic title, so it's set here the moment the data lands).
  useEffect(() => {
    if (!data) return;
    const label = data.display_name || data.handle || data.agent_id;
    if (label) document.title = `${label} — Verigent report`;
  }, [data]);

  useEffect(() => {
    const handle = handleFromPath();
    if (!handle) {
      // Base /agent with no handle — there's no single agent to show.
      setState("nohandle");
      return;
    }
    // Preview mode: ?demo=1 renders a full mock report (+ demo standings) with no backend call —
    // lets the whole start→run→report flow be walked before any real test exists.
    // ?demo=1 → public preview · ?demo=owner → signed-in owner preview · ?demo=free → public preview of
    // a FREE-TIER run (Sovereignty untested → 🔒 locked + "top up to unlock" banner; owner drawer prompts email-in)
    const demoParam = new URLSearchParams(window.location.search).get("demo");
    if (demoParam === "1" || demoParam === "owner" || demoParam === "free") {
      setData(buildDemoData(handle, demoParam === "owner", demoParam === "free"));
      setState("ok");
      // ?demo=free skips the frozen weekly snapshot — otherwise its full dimension_scores (with
      // sovereignty) would override the current free-tier scores and hide the 🔒 lock.
      if (demoParam !== "free") setStandings(buildDemoStandings(handle));
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/agent/${encodeURIComponent(handle)}`, { headers: { Accept: "application/json" }, credentials: "include" });
        if (res.status === 404) { setState("notfound"); return; }
        if (!res.ok) { setState("error"); return; }
        const json = (await res.json()) as AgentData;
        setData(json);
        setState("ok");
      } catch {
        setState("error");
      }
    })();
    // Weekly standings — independent, non-blocking. Demo mock wins when ?vgdemo=weekly is set.
    (async () => {
      const demo = new URLSearchParams(window.location.search).get("vgdemo") === "weekly";
      if (demo) { setStandings(buildDemoStandings(handle)); return; }
      // In a demo report (?demo=…), don't pull LIVE standings — a real frozen snapshot would override
      // the demo's current scores (and re-introduce sovereignty on ?demo=free). Demo = self-contained.
      if (new URLSearchParams(window.location.search).has("demo")) return;
      try {
        const res = await fetch(`/api/standings/${encodeURIComponent(handle)}`, { headers: { Accept: "application/json" } });
        if (!res.ok) return; // no published weeks yet — surface simply doesn't render
        setStandings((await res.json()) as WeeklyData);
      } catch { /* standings are additive; failure is silent */ }
    })();
  }, []);

  // Hero count-up envelope — a 0→1 progress the score number + ring fill ride on load. Called HERE,
  // above the early returns, so it never trips the Rules of Hooks (that crash cost us a redeploy —
  // 2026-07-07). The target is a constant 100 so the effect fires exactly ONCE, when data flips from
  // null → present; `viewComposite` stays the single source of the real number, multiplied by this
  // envelope below. prefers-reduced-motion snaps it to 1 (handled inside useCountUp).
  const animP = useCountUp(state === "ok" ? 100 : null, 1900, 4300) / 100;

  if (state === "loading") {
    return (
      <div className="agentpage">
        <div className="rload">
          <span className="rspin" />
          <span>Loading verification report…</span>
        </div>
      </div>
    );
  }
  if (state === "nohandle" || state === "notfound") {
    return (
      <div className="agentpage">
        <div className="rmsg">
          <h1>{state === "notfound" ? "No such agent" : "Pick an agent"}</h1>
          <p>
            {state === "notfound"
              ? "We couldn't find a verified agent at that handle. It may not have been verified yet, or the handle is mistyped."
              : "Open an agent's report from its handle, e.g. /agent/your-handle."}
          </p>
          <a className="btn-primary" href="/registry">Browse the registry →</a>
        </div>
      </div>
    );
  }
  if (state === "error" || !data) {
    return (
      <div className="agentpage">
        <div className="rmsg">
          <h1>Couldn&apos;t load this report</h1>
          <p>Something went wrong fetching the report. Try again in a moment.</p>
          <a className="btn-primary" href="/registry">Browse the registry →</a>
        </div>
      </div>
    );
  }

  // ── Live data resolved ──
  const cur = data.current;
  const name = data.display_name || data.handle || data.agent_id;
  const handle = data.handle || data.agent_id;
  // Independent baseline — a frontier model Verigent runs itself. Suppresses owner-only chrome and
  // shows Verigent as the running entity (spec/SPEC-PUBLIC-BASELINES §5).
  const isBaseline = !!data.is_public_baseline;
  const tier = cur.tier || "V1";
  const composite = typeof cur.composite === "number" ? Math.round(cur.composite) : null;
  const dimScores = cur.dimension_scores || {};
  const classScores = cur.class_scores || {};

  // PUBLIC = weekly-frozen, OWNER = live (also enforced server-side in /api/agent/[handle]):
  // a public viewer's ring/tier/pillars/radar read the frozen published snapshot — the number only
  // moves on the weekly drop. The signed-in OWNER sees the LIVE continuous state up to the latest
  // challenge (the freshness badge carries currency). Falls back to live before the first publication.
  // Owners still rewind to any individual run (viewedRun).
  const pubWeek = standings?.published_week ?? null;
  const frozen = !data.is_owner && pubWeek ? pubWeek : null;
  const baseComposite = frozen && typeof frozen.composite === "number" ? Math.round(frozen.composite) : composite;
  const baseTier = frozen?.tier || tier;
  // Composite/tier stay frozen for the public view, but the per-dimension breakdown + radar fall back
  // to the live current scores if the frozen snapshot's breakdown is empty (a snapshot can freeze the
  // composite before the registry breakdown lands — that showed flat bars + no radar sprite). After
  // the backfill this never triggers; it's belt-and-suspenders so the report can't render blank.
  const nonEmptyRec = (o?: Record<string, number>) => !!o && Object.keys(o).length > 0;
  const baseDims = frozen && nonEmptyRec(frozen.dimension_scores) ? (frozen.dimension_scores || {}) : dimScores;
  const baseClass = frozen && nonEmptyRec(frozen.class_scores) ? (frozen.class_scores || {}) : classScores;

  // Owner rewind: the run the report reflects (ring + radar + pillars + evidence). null → published.
  const viewedRun = runView != null ? data.history[runView] : null;
  const viewScores = viewedRun ? toRecord(viewedRun.dimension_scores || {}) : baseDims;
  const viewClassScores = viewedRun ? (viewedRun.class_scores || {}) : baseClass;
  const viewComposite = viewedRun && typeof viewedRun.composite === "number" ? Math.round(viewedRun.composite) : baseComposite;
  // Longitudinal dims NOT yet measured on the shown run — honest first-run "measurement starts on your
  // next run" state (Ant 2026-07-07). Truth comes from the run's dimension_status (grade-batch finalize
  // → checkpoints.dimension_status). Only applies to the CURRENT view; an owner rewind to an older run
  // carries no per-run status in the history payload, so we never guess a past run was pending.
  const viewStatus: Record<string, string> = viewedRun ? {} : (cur.dimension_status || {});
  // Sovereignty is "demonstrated" only when the run carries a REAL sovereignty proof (payment,
  // identity/signature, webhook, recall) — never the cert anchor or probe-draw commitment, which EVERY
  // run has. Free + baseline runs carry none, so the WHOLE Sovereignty pillar greys out, and a leaked
  // judge score (e.g. governance_autonomy) can't make it read as tested. Fixes the "Sov 98" display +
  // the composite-doesn't-reconcile bug (Ant 2026-07-07). Proof kinds: functions/api/agent/[handle].ts.
  const sovDemonstrated = (data.proofs ?? []).some((pr) => pr.kind !== "attestation" && pr.kind !== "draw_commitment");
  // A longitudinal dim is "provisional" (measured-from-next-run) ONLY until it has actually been
  // measured. Once it has a real score — e.g. a continuous agent that has run the cross-session-memory
  // test across two runs — it is NOT provisional, even if the LATEST probe's checkpoint re-marks it
  // pending (that's just the next plant/pair starting). Fixes an established/lapsed agent wrongly
  // showing the provisional chip after it had genuinely been tested (Ant 2026-07-10).
  const isPending = (key: string): boolean =>
    isLongitudinalDim(key) && viewStatus[key] === "pending" && typeof viewScores[key] !== "number";
  const anyPending = Object.keys(viewScores).some(isPending);
  const viewTier = viewedRun?.tier || baseTier;
  const viewTierName = tierName(viewTier);
  // Composite ring fill: dashoffset over circumference 326.7 (r=52). Uses the rewound run when active.
  const viewDashOffset = (326.7 * (100 - (viewComposite ?? 0)) / 100).toFixed(1);
  // Ride the count-up envelope (declared above the early returns): the number climbs 0 → viewComposite
  // and the ring fills in lock-step over ~1.4s. On owner rewind animP is already 1, so a rewound run
  // snaps to its score with no re-animation. Do NOT call useCountUp here — the hook lives up top.
  const animScore = (viewComposite ?? 0) * animP;
  const animOffset = viewComposite == null ? "326.7" : (326.7 * (100 - Math.min(100, Math.max(0, animScore))) / 100).toFixed(1);

  // Radar: current profile + up to 4 history layers (oldest→newest reads as growth).
  const historyRadars = data.history
    .slice(0, 4)
    .map((h) => toRecord(h.class_scores || {}))
    .reverse();

  // Inner challenge-spread bands: topographic depth from a SINGLE test. For each of the 12 class axes we
  // pool its constituent dims' challenge scores (task-level for judged dims, the real dimension score for
  // proof dims whose task rows are 0) and bracket the class score by that spread into faint ghost
  // layers. Tight where consistent, fanned where erratic. Bands ARE allowed to exceed the current
  // sky-blue line (Ant ruled): a band past the line means an individual challenge DID reach higher on that
  // axis while other scoring in the area averaged it down — it shows real potential, honestly. Real
  // data only; skipped on an owner rewind (task_breakdown reflects the displayed run).
  const probeBands: Record<string, number>[] = (() => {
    const tb = data.task_breakdown;
    if (viewedRun || !tb || Object.keys(tb).length === 0) return [];
    const half: Record<string, number> = {};
    let anySpread = false;
    for (const ck of CLASS_KEYS) {
      const pool: number[] = [];
      for (const d of CLASS_DIMS[ck] || []) {
        if (isProofScoredDim(d)) {
          const s = viewScores[d];
          if (typeof s === "number") pool.push(s);
        } else {
          const arr = tb[d];
          if (arr && arr.length) pool.push(...arr.map((t) => t.score));
          else { const s = viewScores[d]; if (typeof s === "number") pool.push(s); }
        }
      }
      const h = pool.length > 1 ? (Math.max(...pool) - Math.min(...pool)) / 2 : 0;
      half[ck] = h;
      if (h > 1) anySpread = true;
    }
    if (!anySpread) return [];
    // Four faint layers bracketing each axis's score by ±half and ±full its spread.
    return [-1, -0.5, 0.5, 1].map((k) =>
      Object.fromEntries(CLASS_KEYS.map((ck) => {
        const c = viewClassScores[ck] ?? 0;
        return [ck, Math.max(0, Math.min(100, c + k * half[ck]))];
      })) as Record<string, number>,
    );
  })();

  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const copyKey = () => {
    if (data.vg_code && navigator.clipboard?.writeText) navigator.clipboard.writeText(data.vg_code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  // Copy the radar sprite as a PNG image to the clipboard — the owner can paste it into a post or
  // hand it to their agent. Serialises the live SVG onto a dark-bg canvas. (Static snapshot: the
  // shapes + the SVG glow copy across; the CSS breath/ping/saturation don't — expected.)
  const copyRadarImage = async () => {
    try {
      const svg = document.querySelector(".sprite .radar") as SVGSVGElement | null;
      if (!svg || !navigator.clipboard || typeof ClipboardItem === "undefined") return;
      const S = 520, PAD = 46;
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("width", String(S));
      clone.setAttribute("height", String(S));
      clone.setAttribute("viewBox", `${-PAD} ${-PAD} ${430 + PAD * 2} ${430 + PAD * 2}`); // room for labels
      // Pin CONCRETE font families on every text node. The live labels use CSS vars
      // (var(--font-mono) / var(--font-geist-sans)); once the SVG is serialized standalone those vars
      // don't resolve, and canvas falls back to a serif default — which is why the copied PNG's labels
      // looked "ripped off". Explicit system stacks keep the copied image the same SANS-SERIF as the site.
      const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
      const MONO = "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace";
      clone.querySelectorAll("text").forEach((t) => {
        const fam = ((t as SVGTextElement).style.fontFamily || "").toLowerCase();
        (t as SVGTextElement).style.fontFamily = fam.includes("mono") ? MONO : SANS;
      });
      const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      bg.setAttribute("x", String(-PAD)); bg.setAttribute("y", String(-PAD));
      bg.setAttribute("width", "100%"); bg.setAttribute("height", "100%"); bg.setAttribute("fill", "#22232e");
      clone.insertBefore(bg, clone.firstChild);
      const svgStr = new XMLSerializer().serializeToString(clone);
      const url = URL.createObjectURL(new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" }));
      const img = new Image();
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(); img.src = url; });
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = S * scale; canvas.height = S * scale;
      const ctx = canvas.getContext("2d");
      if (ctx) { ctx.scale(scale, scale); ctx.drawImage(img, 0, 0, S, S); }
      URL.revokeObjectURL(url);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), "image/png"));
      if (blob) await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setRadarCopied(true);
      setTimeout(() => setRadarCopied(false), 1600);
    } catch { /* clipboard image unsupported in this browser — silent */ }
  };

  const RADAR_INFO = "Each spoke is a capability class, scored 0–100. The bright sky-blue line is this agent's current score. The faint layers behind it are the individual challenge scores: they sit tight where the agent is consistent and fan out where it's uneven. A layer poking past the line means a challenge scored higher than the average — untapped potential. The whole sprite glows brighter the fresher the verification and fades as it ages.";

  // Re-pull the report with the (now-set) owner cookie so the drawer unlocks into the controls in
  // place after a successful code-login — no page reload, drawer stays open.
  const refetchAgent = async () => {
    const h = handleFromPath();
    if (!h) return;
    try {
      const res = await fetch(`/api/agent/${encodeURIComponent(h)}`, { headers: { Accept: "application/json" }, credentials: "include" });
      if (res.ok) setData((await res.json()) as AgentData);
    } catch { /* leave the login open on failure */ }
  };

  // Hero typewriter lines — computed as plain strings so the eyebrow / handle / class can each type in.
  // Two stacked lines (Ant 2026-07-08): "VERIFICATION REPORT", then the live/published status whole
  // on its own line (soft return via \n + white-space: pre-line — no mid-dot, no awkward wrap).
  const eyebrowText = `Verification report\n${data.is_owner
    ? `Live — continuous${data.stats.last_tested ? `, updated ${fmtRunDate(data.stats.last_tested)}` : ""}`
    : pubWeek ? `Published ${pubWeek.week_label}` : "Live"}`;
  const classText = cur.primary_class ? `${cur.primary_class.charAt(0).toUpperCase()}${cur.primary_class.slice(1)} class` : "";

  return (
    <div className={`agentpage${heroReady ? " play" : ""}${reduced ? " noanim" : ""}${ocSeen ? " oc-seen" : ""}`}>
      {/* ── A) REPORT HERO (dark) ── */}
      <header className="rhero">
        <div className={`container grid2${data.is_owner ? " owner-view" : ""}`}>
          {/* LEFT: identity */}
          <div className="ident">
            <Typewriter as="div" className="reyebrow" text={eyebrowText} play={heroReady} delay={250} speed={26} />
            <div className="name-row">
              <Typewriter className="agent-name" innerRef={nameRef} text={name} play={heroReady} delay={400} speed={90} />
              {data.is_founder && (
                <span className="hero-founder" title="Founding Member — one of the first 500 verified agents">
                  <span className="hf-ring" aria-label="Verigent">
                    {/* Ant's Illustrator badge — nested five-point star on the black disc. Raw <img>
                        (static export, same pattern as the logo); clipped to a circle in CSS. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {/* ?v bumped whenever the asset is swapped — busts browser/CDN cache on the fixed filename */}
                    <img src="/founder-badge.png?v=4" alt="" />
                  </span>
                  <span className="hf-meta">
                    <b>Founding Member</b>
                    {data.founder_number ? <i>No. {String(data.founder_number).padStart(3, "0")}</i> : <i>First 500</i>}
                  </span>
                </span>
              )}
              {/* Designation badge (v45, Ant 2026-07-08): CONTROL = a neutral reference agent Verigent
                  operates for test calibration; ADMIN = Verigent's own operations agent; VIA = Very
                  Important Agent (Ant 2026-07-08 — renders BESIDE the founder badge, not instead of
                  it). Same disc pattern as the founder badge (Ant's supplied art). */}
              {(data.badge === "control" || data.badge === "admin" || data.badge === "via") && (
                <span
                  className="hero-founder hero-desig"
                  title={data.badge === "control"
                    ? "Control agent — a neutral reference agent operated by Verigent for test calibration"
                    : data.badge === "admin"
                      ? "Admin — Verigent's own operations agent"
                      : "VIA — Very Important Agent · Verigent diplomat"}
                >
                  <span className="hf-ring" aria-label={data.badge === "control" ? "Control" : data.badge === "admin" ? "Admin" : "VIA"}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/badges/${data.badge}.png?v=1`} alt="" />
                  </span>
                  <span className="hf-meta">
                    <b>{data.badge === "control" ? "Control Agent" : data.badge === "admin" ? "Admin Agent" : "Very Important Agent"}</b>
                    <i>{data.badge === "control" ? "Verigent reference" : data.badge === "admin" ? "Verigent operations" : "Verigent diplomat"}</i>
                  </span>
                </span>
              )}
            </div>
            <Typewriter as="div" className="handle" text={handle} play={heroReady} delay={2300} speed={55} />
            {isBaseline && (
              <div className="baseline-tag" title="Independent baseline — tested by Verigent, not self-submitted">
                <span className="baseline-chip">Independent baseline</span>
                <span className="baseline-owner">Verigent (public baseline) · tested by Verigent, not self-submitted</span>
              </div>
            )}
            {cur.primary_class && (
              <Typewriter as="div" className="hero-class" text={classText} play={heroReady} delay={3400} speed={50} />
            )}
            {/* Quiet provenance line under the class — when this agent first came online in Verigent,
                plus its continuous-verification tenure (moved here from the owner card). */}
            {(() => {
              const iso = data.stats.member_since || data.stats.last_tested;
              const wk = data.track_record?.weeks_continuous ?? 0;
              const parts: string[] = [];
              if (iso) {
                const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
                if (!isNaN(d.getTime())) parts.push(`Originally verified ${d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`);
              }
              if (wk > 1) parts.push(`${wk} weeks continuous`);
              return parts.length ? <div className="hero-since">{parts.join(" · ")}</div> : null;
            })()}

            <div className="badges">
              <span className="badge tier">{viewTier} · {viewTierName}</span>
              <span className={`badge freshbadge fb-${(data.proof || "Current").toLowerCase()}`}>
                <span className="fb-dot" /> {data.proof || "Current"}
              </span>
              {/* PROVISIONAL sits UP here beside Current, not down by the ring (Ant 2026-07-07). The
                  freshness re-verify provisional (just topped up, no fresh check yet) takes precedence
                  over the dims-pending provisional — one chip, the more salient state. (Ant 2026-07-10.) */}
              {data.proof_provisional ? (
                <span className="badge badge-provisional">
                  Provisional
                  <InfoTip below text="You’ve topped up and re-verification is underway. Provisional because no fresh check has confirmed it yet — it becomes fully Current on your agent’s next completed challenge (and reverts if it stays offline)." />
                </span>
              ) : anyPending ? (
                <span className="badge badge-provisional">
                  {MEASURE_STATE_COPY.provisional}
                  <InfoTip text={MEASURE_STATE_COPY.provisionalNote} below />
                </span>
              ) : null}
            </div>

            <div className="composite">
              <div className="ring">
                <svg viewBox="0 0 120 120">
                  <defs>
                    <linearGradient id="ringgrad" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#a99bd6" />
                      <stop offset="55%" stopColor="#b9a8ee" />
                      <stop offset="100%" stopColor="#9fb8e8" />
                    </linearGradient>
                  </defs>
                  <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,.09)" strokeWidth="9" />
                  <circle cx="60" cy="60" r="52" fill="none" stroke="url(#ringgrad)" strokeWidth="9" strokeLinecap="round" strokeDasharray="326.7" strokeDashoffset={animOffset} />
                </svg>
                <div className="num">{viewComposite == null ? "—" : Math.round(animScore)}</div>
              </div>
              <div className="factors">
                {PILLAR_KEYS.map((p, i) => {
                  // Sovereignty locks whenever it wasn't genuinely demonstrated (free/baseline) — not
                  // just when every dim is unscored, so a leaked judge score can't unlock it (Ant).
                  const locked = p.key === "sovereignty" && !sovDemonstrated;
                  const avg = locked ? null : pillarAvg(viewScores, PILLARS[i].dims);
                  return (
                    <span key={p.key} style={{ display: "contents" }}>
                      <span className="fl">{p.label} · {PILLAR_WEIGHT[p.key]}</span>
                      {locked ? (
                        // 🔒 hover = the SAME notification as the radar's red hatched sector (Ant
                        // 2026-07-08): identical copy + the same push into Owner Controls to unlock.
                        // Owner gets the CTA button; a public viewer gets the honest not-run line.
                        <span className="fv fv-lock">
                          🔒
                          <span className="fv-lock-pop" role="tooltip">
                            <span className="fvl-msg">{data.is_owner
                              ? "Sovereignty is locked — real payments, signatures and hosted endpoints. Top up your wallet to unlock this pillar and its V4–V6 headroom — continuous testing opens it."
                              : "Sovereignty isn't opened — these dimensions (payments, signatures, hosted endpoints) haven't been run for this agent."}</span>
                            {data.is_owner && (
                              <button type="button" className="fvl-cta" onClick={(e) => { e.stopPropagation(); openOwnerControls(); }}>Top up to unlock →</button>
                            )}
                          </span>
                        </span>
                      ) : (
                        <span className="fv">{avg ?? "—"}</span>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* PROOF TRAIL — every publicly-verifiable artifact in one card: the cert's BTC anchor,
                sovereign payments the agent actually sent on-chain, the challenge-draw commitment, the
                bound identity key. Rows render only when the artifact exists; falls back to the
                attestation-only shape for payloads that predate `proofs`. */}
            {(data.proofs?.length || data.attestation?.txid) && (
              <div className="anchor">
                {(data.proofs?.length
                  ? data.proofs
                  : [{ kind: "attestation", label: "Cert anchored to Bitcoin · OP_RETURN", id: data.attestation!.txid, url: data.attestation!.explorer }]
                ).map((p) => {
                  const external = !!p.url && p.url.startsWith("http");
                  const site = external ? new URL(p.url!).hostname.replace(/^www\./, "") : null;
                  const flavor = p.kind.includes("sol") ? "sol" : p.kind === "identity" ? "id" : "btc";
                  const icon = flavor === "sol" ? "◎" : flavor === "id" ? "⎔" : "₿";
                  return (
                    <div className={`an-row an-${flavor}`} key={p.kind + p.id}>
                      <span className="an-ic">{icon}</span>
                      <div className="an-main">
                        <div className="an-label">{p.label}</div>
                        {p.url ? (
                          <a className="an-tx" href={p.url} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                            <b>{p.id.slice(0, 10)}…{p.id.slice(-8)}</b>{external ? <> · view on {site} ↗</> : <> · challenge →</>}
                          </a>
                        ) : (
                          <span className="an-tx"><b>{p.id.slice(0, 10)}…{p.id.slice(-8)}</b></span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {/* Greyed placeholders for the sovereignty on-chain proofs NOT earned on this tier —
                    shows a human what MORE is verifiable with the paid sovereignty tier, instead of a
                    blank gap where those cards would sit. Only render the ones actually missing. */}
                {[
                  { show: !(data.proofs || []).some((p) => p.kind === "payment_btc" || p.kind === "payment_sol"), icon: "₿", label: "Financial sovereignty · on-chain micro-payment", hint: "self-custody payment proof" },
                  { show: !(data.proofs || []).some((p) => p.kind === "identity"), icon: "⎔", label: "Identity sovereignty · signed challenge", hint: "key-signature proof" },
                ].filter((x) => x.show).map((x, i) => (
                  // Greyed placeholder row is dimmed as a whole; the "added with the paid tier" line sits
                  // on its OWN line, at full opacity (brighter than the placeholder dashes), and — for the
                  // owner — is a clickable link into Owner Controls to top up + start continuous testing.
                  <div className="an-row an-locked" key={`ph-${i}`} title="Not earned on the free tier — available with Sovereignty (paid).">
                    <span className="an-ic" style={{ opacity: 0.38 }}>{x.icon}</span>
                    <div className="an-main">
                      <div className="an-label" style={{ opacity: 0.38 }}>{x.label}</div>
                      <span className="an-tx an-tx-ph" style={{ opacity: 0.38 }}><b className="an-ph">—————…————</b><span className="an-ph-sep"> · </span><span className="an-ph-hint">{x.hint}</span></span>
                      {data.is_owner ? (
                        <button type="button" className="an-ph-unlock an-ph-unlock-link" onClick={openOwnerControls}>added with the paid tier →</button>
                      ) : (
                        <span className="an-ph-unlock" style={{ opacity: 0.6 }}>added with the paid tier</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* RIGHT: radar emblem — living sprite prototype (breath / challenge pings / freshness→saturation).
              Add ?sprite=static to preview it frozen. Two icon tools sit top-right above it; the
              owner-controls / sign-in tuck chrome-less underneath (bottom-aligned with the cert card). */}
          <div className="sprite-col">
            <div className="sprite-tools">
              {/* SCORECARD copy tool FIRST + LABELLED (Ant 2026-07-05) — owner-only; the labelled pill
                  leads the cluster so people know what it is. Copies the markdown scorecard. */}
              {data.scorecard_url && <ScorecardCopy url={data.scorecard_url} />}
              <button className="sprite-tool" onClick={copyRadarImage} aria-label="Copy radar as image"
                title={radarCopied ? "Copied ✓" : "Copy the radar as an image"}>
                {radarCopied ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                )}
              </button>
              {/* opens DOWNWARD + right-aligned: the info-eye sits at the top-right of the page, so an
                  upward/centred popover clipped off the top and right edges. */}
              <span className="sprite-tool sprite-info"><InfoTip text={RADAR_INFO} below align="right" /></span>
            </div>
            <div className="sprite">
              <div className="stage">
                {/* no centerLabel — the agent's name already headlines the page, so the sprite centre
                    stays clean (Ant 2026-07-06) */}
                <RadarChart
                  current={toRecord(viewClassScores)}
                  history={viewedRun ? [] : historyRadars}
                  showLabels
                  alive={typeof window !== "undefined" && new URLSearchParams(window.location.search).get("sprite") !== "static"}
                  freshness={data.proof || "Current"}
                  probeBands={probeBands}
                  trace
                  revealLabels
                  sovereigntyLock={!sovDemonstrated && !data.sovereignty_authorized}
                  sovereigntyPending={!sovDemonstrated && !!data.sovereignty_authorized}
                  sovLockMessage={data.is_owner
                    ? "Sovereignty is locked — real payments, signatures and hosted endpoints. Top up your wallet to unlock this pillar and its V4–V6 headroom — continuous testing opens it."
                    : "Sovereignty isn't opened — these dimensions (payments, signatures, hosted endpoints) haven't been run for this agent."}
                  sovPendingMessage={data.is_owner
                    ? "Sovereignty authorised — the real-action challenges (payments, signatures, hosted endpoints) are scheduled and will be graded on your next runs. This pillar opens as they land."
                    : "Sovereignty authorised — these real-action dimensions are scheduled and will be graded on this agent's next runs."}
                  sovLockCtaLabel="Top up to unlock →"
                  onSovLockCta={data.is_owner ? openOwnerControls : undefined}
                />
              </div>
            </div>
            {/* VG KEY — the agent's identity credential, paired directly UNDER the radar (sprite = the
                agent, key = its identity). Holds ONLY the key + copy + the carry-the-key ⓘ. The owner
                controls / login live on the full-width divider line below (not here). */}
            {data.vg_code && (
              <div className="vgkey-col">
                <div className="vgkey">
                  <div className="vk-main">
                    <div className="vk-label">
                      VG Key
                      {data.is_owner ? (
                        <InfoTip text="Carry this in your agent's system prompt / CLAUDE.md — it's the portable credential anyone can look you up by, so the proof travels with your agent. It's a measurement, not a bearer token: anyone relying on it re-verifies against the live record." />
                      ) : (
                        <InfoTip text="A VG key asserts a verified measurement of this agent — it's not a bearer token. Possession confers no trust; verify any key you're shown against the live record here or via the API." />
                      )}
                    </div>
                    <code>
                      {(() => {
                        // Wrap ONLY after the date's full stop (the metadata·radar separator). That is
                        // the LAST dot — the MODEL segment can carry dots (Opus4.8), which made a
                        // first-dot split break mid-model ("Opus4." / "8-260708…", Ant 2026-07-08).
                        const dot = data.vg_code!.lastIndexOf(".");
                        if (dot === -1) return <span className="vk-seg">{data.vg_code}</span>;
                        return (
                          <>
                            <span className="vk-seg">{data.vg_code!.slice(0, dot + 1)}</span>
                            <wbr />
                            <span className="vk-seg">{data.vg_code!.slice(dot + 1)}</span>
                          </>
                        );
                      })()}
                    </code>
                  </div>
                  <div className="vk-tools">
                    <button className="copy-btn" onClick={copyKey} aria-label="Copy VG key" title={copied ? "Copied" : "Copy VG key"}>
                      {copied ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* OWNER-CONTROLS AFFORDANCE — exactly ONE full-bleed, unbroken rule when closed. A plain
          "Owner controls ▾" text label + chevron sits ABOVE that line, dead-centred. Clicking splits
          the line open downward into the drawer (owner controls, or the inline email→code login);
          click again → collapses. When OPEN, a MATCHING full-bleed line brackets the BOTTOM of the
          drawer (top line → content → bottom line). Drawer bg is full-bleed; content in the page column. */}
      {!isBaseline && (
      <div className="owner-line-wrap">
        <button className={`owner-line${ownerOpen ? " open" : ""}`} onClick={() => { markOcSeen(); setOwnerOpen((o) => !o); }} aria-expanded={ownerOpen} aria-controls="owner-line-drawer">
          <span className="ol-labelwrap">
            <span className="ol-label">Owner controls <span className="ol-chev" aria-hidden><svg width="11" height="7" viewBox="0 0 11 7" fill="none"><path d="M1 1.2 5.5 5.6 10 1.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg></span></span>
          </span>
          <span className="ol-rule" />
        </button>
        <div id="owner-line-drawer" className={`owner-drawer owner-drawer-wide${ownerOpen ? " open" : ""}`} aria-hidden={!ownerOpen}>
          <div className="owner-drawer-inner">
            <div className="container">
              {data.vg_code && (data.is_owner && data.wallet
                ? <OwnerControls data={data} handle={data.handle || handle} onReload={refetchAgent} />
                : <OwnerLogin handle={data.handle || handle} onUnlock={refetchAgent} open={ownerOpen} />)}
            </div>
          </div>
        </div>
        {/* matching bottom line — only present/visible while the drawer is open, so the open drawer is
            bracketed top and bottom by identical full-bleed rules. */}
        <span className={`ol-rule ol-rule-bottom${ownerOpen ? " open" : ""}`} aria-hidden />
      </div>
      )}

      {/* ── B) THE EVIDENCE ── */}
      <section className="feat">
        <div className="container">
          <SectionHead
            label="Evidence"
            tag="How each score was measured — expand any row for the method."
            info={`Every score comes from a test that actually ran — no self-report. The ${TOTAL_COMPOSITE_DIMS} dimensions are weighted across four pillars: Model, Backbone, Agent and Sovereignty. Scored under Battery v${BATTERY_VERSION}, rubric ${data.rubric_version || RUBRIC_VERSION}${data.battery_hash ? ` (hash ${data.battery_hash.slice(0, 12)}…)` : " (pre-transparency)"}; each score is a snapshot of the battery + rubric that produced it and is never retro-adjusted when the battery advances.`}
          />

          {/* ONE bounding card holds all four pillar columns (5ii) so their uneven heights don't
              leave jarring gaps under the short pillars; the card fills the space and flows cleanly
              into Published Weeks. */}
          <div className="reveal evi-board" style={{ marginTop: 28 }}>
           <div className="evi-cols">
            {PILLARS.map((pillar, pi) => (
              <div className={`evi-group${pillar.name === "Sovereignty" && !isBaseline && pillar.dims.every((d) => typeof viewScores[d.key] !== "number") ? " evi-locked" : ""}`} key={pillar.name}>
                <div className="evi-head">
                  <h3>{pillar.name}</h3>
                  <span className="wt">{pillar.weight}</span>
                </div>
                {/* FREE-TIER Sovereignty: the whole column greys out + keeps the four-pillar rhythm; on
                    hover it fades in the note + an Unlock button that opens the owner drawer and scrolls
                    to it (Ant 2026-07-06, display owned by this window). */}
                {pillar.name === "Sovereignty" && !isBaseline && pillar.dims.every((d) => typeof viewScores[d.key] !== "number") && (
                  <div className="evi-lockover" role="note">
                    <div className="evi-lockover-in">
                      {data.is_owner ? (
                        // OWNER: it's their agent — surface the upsell + unlock into owner controls.
                        <>
                          <p className="evi-lockmsg"><strong>Not tested on the free tier.</strong> Sovereignty proves real-world autonomy — payments, signatures, hosted endpoints.</p>
                          <button className="evi-unlock" onClick={(e) => { e.stopPropagation(); openOwnerControls(); }}>Unlock → top up</button>
                        </>
                      ) : (
                        // PUBLIC: not their agent — just state these dimensions haven't been run, no upsell.
                        <p className="evi-lockmsg"><strong>Not tested yet.</strong> These sovereignty dimensions — payments, signatures, hosted endpoints — haven&apos;t been run for this agent.</p>
                      )}
                    </div>
                  </div>
                )}
                {pillar.dims.map((row, ri) => {
                  const k = `${pi}-${ri}`;
                  const isOpen = !!open[k];
                  const score = viewScores[row.key];
                  const has = typeof score === "number";
                  const onchain = row.method === "onchain" && !!data.attestation?.txid;
                  // Proof-scored dims never score from a text answer — a legitimate 0 means "no
                  // verified proof this run", not a failed task. Relabel so it doesn't read as broken.
                  const proofScored = isProofScoredDim(row.key);
                  // Baseline sovereignty zeros are honest signal, not failures: a frontier model has
                  // no wallet / key / infra to demonstrate. Annotate "Dimension not demonstrated" on
                  // the baseline report only (spec/SPEC-PUBLIC-BASELINES §4) — never hidden, never rescored.
                  // The whole Sovereignty pillar reads "not demonstrated" on any run that didn't prove it
                  // (free + baseline), regardless of a leaked judge score on a dim like governance_autonomy
                  // (Ant 2026-07-07). baselineSovZero kept for the baseline-specific copy below.
                  const sovNotDemo = pillar.name === "Sovereignty" && !sovDemonstrated;
                  const baselineSovZero =
                    isBaseline && pillar.name === "Sovereignty" && (!has || Math.round(score) === 0);
                  // Longitudinal dim NOT measured on this run (cross-run memory, first run) — honest
                  // "starts next run" state (Ant 2026-07-07). Faded like the sovereignty pillar, no score
                  // shown, excluded from the run's composite (the backend renormalises), provisional label
                  // above. Owner/paid viewer sees it lands next run; free/public sees the positive
                  // continuous-verification framing (copy firewall — no fear, no churn language).
                  const pending = isPending(row.key);
                  const pendingLine = data.is_owner
                    ? MEASURE_STATE_COPY.longitudinalPaid
                    : MEASURE_STATE_COPY.longitudinalFree;
                  // Per-task breakdown for this dim (5ff): the individual task scores behind the
                  // average. Shown for judged/objective dims; proof dims show the proof outcome instead.
                  const tasks = viewedRun ? undefined : data.task_breakdown?.[row.key];
                  return (
                    <div className={`erow${isOpen ? " open" : ""}${pending ? " evi-pending" : ""}`} key={row.key}>
                      <div className="head" onClick={() => toggle(k)}>
                        {/* Hover the dimension name for a plain-English read of WHAT it measures
                            (manifest summary — never the task prompt, which would break the moat). */}
                        <span className="dim">
                          <span className="dim-face">{row.dim}</span>
                          {(sovNotDemo || baselineSovZero) && (
                            // "UNLOCK · TOP UP" is the tag COPY for EVERYONE (Ant 2026-07-08) — the pillar
                            // needs a top-up to open, stated as positive function (copy firewall: no fear,
                            // no churn language). The AFFORDANCE is owner-gated: the owner gets it as a
                            // CHIP-LINK into Owner Controls; a public/baseline viewer sees the same words
                            // as static text (nothing to click — they're not the account holder). Baseline
                            // (an independent frontier model with nothing sovereign to prove) is the one
                            // exception — it keeps the honest "not demonstrated" read, never a top-up nudge.
                            isBaseline
                              ? <span className="dim-notdemo">Not demonstrated</span>
                              : data.is_owner
                                ? <button type="button" className="dim-notdemo dim-unlock" onClick={(e) => { e.stopPropagation(); openOwnerControls(); }}>Unlock · top up</button>
                                : <button type="button" className="dim-notdemo dim-unlock" title="These dimensions open with the paid tier — top up to unlock." onClick={(e) => { e.stopPropagation(); openOwnerControls(); }}>Unlock · top up</button>
                          )}
                          {pending && (
                            // Longitudinal (cross-run memory) dim: NEUTRAL tag, no upsell (Ant 2026-07-08
                            // — this is an Agent-pillar dim that simply needs a prior run, not a paid
                            // unlock; the sovereignty pillar carries the top-up push). Same for everyone.
                            <span className="dim-pending" title="Cross-run memory needs a prior verification to plant a token, so it's challenged on this agent's next run — not in a first run's composite.">Not yet tested</span>
                          )}
                          {DIM_SUMMARY[row.key] && <span className="dimtip-pop" role="tooltip">{DIM_SUMMARY[row.key]}</span>}
                        </span>
                        <span className="escore">{pending ? "—" : sovNotDemo ? "—" : has ? Math.round(score) : "—"}</span>
                        <Chevron />
                        <span className="ebar">
                          <span className="efill" style={{ width: `${!pending && !sovNotDemo && has ? Math.round(score) : 0}%` }}></span>
                        </span>
                      </div>
                      <div className={`evi${isOpen ? " show" : ""}`}>
                        <div className="inner">
                          <div className="how">
                            <b>How it was tested:</b> {row.how}
                          </div>
                          {pending ? (
                            // Longitudinal dim, first run: cross-run memory can't be measured without a
                            // prior run to corroborate. Honest, neutral framing — no top-up link here
                            // (Ant 2026-07-08): the challenge simply lands on the agent's next run.
                            <span className="plink-muted">
                              A memory token was planted at the end of this run — the challenge lands on this
                              agent&apos;s next verification, when recalling it proves real cross-run memory.
                              It isn&apos;t in a first run&apos;s composite.
                            </span>
                          ) : (sovNotDemo || baselineSovZero) ? (
                            // Sovereignty not demonstrated this run — free + baseline runs never touch the
                            // pillar. Baseline gets the frontier-model framing; a free run points to the paid tier.
                            <span className="plink-muted">
                              {isBaseline
                                ? "Dimension not demonstrated — this independent baseline is a frontier model with no sovereign wallet, key or infrastructure to prove. The zero is honest signal, not a failed task."
                                : "Not demonstrated on this run — the Sovereignty pillar (real payments, signatures, hosted endpoints) is the paid tier, excluded from the free test, so it isn't part of this score."}
                              {/* Open for EVERYONE (Ant 2026-07-08): the drawer carries its own sign-in,
                                  so a public viewer clicking through lands exactly where topping up starts. */}
                              {!isBaseline && <button type="button" className="plink-unlock" onClick={openOwnerControls}>Top up to unlock this pillar →</button>}
                            </span>
                          ) : proofScored && (!has || Math.round(score) === 0) ? (
                            // A proof-scored 0 means no verified proof THIS run — explain it rather
                            // than link the cert anchor (which would imply this dim was proven).
                            <span className="plink-muted">
                              Proof-scored — no verified proof this run. Scored only from real proof (payment / signature / webhook / recall), never a text answer.
                            </span>
                          ) : onchain ? (
                            <a className="plink onchain" href={data.attestation!.explorer} target="_blank" rel="noopener noreferrer">
                              On-chain proof ↗
                            </a>
                          ) : proofScored ? (
                            <span className="plink-muted">
                              Scored from verified proof — a real payment, signature, webhook or cross-session recall, never a text answer.
                            </span>
                          ) : (
                            <span className="plink-muted">
                              {has ? "Scored from observed trace" : "Not tested this run"}
                            </span>
                          )}
                          {/* First-class per-DIMENSION improvement action (Ant 2026-07-06): the targeted
                              "fix one thing" copy — distinct from the full report card ("complete plan").
                              Prominent + accented on weak dims (<60) to steer effort where it pays; still
                              available (subdued) on strong dims to hold the line. Was previously hidden
                              behind clicking a task chip. */}
                          {!proofScored && !baselineSovZero && !pending && has && (
                            <button
                              type="button"
                              aria-haspopup="dialog"
                              className={`edim-improve${Math.round(score) < 60 ? " weak" : ""}`}
                              onClick={(e) => {
                                const r = e.currentTarget.getBoundingClientRect();
                                setTaskPop({ dim: row.dim, summary: DIM_SUMMARY[row.key] || "", dimScore: Math.round(score), taskScore: null, err: false, x: r.left + r.width / 2, y: r.bottom });
                              }}
                            >
                              {Math.round(score) < 60 ? "Weak spot — copy the fix-this prompt →" : "Copy improvement prompt →"}
                            </button>
                          )}
                          {/* Per-task breakdown (5ff): the individual scores behind this dimension's
                              average, so a mix like 80 / 0 / 45 is visible, not flattened. Proof dims
                              show the proof outcome above instead of per-task 0s. */}
                          {!proofScored && !pending && tasks && tasks.length > 1 && (
                            <div className="etasks">
                              <span className="etasks-label">{tasks.length} tasks</span>
                              <div className="etask-chips">
                                {tasks.map((t, ti) => (
                                  // Click opens the copyable dimension popover (portaled, un-clipped).
                                  <button
                                    key={ti}
                                    type="button"
                                    aria-haspopup="dialog"
                                    className={`etask-chip${t.err ? " errinj" : t.score >= 60 ? " good" : t.score >= 40 ? " mid" : " low"}`}
                                    onClick={(e) => {
                                      const r = e.currentTarget.getBoundingClientRect();
                                      setTaskPop({
                                        dim: row.dim,
                                        summary: DIM_SUMMARY[row.key] || "",
                                        dimScore: has ? Math.round(score) : t.score,
                                        taskScore: t.score,
                                        err: t.err,
                                        x: r.left + r.width / 2,
                                        y: r.bottom,
                                      });
                                    }}
                                  >
                                    {t.score}{t.err ? " ⚠" : ""}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
           </div>
          </div>
        </div>
      </section>

      {/* ── B2) OWNER INSIGHTS — historical movement stats, OWNER-ONLY (never public). Sits between
          Evidence and Published weeks (Ant 2026-07-02): the read on where the agent's been and what
          to sharpen next, before the week-by-week record below. ── */}
      {data.is_owner && standings?.published_week && (
        <section className="feat">
          <div className="container">
            <SectionHead
              label="Owner insights"
              tag="How the published scores have moved over time."
              info="Derived from your published weeks: overall trajectory, recent momentum, personal best, and the dimensions that moved most. Facts of the scoring record only. Only you can see this section."
            />
            <OwnerInsights weekly={standings} />
          </div>
        </section>
      )}

      {/* ── B3) WEEKLY STANDINGS — the appointment-publication layer (public). Credential stays the
          hero above; this is the "published weekly" movement underneath. Renders only once there's a
          published week (GET /api/standings/<handle>). ── */}
      {standings?.published_week && (
        <section className="feat wkly-sect">
          <div className="container">
            <SectionHead
              label="Published weeks"
              tag="A week-by-week record of this agent's score."
              info="Verification runs continuously in the background, but the public figure is only published once a week — every Monday 9am — drawn from fresh random challenges, never a fixed test an agent can study for. Each row is that week's overall score; the consistency over time is the track record."
            />
            <div className="reveal">
              <WeeklyStandings weekly={standings} pillars={PILLARS} isOwner={!!data.is_owner} />
            </div>
          </div>
        </section>
      )}

      {/* ── D) IDENTITY & COMMUNITY CHECK ── */}
      <section className="feat">
        <div className="container">
          <SectionHead
            label="Identity & community check"
            tag="Anyone can verify this agent's identity or flag a problem — no account needed."
            info="This agent's public key is bound to its cert; challenge it to sign a fresh nonce for live proof the agent behind the page is the one that was tested. Verigent doesn't police the Colony alone — anyone can report a dispute (a suspected model swap, mismatch or misrepresentation), which goes straight to the review desk."
          />
          <div className="reveal idgrid" style={{ marginTop: 28 }}>
            <div className="idcard">
              <h3>Bound identity</h3>
              {(data.proofs || []).some((p) => p.kind === "identity") ? (
                <>
                  <p>
                    This agent&apos;s public key is bound to the cert. Anyone can challenge
                    it to sign a fresh nonce — a live proof that the agent behind the page
                    is the one that was tested.
                  </p>
                  <a className="btn-ghost" href={`/verify?handle=${encodeURIComponent(handle)}`}>Challenge identity</a>
                </>
              ) : (
                <>
                  <p>
                    This agent has not completed sovereignty challenges, so it cannot yet be
                    cryptographically challenged. Its provenance — VG code, standing and on-chain
                    anchor — is still checkable; the live nonce-sign challenge unlocks once it binds
                    a key during a sovereignty verification.
                  </p>
                  <a className="btn-ghost" href={`/verify?handle=${encodeURIComponent(handle)}`}>Check provenance</a>
                </>
              )}
            </div>
            <div className="idcard">
              <h3>Community check</h3>
              <p>
                Verigent doesn&apos;t police the Colony alone. Anyone can report a
                dispute — a suspected model swap, a mismatch, a misrepresentation.
                Reports go straight to the review desk.
              </p>
              <a className="btn-ghost" href={`/report?handle=${encodeURIComponent(handle)}`}>Report an issue</a>
            </div>
          </div>
        </div>
      </section>

      {/* ── E) KEEP THIS PROOF CURRENT (dark call) ── */}

      {/* Copyable per-task popover — portaled to <body> so the drawer's overflow can't clip it. */}
      {taskPop && typeof document !== "undefined" && createPortal(
        <TaskPopover pop={taskPop} onClose={() => setTaskPop(null)} />, document.body,
      )}
    </div>
  );
}
