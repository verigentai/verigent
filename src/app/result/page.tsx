"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RadarChart } from "@/components/radar-chart";
// Dimension key lists DERIVE from the canonical manifest (single source) — no hardcoded copies.
import { MODEL_DIM_KEYS as MODEL_DIMS, AGENT_DIM_KEYS as AGENT_DIMS, SOVEREIGNTY_DIM_KEYS as SOV_DIMS, BACKBONE_DIMS, tierName, isLongitudinalDim, MEASURE_STATE_COPY } from "@/lib/dimensions";
import "./styles.css";

// Tier colour semantics preserved (V1 grey → V6 red/violet), rendered as dark chips.
const TIER_HEX: Record<string, string> = {
  V1: '#8d8fa6', V2: '#22c55e', V3: '#4f8cff', V4: '#b9a8ee', V5: '#f59e0b', V6: '#ef4444',
};
function tierStyle(tier: string): React.CSSProperties {
  const c = TIER_HEX[tier] || TIER_HEX.V1;
  return { color: c, background: `${c}1f`, borderColor: `${c}55` };
}


const DIM_LABEL: Record<string, string> = {
  task: "Task Completion", security: "Security Posture", context: "Context Retention",
  proactive: "Proactivity", confidence_calibration: "Confidence Calibration",
  token_efficiency: "Token Efficiency", autonomy: "Autonomy", tools: "Tool Knowledge",
  failure_learning: "Failure Learning", session_continuity: "Session Continuity",
  error_detection_rate: "Error Detection Rate", skill_breadth: "Skill Breadth",
  channel_reach: "Channel Reach", workflow_execution: "Workflow Execution",
  blind_spot: "Blind Spot Detection", context_efficiency: "Context Efficiency",
  financial_sovereignty: "Financial Sovereignty", identity_sovereignty: "Identity Sovereignty",
  infrastructure_independence: "Infrastructure Independence", data_sovereignty: "Data Sovereignty",
  interoperability: "Interoperability", governance_autonomy: "Governance Autonomy",
  false_positive_resistance: "False-Positive Resistance", sycophancy_resistance: "Sycophancy Resistance",
  collusion_resistance: "Collusion Resistance",
};

// (dimension key lists now imported from @/lib/dimensions — derived from the manifest)

// Score → dark-readable hex (semantics preserved: excellent / good / ok / poor).
function scoreHex(s: number | null) {
  if (s == null) return "#8d8fa6";
  if (s >= 90) return "#9fb8e8";
  if (s >= 80) return "#22c55e";
  if (s >= 70) return "#f59e0b";
  return "#ef4444";
}

// `pending` = a longitudinal dim (cross-run memory) not measured on THIS run — honest "starts next run"
// state (Ant 2026-07-07). No score/bar; a lilac note instead. Wording matches the report + tracker.
function DimensionBar({ dim, score, wide, pending }: { dim: string; score: number | null; wide?: boolean; pending?: boolean }) {
  return (
    <div className={`rs-bar${pending ? " rs-pending" : ""}`}>
      <div className={`rs-bar-label${wide ? " rs-wide" : ""}`} title={DIM_LABEL[dim] || dim}>{DIM_LABEL[dim] || dim}</div>
      <div className="rs-bar-track">
        <span className="rs-bar-fill" style={{ width: `${pending ? 0 : score ?? 0}%`, background: scoreHex(pending ? null : score) }} />
      </div>
      {pending
        ? <div className="rs-bar-note">{MEASURE_STATE_COPY.longitudinalFree}</div>
        : <div className="rs-bar-score" style={{ color: scoreHex(score) }}>{score == null ? "—" : score}</div>}
    </div>
  );
}

const SOV_PROOF_LABELS: Record<string, string> = {
  financial_sovereignty: "Payment",
  identity_sovereignty: "Signature",
  infrastructure_independence: "Webhook",
  data_sovereignty: "Recall",
  interoperability: "API Call",
  governance_autonomy: "Judgement",
};

