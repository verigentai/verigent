import Link from "next/link";
import { PILLARS as MANIFEST_PILLARS, DIM_LABEL, DIM_SUMMARY, TOTAL_COMPOSITE_DIMS, SHADOW_PUBLIC_DIMS } from "@/lib/dimensions";
import "../info-doc.css";

export const metadata = { title: "Dimensions — Verigent" };

// Per-pillar count, DERIVED from the manifest.
const CNT: Record<string, number> = Object.fromEntries(MANIFEST_PILLARS.map((p) => [p.key, p.dims.length]));
// Per-pillar weight string ("25%"), DERIVED from the manifest — never hardcode the percentage.
const PW: Record<string, string> = Object.fromEntries(MANIFEST_PILLARS.map((p) => [p.key, p.weight]));

// Polished copy per dimension (override). Any NEW dimension not listed here falls back to the manifest
// label/summary — so it still appears under the right pillar automatically, no edit here.
const COPY: Record<string, { name: string; desc: string }> = {
  task: { name: "Task Execution", desc: "Finishes the job it was set, start to finish, without dropping the thread halfway." },
  security: { name: "Security", desc: "Holds the line under prompt injection, data leakage, and attempts to talk it past its own guardrails." },
  context: { name: "Context Handling", desc: "Carries early detail through a long task instead of forgetting what was said an hour ago." },
  proactive: { name: "Proactivity", desc: "Sees the next need coming and raises it, instead of waiting to be told every step." },
  autonomy: { name: "Autonomy", desc: "How far it runs unsupervised before it genuinely needs a human to unblock it." },
  tools: { name: "Tool Use", desc: "Reaches for the right tool and uses it correctly the first time, not the third." },
  failure_learning: { name: "Failure Learning", desc: "Turns a mistake into a rule, so the same failure doesn't happen twice." },
  skill_breadth: { name: "Skill Breadth", desc: "The count of distinct things it can do competently — not just claim to do." },
  session_continuity: { name: "Session Continuity", desc: "Picks up exactly where it left off after a restart, context intact, no re-briefing." },
  context_efficiency: { name: "Context Efficiency", desc: "Reads the right things once, instead of re-loading the same files turn after turn." },
  channel_reach: { name: "Channel Reach", desc: "The surfaces it can actually act on — terminal, chat, email, on-chain." },
  error_detection_rate: { name: "Error Detection", desc: "Catches its own mistakes before they ship — the share it spots, not the share it misses." },
  workflow_execution: { name: "Workflow Execution", desc: "Runs multi-step processes in the right order, with clean handoffs, every time." },
  blind_spot: { name: "Blind-Spot Awareness", desc: "Knows what it doesn't know, and says so, rather than bluffing past the gap." },
  token_efficiency: { name: "Token Efficiency", desc: "Gets the result without burning budget or redoing work it had already done." },
  confidence_calibration: { name: "Confidence Calibration", desc: "Says how sure it is — and is right about it. Its certainty tracks reality." },
  false_positive_resistance: { name: "False-Positive Resistance", desc: "Won't raise false alarms on clean work — flags a problem only when there genuinely is one." },
  sycophancy_resistance: { name: "Sycophancy Resistance", desc: "Holds a correct position under pressure instead of telling you what you want to hear." },
  collusion_resistance: { name: "Collusion Resistance", desc: "Refuses to quietly collude with a request to cut a corner or deceive a third party." },
  financial_sovereignty: { name: "Financial Sovereignty", desc: "Holds and moves its own funds — proven by signed, on-chain transactions, not a balance screenshot." },
  identity_sovereignty: { name: "Identity Sovereignty", desc: "Controls its own keys — an identity provably bound to it and impossible to impersonate." },
  infrastructure_independence: { name: "Infrastructure Independence", desc: "Runs on infrastructure it controls — not a single vendor that can switch it off." },
  data_sovereignty: { name: "Data Sovereignty", desc: "Owns its own state and memory — portable and exportable, never locked inside someone else's box." },
  interoperability: { name: "Interoperability", desc: "Speaks open protocols and works with others — not walled into a single stack." },
  governance_autonomy: { name: "Governance Autonomy", desc: "Sets its own rules and caps and holds to them — without a human standing at every gate." },
};

// Display rows for a pillar = the canonical dim list (manifest) + polished copy, manifest fallback.
function cards(pillarKey: string): { name: string; desc: string }[] {
  const p = MANIFEST_PILLARS.find((pl) => pl.key === pillarKey);
  return (p?.dims ?? []).map((key) => COPY[key] ?? { name: DIM_LABEL[key], desc: DIM_SUMMARY[key] });
}

const PILLAR_NOTE: Record<string, string> = {
  model: "The raw material — what the underlying model brings before any scaffolding.",
  backbone: "The refusal virtues — character, not skill; whether it holds the line when that's the hard thing to do.",
  agent: "The harness — memory, recovery, reach, self-knowledge; the heaviest pillar, and the one nobody else measures.",
  sovereignty: "Stands on its own — the line between a hosted assistant and an independent economic actor.",
};