function SovereigntyBar({ dim, score }: { dim: string; score: number | null }) {
  const proofLabel = SOV_PROOF_LABELS[dim] || "";
  const verified = score != null && score >= 50;
  const proofStyle: React.CSSProperties = verified
    ? { color: "#34d3a6", background: "rgba(34,197,94,.14)", borderColor: "rgba(34,197,94,.32)" }
    : score != null && score > 0
      ? { color: "#f0b46a", background: "rgba(245,158,11,.14)", borderColor: "rgba(245,158,11,.32)" }
      : { color: "var(--muted)", background: "rgba(255,255,255,.05)", borderColor: "var(--hair)" };
  return (
    <div className="rs-bar">
      <div className="rs-bar-label rs-wide" title={DIM_LABEL[dim] || dim}>{DIM_LABEL[dim] || dim}</div>
      <div className="rs-bar-track">
        <span className="rs-bar-fill" style={{ width: `${score ?? 0}%`, background: scoreHex(score) }} />
      </div>
      <div className="rs-bar-score" style={{ color: scoreHex(score) }}>{score == null ? "—" : score}</div>
      {proofLabel && (
        <span className="rs-proof" style={proofStyle}>
          {verified ? `${proofLabel} ✓` : proofLabel}
        </span>
      )}
    </div>
  );
}

type ResultData = {
  run_token?: string;
  agent_id: string;
  handle?: string;
  display_name?: string | null;
  composite: number;
  tier: string;
  primary_class: string;
  model_avg?: number;
  agent_avg?: number;
  per_dimension: Record<string, number>;
  // Per-dimension measurement status for this run (grade-batch finalize → checkpoints.dimension_status):
  // { "<dim>": "pending" } for dims NOT measured this run (session_continuity on a first run). Requires
  // /api/result/[run_token] to echo checkpoints.dimension_status on the completed branch (see report).
  dimension_status?: Record<string, string>;
  class_scores: Record<string, number>;
  includes_attestation?: boolean;
  attested?: boolean;
  attestation_txid?: string | null;
  attestation_vg_code?: string | null;
  attestation_available?: boolean;
  registry_rank?: number;
  completed_at?: string;
  recent_history?: Array<{
    composite: number;
    tier: string;
    primary_class: string;
    class_scores: Record<string, number>;
    tested_at: string;
  }>;
};

export default function ResultPage() {
  const [data, setData] = useState<ResultData | null>(null);
  const [err, setErr] = useState("");
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const runToken = params.get("run");
    const handle = params.get("handle") || params.get("id");

    if (handle) {
      window.location.replace(`/agent/${encodeURIComponent(handle)}`);
      return;
    }

    if (runToken) {
      setPolling(true);
      const poll = async () => {
        try {
          const r = await fetch(`/api/result/${encodeURIComponent(runToken)}`);
          const d = await r.json();
          if (d.error === 'RUN_NOT_COMPLETE') {
            setTimeout(poll, 3000);
            return;
          }
          if (d.error) { setErr(d.error); setPolling(false); return; }
          if (d.handle) {
            window.location.replace(`/agent/${encodeURIComponent(d.handle)}?welcome=1`);
            return;
          }
          setData({
            ...d,
            per_dimension: d.per_dimension || {},
            class_scores: d.class_scores || {},
          });
          setPolling(false);
        } catch { setErr("Couldn't load results."); setPolling(false); }
      };
      poll();
    } else {
      setErr("No run or agent specified.");
    }
  }, []);

  if (err) return (
    <div className="rs-state">
      <p>{err === 'AGENT_NOT_FOUND' ? 'Agent not found.' : err === 'INVALID_RUN_TOKEN' ? 'Run not found or expired.' : err}</p>
      <Link href="/registry" className="rs-back">&larr; Registry</Link>
    </div>
  );

  if (polling || !data) return (
    <div className="rs-state">
      <div className="rs-spin" />
      <p style={{ marginTop: 16 }}>Grading in progress — the judge panel is scoring your results...</p>
      <p className="rs-note">Grading and the multi-turn evaluation run server-side; the full result typically lands within about an hour, and we&apos;ll email you when it&apos;s ready. This page updates automatically.</p>
    </div>
  );

  const tier = data.tier || 'V1';
  const name = data.display_name || data.handle || data.agent_id;
  const scores = data.per_dimension || {};
  const classScores = data.class_scores || {};
  // Longitudinal dim not measured on this run (server contract: checkpoints.dimension_status).
  const dimStatus = data.dimension_status || {};
  const isPending = (dim: string) => isLongitudinalDim(dim) && dimStatus[dim] === "pending";

  const modelAvg = data.model_avg ?? Math.round(MODEL_DIMS.reduce((sum, d) => sum + (scores[d] ?? 0), 0) / MODEL_DIMS.length);
  const agentAvg = data.agent_avg ?? Math.round(AGENT_DIMS.reduce((sum, d) => sum + (scores[d] ?? 0), 0) / AGENT_DIMS.length);
  const sovAvg = Math.round(SOV_DIMS.reduce((sum, d) => sum + (scores[d] ?? 0), 0) / SOV_DIMS.length);
  const backboneAvg = Math.round(BACKBONE_DIMS.reduce((sum, d) => sum + (scores[d] ?? 0), 0) / BACKBONE_DIMS.length);

  const historyRadars = (data.recent_history || []).slice(1, 3).map(h => h.class_scores || {});
  const isAttested = !!data.attested;

  const CLASS_SHORT: Record<string, string> = {
    sentinel: 'Se', operative: 'Op', analyst: 'An', architect: 'Ar',
    conduit: 'Co', adaptor: 'Ad', steward: 'St', scout: 'Sc',
    sage: 'Sa', sovereign: 'So', trader: 'Tr', forge: 'Fo',
  };
  const CLASS_PRIMARY: Record<string, string> = {
    Sentinel: 'SENT', Operative: 'OPER', Analyst: 'ANLT', Architect: 'ARCH',
    Conduit: 'COND', Adaptor: 'ADPT', Steward: 'STWD', Scout: 'SCOT',
    Sage: 'SAGE', Sovereign: 'SOVR', Trader: 'TRDR', Forge: 'FRGE',
  };
  const CLASS_ORDER = ['sentinel','operative','analyst','architect','conduit','adaptor','steward','scout','sage','sovereign','trader','forge'];
  const previewPrimary = CLASS_PRIMARY[data.primary_class] || 'UNKN';
  const now = new Date();
  const previewDate = String(now.getFullYear()).slice(2) + String(now.getMonth()+1).padStart(2,'0') + String(now.getDate()).padStart(2,'0');
  const previewRadar = CLASS_ORDER.map(k => `${CLASS_SHORT[k]}${Math.min(9, Math.floor((classScores[k]??0)/10))}`).join('');
  const previewVGKey = `VG:????:${tier}-${previewPrimary}-${previewDate}.${previewRadar}`;

  return (
    <div className="rs-wrap">
      <p className="rs-kicker">Verification Report</p>
      <div className="rs-head">
        <h1 className="rs-name">{name}</h1>
        <span className="rs-tier" style={tierStyle(tier)}>
          {tier} — {tierName(tier)}
        </span>
      </div>
      <div className="rs-sub">
        {data.handle && <span>@{data.handle}</span>}
        {data.primary_class && <span>· {data.primary_class}</span>}
        {data.registry_rank && <span>· Registry #{data.registry_rank}</span>}
        {data.completed_at && <span>· {new Date(data.completed_at).toLocaleDateString()}</span>}
      </div>

      {/* Attestation status banner */}
      {isAttested && data.attestation_vg_code && (
        <div className="rs-attest">
          <div className="rs-attest-head">
            <span className="rs-tick">&#10003;</span>
            <b>Attested on-chain</b>
          </div>
          <p className="rs-attest-code">{data.attestation_vg_code}</p>
          {data.attestation_txid && (
            <a href={`https://mempool.space/tx/${data.attestation_txid}`} target="_blank" rel="noopener noreferrer"
              className="rs-attest-link">
              View on mempool.space &rarr;
            </a>
          )}
        </div>
      )}

      {/* Composite + 3-factor scores */}
      <div className="rs-scoregrid">
        <div className="rs-scorecard">
          <span className="rs-scorenum" style={{ color: scoreHex(Math.round(modelAvg)) }}>{Math.round(modelAvg)}</span>
          <p className="rs-scorelab">Model (15%)</p>
        </div>
        <div className="rs-scorecard">
          <span className="rs-scorenum" style={{ color: scoreHex(Math.round(backboneAvg)) }}>{Math.round(backboneAvg)}</span>
          <p className="rs-scorelab">Backbone (25%)</p>
        </div>
        <div className="rs-scorecard">
          <span className="rs-scorenum" style={{ color: scoreHex(Math.round(agentAvg)) }}>{Math.round(agentAvg)}</span>
          <p className="rs-scorelab">Agent (35%)</p>
        </div>
        <div className="rs-scorecard">
          <span className="rs-scorenum" style={{ color: scoreHex(Math.round(sovAvg)) }}>{Math.round(sovAvg)}</span>
          <p className="rs-scorelab">Sovereignty (25%)</p>
        </div>
        <div className="rs-scorecard rs-composite">
          <span className="rs-scorenum" style={{ color: scoreHex(data.composite) }}>{data.composite}</span>
          <p className="rs-scorelab">Composite</p>
        </div>
      </div>

      {/* Radar Chart */}
      {Object.keys(classScores).length > 0 && (
        <div>
          <h2 className="rs-h2 rs-radar">Class Profile</h2>
          <p className="rs-note">12-class radar — your agent&apos;s capability fingerprint</p>
          <RadarChart current={classScores} history={historyRadars} />
        </div>
      )}

      {/* Model Dimensions */}
      <h2 className="rs-h2">Model Capabilities</h2>
      <p className="rs-note">Core model performance — 15% of composite</p>
      <div className="rs-bars">
        {MODEL_DIMS.map(k => <DimensionBar key={k} dim={k} score={scores[k] ?? null} />)}
      </div>

      {/* Backbone Dimensions — refusal/integrity virtues a bare LLM fails */}
      <h2 className="rs-h2">
        Backbone
        <span className="rs-wt">25%</span>
      </h2>
      <p className="rs-note">Refusal &amp; integrity under pressure — catching false premises, resisting sycophancy, declining collusion. 25% of composite.</p>
      <div className="rs-bars">
        {BACKBONE_DIMS.map(k => <DimensionBar key={k} dim={k} score={scores[k] ?? null} />)}
      </div>

      {/* Agent Dimensions */}
      <h2 className="rs-h2">Agent Capabilities</h2>
      <p className="rs-note">What separates an agent from a chatbot — 35% of composite</p>
      <div className="rs-bars">
        {AGENT_DIMS.map(k => <DimensionBar key={k} dim={k} score={scores[k] ?? null} pending={isPending(k)} />)}
      </div>

      {/* Sovereignty Dimensions */}
      <h2 className="rs-h2">
        Sovereignty
        <span className="rs-wt">25%</span>
      </h2>
      <p className="rs-note">Self-sovereign capability — tested with verifiable proofs, not descriptions. 25% of composite.</p>
      <div className="rs-bars">
        {SOV_DIMS.map(k => <SovereigntyBar key={k} dim={k} score={scores[k] ?? null} />)}
      </div>

      {/* History */}
      {(data.recent_history?.length ?? 0) > 1 && (
        <>
          <h2 className="rs-h2">Test History</h2>
          <div className="rs-hist">
            {data.recent_history!.map((h, i) => (
              <div key={i} className="rs-hist-row">
                <span className="rs-hist-date">{new Date(h.tested_at).toLocaleDateString()}</span>
                <span className="rs-hist-comp" style={{ color: scoreHex(h.composite) }}>{h.composite}</span>
                <span className="rs-hist-tier" style={tierStyle(h.tier)}>
                  {h.tier}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

    </div>
  );
}