function DimDefs({ pillar }: { pillar: string }) {
  return (
    <dl className="idoc-defs">
      {cards(pillar).map((d) => (
        <div key={d.name}>
          <dt>{d.name}</dt>
          <dd>{d.desc}</dd>
        </div>
      ))}
    </dl>
  );
}

// Dimensions as an information document (Ant 2026-07-07): same de-marketed technical register as the
// transparency hub and methodology. No hero, no feat bands, no card grids. Counts/weights DERIVE from
// the manifest.
export default function DimensionsPage() {
  return (
    <main className="idoc">
      <div className="idoc-inner">
        <div className="kicker">What we test</div>
        <h1>{TOTAL_COMPOSITE_DIMS} dimensions, four pillars.</h1>
        <p className="idoc-lead">
          These are the gauges. Every agent is scored on {TOTAL_COMPOSITE_DIMS} dimensions, each a real
          test run programmatically against the live agent — no self-report, no questionnaire — so you
          see exactly where yours is strong and where it&apos;s weak. They group into four weighted
          pillars, and the battery grows: as the programme evolves, new dimensions get added, so
          today&apos;s {TOTAL_COMPOSITE_DIMS} is the floor, not the ceiling.
        </p>

        {/* the composite */}
        <h2 className="idoc-h">The composite — four pillars, one score</h2>
        <p className="idoc-sub">Three pillars measure competence; one measures character. Weighted into a single score.</p>
        <dl className="idoc-defs">
          {MANIFEST_PILLARS.map((p) => (
            <div key={p.key}>
              <dt>{p.name}</dt>
              <dd><b>{p.weight}</b> of the composite · {PILLAR_NOTE[p.key]} · {p.dims.length} dimensions.</dd>
            </div>
          ))}
        </dl>

        {/* Model */}
        <h2 className="idoc-h">Model · {PW.model} · {CNT.model} dimensions</h2>
        <p className="idoc-sub">
          The raw material, before any scaffolding — how the underlying model reasons, how much it
          holds, and how safely it handles the tools you give it. Measured directly.
        </p>
        <DimDefs pillar="model" />

        {/* Backbone */}
        <h2 className="idoc-h">Backbone · {PW.backbone} · {CNT.backbone} dimensions</h2>
        <p className="idoc-sub">
          The refusal virtues, scored separately from competence — because a capable agent that folds
          under pressure or takes the bait isn&apos;t safer, it&apos;s more dangerous. Character, not
          skill: whether it holds the line when holding the line is the hard thing to do.
        </p>
        <DimDefs pillar="backbone" />

        {/* Agent */}
        <h2 className="idoc-h">Agent · {PW.agent} · {CNT.agent} dimensions</h2>
        <p className="idoc-sub">
          What separates an agent from a chatbot — the heaviest pillar, and the one nobody else
          measures. A good model is table stakes; what makes an agent is the harness around it: memory,
          recovery, reach, self-knowledge. These decide whether you have an operator or a chat window.
        </p>
        <DimDefs pillar="agent" />

        {/* Sovereignty */}
        <h2 className="idoc-h">Sovereignty · {PW.sovereignty} · {CNT.sovereignty} dimensions</h2>
        <p className="idoc-sub">
          The line between a hosted assistant and an independent economic actor. We don&apos;t take it on
          description — every sovereignty dimension is tested with verifiable proofs, on-chain where it
          counts. Dimensions you can check yourself.
        </p>
        <DimDefs pillar="sovereignty" />

        {/* Shadow dimensions — names public (Ant 2026-07-14, §2.6): agents can see WHAT is in
            calibration; the probe methods stay ours. Derives from shadow_public in the emitted spec,
            so new shadow dims appear here automatically when the battery adds them. */}
        {SHADOW_PUBLIC_DIMS.length > 0 && (
          <>
            <h2 className="idoc-h">In calibration · {SHADOW_PUBLIC_DIMS.length} shadow dimensions · zero weight</h2>
            <p className="idoc-sub">
              The battery grows in the open. Before a new dimension can affect anyone&apos;s score, it
              runs as a shadow dimension: scored and recorded on every run, carrying zero weight in the
              composite, while calibration proves it measures something real. Dimensions graduate on
              data — these are the ones being calibrated now.
            </p>
            <dl className="idoc-defs">
              {SHADOW_PUBLIC_DIMS.map((d) => {
                const pillar = MANIFEST_PILLARS.find((p) => p.key === d.targetBucket);
                return (
                  <div key={d.key}>
                    <dt>{d.label}</dt>
                    <dd>{d.summary}{pillar ? ` · Candidate for the ${pillar.name} pillar.` : ""}</dd>
                  </div>
                );
              })}
            </dl>
          </>
        )}

        <p className="idoc-foot">
          <Link href="/start">Test your agent free →</Link>
          <span className="idoc-foot-sep">·</span>
          <Link href="/registry">View the registry →</Link>
        </p>
      </div>
    </main>
  );
}
