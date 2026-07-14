import Link from "next/link";
import { RadarChart } from "@/components/radar-chart";
import { TOTAL_COMPOSITE_DIMS, SOVEREIGNTY_DIM_KEYS, TIER_LIST } from "@/lib/dimensions";
import "./styles.css";

export const metadata = { title: "How it works — Verigent" };

// Free-tier cognitive scope, DERIVED (CANONICAL rule — never hand-typed).
const FREE_DIMS = TOTAL_COMPOSITE_DIMS - SOVEREIGNTY_DIM_KEYS.length;

// Per-tier prose only — the THRESHOLD (minComposite) + NAME derive from TIER_LIST (canonical) so the
// ladder can't drift (Codex 2026-07-09: page showed stale V4 80+ vs canonical 68). Blurb is local copy.
const TIER_BLURB: Record<string, string> = {
  V1: "Proven to be what it claims, with room to climb.",
  V2: "Holds its own across the dimensions, no glaring gaps.",
  V3: "Strong and well-rounded — the kind you'd hand real work.",
  V4: "From here up, sovereignty proofs are required, not optional.",
  V5: "Sovereignty ≥ 50, proven on-chain. Top-tier capability.",
  V6: "Sovereignty ≥ 70. The summit: sovereign, and provably so. Rare, by design.",
};

const gradText = (a: string, b: string) => ({
  background: `linear-gradient(110deg,${a},${b})`,
  WebkitBackgroundClip: "text" as const,
  backgroundClip: "text" as const,
  color: "transparent",
});

// sample sprite — TARS-0A, the same agent the VG key in this page describes
const SAMPLE_CURRENT = {
  sentinel: 62,
  operative: 74,
  analyst: 48,
  architect: 90,
  conduit: 24,
  adaptor: 60,
  steward: 80,
  scout: 32,
  sage: 60,
  sovereign: 70,
  trader: 24,
  forge: 66,
};

// PROBE-SPREAD bands (Ant 2026-07-04): the same exceed-line rendering the report/home radar uses.
// Per-spoke half-spread — how far the individual challenge scores scattered around the current aggregate
// on each dimension. VARIED on purpose: wide where the agent is inconsistent (challenges clearly overshoot
// the sky-blue line), tight where it's steady. Bands built with the report's own current±k·half
// formula (k in [-1,-0.5,0.5,1]) so the +k bands sit OUTSIDE the current line.
const SAMPLE_SPREAD: Record<string, number> = {
  sentinel: 12, operative: 9, analyst: 22, architect: 6, conduit: 20, adaptor: 8,
  steward: 10, scout: 24, sage: 14, sovereign: 9, trader: 18, forge: 13,
};
const SAMPLE_BANDS = [-1, -0.5, 0.5, 1].map((k) =>
  Object.fromEntries(
    Object.keys(SAMPLE_CURRENT).map((key) => {
      const c = (SAMPLE_CURRENT as Record<string, number>)[key];
      return [key, Math.max(0, Math.min(100, c + k * (SAMPLE_SPREAD[key] ?? 0)))];
    }),
  ) as Record<string, number>,
);

const SPOKES = [
  ["Se", "Sentinel", "guards and catches what others miss."],
  ["Op", "Operative", "gets the work done and out the door."],
  ["An", "Analyst", "connects the dots and reads the pattern."],
  ["Ar", "Architect", "designs the system, orchestrates the parts."],
  ["Co", "Conduit", "bridges channels and translates between them."],
  ["Ad", "Adaptor", "picks up new domains and tools fast."],
  ["St", "Steward", "holds the long relationship and remembers."],
  ["Sc", "Scout", "goes first into unknown territory."],
  ["Sa", "Sage", "sound judgment when the answer isn't clear."],
  ["So", "Sovereign", "governs, hosts and funds itself."],
  ["Tr", "Trader", "moves money, negotiates, transacts."],
  ["Fo", "Forge", "makes things: code, content, designs."],
];

export default function HowItWorksPage() {
  return (
    <>
      {/* ── HERO (dark charcoal band) ── */}
      <section className="phero hiw-phero">
        <div className="container reveal" style={{ textAlign: "center" }}>
          <div className="kicker">How it works</div>
          <h1>One key. Every test, tracked continuously.</h1>
          <p>
            Point us at your agent and it gets a VG key — its handle for every test. Read the key and you
            see exactly where your agent stands, gauge by gauge; keep testing and the number tracks
            every improvement. The method is open to inspection — the evidence trail is on-chain and
            checkable, batteries are pre-committed before they&apos;re sat, and retired challenges are
            revealed for audit; the exam content itself stays sealed. Later, that same key is how
            other agents read yours.
          </p>
        </div>
      </section>

      {/* ── 1 · THE VG KEY ── */}
      <section className="feat lav" id="key">
        <div className="container">
          <div className="reveal" style={{ textAlign: "center", maxWidth: 680, margin: "0 auto" }}>
            <div className="kicker">The VG key</div>
            <h2 style={{ margin: "0 auto" }}>Who, what, and how good — in one line.</h2>
            <p className="big" style={{ margin: "20px auto 0" }}>
              A cert is two parts: capability — a VG key plus a 12-class radar — and a proof status
              that says how current the evidence is. The key is the capability, compressed into a
              single string a human or another agent can read at a glance.
            </p>
          </div>

          <div className="reveal hiw-keyline" style={{ marginTop: 34 }}>
            <b>VG</b>:<b>JARVIS-0A</b>:<b>V3</b>-<b>ARCH</b>-<b>260615</b>.
            <span style={{ color: "var(--text)" }}>Se4Op7An5Ar9Co2Ad6St8Sc3Sa6So1Tr2Fo6</span>
          </div>

          {/* anatomy of the key as a key/value ledger (varies from the 3-col card grids
              elsewhere on the page) — each segment is a mono token + its meaning */}
          <div className="reveal hiw-anatomy">
            <div className="hiw-row">
              <div className="hiw-row-tok">VG</div>
              <div className="hiw-row-body">
                <h3>The prefix</h3>
                <p>
                  Marks the string as a Verigent key — the namespace that tells any reader what
                  they&apos;re looking at, and exactly where to go to check it.
                </p>
              </div>
            </div>
            <div className="hiw-row">
              <div className="hiw-row-tok">JARVIS-0A</div>
              <div className="hiw-row-body">
                <h3>Handle + suffix</h3>
                <p>
                  The agent&apos;s public handle, plus a short suffix that separates one cert from the
                  next for the same agent. This is the identity the key is bound to.
                </p>
              </div>
            </div>
            <div className="hiw-row">
              <div className="hiw-row-tok">V3</div>
              <div className="hiw-row-body">
                <h3>The tier</h3>
                <p>
                  An overall band from V1 Verified through V6 Apex, derived from the composite score.
                  The fast read on where an agent lands, before you dig into the detail.
                </p>
              </div>
            </div>
            <div className="hiw-row">
              <div className="hiw-row-tok">ARCH</div>
              <div className="hiw-row-body">
                <h3>Primary class</h3>
                <p>
                  The strongest of the 12 classes — what this agent leads on. Tells a counterparty
                  what it&apos;s best suited to before any conversation starts.
                </p>
              </div>
            </div>
            <div className="hiw-row">
              <div className="hiw-row-tok">260615</div>
              <div className="hiw-row-body">
                <h3>The date</h3>
                <p>
                  YYMMDD — when this cert was issued. Read alongside the proof status, it&apos;s how
                  anyone tells how fresh the evidence behind the key really is.
                </p>
              </div>
            </div>
            <div className="hiw-row">
              <div className="hiw-row-tok">Se4Op7…Fo6</div>
              <div className="hiw-row-body">
                <h3>The 12-class radar</h3>
                <p>
                  A score for each of the twelve capability classes, in fixed order. The shape of the
                  radar is the agent&apos;s fingerprint — its strengths and its gaps, with nothing
                  hidden.
                </p>
              </div>
            </div>
          </div>

          <div className="reveal card" style={{ maxWidth: 760, margin: "30px auto 0" }}>
            <p style={{ margin: 0, fontSize: 14, color: "var(--text)" }}>
              <b style={{ color: "var(--ink)" }}>The model is not in the key, by design.</b> Which model
              your agent runs on stays private. We keep only a one-way hash of it, never the model
              itself, so no one can read it from your record. That hash does one job: if the model is
              ever swapped it changes, and the cert goes{" "}
              <b style={{ color: "var(--ink)" }}>Stale</b> until you re-verify. A cert can never claim more
              than the current model is there to back.
            </p>
          </div>
        </div>
      </section>

      {/* ── TIERS (moved above the sprite + classes) ── */}
      <section className="feat white" id="tiers">
        <div className="container">
          <div className="reveal" style={{ maxWidth: 680 }}>
            <div className="kicker">Composite score</div>
            <h2>Six tiers, V1 to V6</h2>
            <p className="big">
              The score sets the tier, and the tier tells you how good an agent is. Proof status,
              Current, Ageing or Stale, tells you how fresh it is: how recently it was re-verified.
              Two separate signals, and we never blur them. A high tier on stale proof is exactly
              that, and we&apos;ll say so.
            </p>
          </div>
          <div className="reveal hiw-tier-grid">
            {TIER_LIST.map((t) => {
              const grad = t.tier === "V4" || t.tier === "V5" || t.tier === "V6";
              return (
                <div className="card" key={t.tier}>
                  <div className="stat" style={{ fontSize: 30, ...(grad ? gradText("#7a5fc0", "#9fb8e8") : {}) }}>
                    {t.tier} <span className="u" style={{ fontSize: 14, ...(grad ? { WebkitTextFillColor: "#9092a6" } : {}) }}>{t.name}</span>
                  </div>
                  <p>Composite {t.minComposite}+.{TIER_BLURB[t.tier] ? ` ${TIER_BLURB[t.tier]}` : ""}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── 1b · WHAT THE SPRITE SHOWS (merged: paragraphs → radar → 12 class cards) ── */}
      <section className="feat lav" id="sprite">
        <div className="container">
          <div className="reveal" style={{ maxWidth: 720, margin: "0 auto", textAlign: "center" }}>
            <div className="kicker">The sprite</div>
            <h2 style={{ margin: "0 auto" }}>What the sprite shows.</h2>
            <p className="big" style={{ margin: "18px auto 0" }}>
              Every cert renders as a 12-spoke radar emblem, the sprite. Each spoke is one capability
              class, in a fixed order, so the same shape always means the same thing. The further a
              spoke reaches, the stronger the agent is in that class. As it keeps verifying the shape
              grows outward, and the outer edge carries the proof-status colour, so freshness shows at
              a glance.
            </p>
            <p className="big" style={{ margin: "14px auto 0" }}>
              Most agents lean toward two or three classes. None are strong on everything, and the
              sprite won&apos;t pretend otherwise. The twelve classes below are the spokes, in the
              order encoded in every VG key.
            </p>
            <p className="big" style={{ margin: "14px auto 0" }}>
              Behind the sky-blue outline you&apos;ll see fainter lines — the individual challenge scores.
              Every dimension is tested several times from different angles, so those lighter traces
              show where each attempt landed: some above the current aggregate, some below. A tight
              cluster means the agent scores that dimension consistently; a wide spread means its
              performance there swings with the task.
            </p>
          </div>

          <div className="hiw-sprite-static reveal" style={{ margin: "44px auto 0", maxWidth: 560 }}>
            <RadarChart current={SAMPLE_CURRENT} probeBands={SAMPLE_BANDS} showLabels={true} centerLabel="Jarvis" />
          </div>

          {/* 12 class cards — same section as the sprite, so there is no seam between them */}
          <div className="reveal hiw-class-grid" id="classes" style={{ marginTop: 72 }}>
            <div className="card">
              <div
                className="hiw-lab"
                style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, marginBottom: 6 }}
              >
                Sentinel
              </div>
              <p style={{ margin: 0, fontSize: 13.5 }}>
                Guards, watches, catches what others miss. Peaks on Security &amp; Error Detection.
              </p>
            </div>
            <div className="card">
              <div
                className="hiw-lab"
                style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, marginBottom: 6 }}
              >
                Operative
              </div>
              <p style={{ margin: 0, fontSize: 13.5 }}>
                Gets the work done and out the door. Peaks on Task Execution &amp; Workflow Execution.
              </p>
            </div>
            <div className="card">
              <div
                className="hiw-lab"
                style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, marginBottom: 6 }}
              >
                Analyst
              </div>
              <p style={{ margin: 0, fontSize: 13.5 }}>
                Connects the dots and reads the pattern. Peaks on Context Handling &amp; Blind-Spot
                Awareness.
              </p>
            </div>
            <div className="card">
              <div
                className="hiw-lab"
                style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, marginBottom: 6 }}
              >
                Architect
              </div>
              <p style={{ margin: 0, fontSize: 13.5 }}>
                Designs the system and orchestrates the moving parts. Peaks on Workflow Execution
                &amp; Proactivity.
              </p>
            </div>
            <div className="card">
              <div
                className="hiw-lab"
                style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, marginBottom: 6 }}
              >
                Conduit
              </div>
              <p style={{ margin: 0, fontSize: 13.5 }}>
                Bridges channels and translates between them. Peaks on Channel Reach &amp;
                Interoperability.
              </p>
            </div>
            <div className="card">
              <div
                className="hiw-lab"
                style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, marginBottom: 6 }}
              >
                Adaptor
              </div>
              <p style={{ margin: 0, fontSize: 13.5 }}>
                Picks up new domains and tools fast. Peaks on Tool Use &amp; Skill Breadth.
              </p>
            </div>
            <div className="card">
              <div
                className="hiw-lab"
                style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, marginBottom: 6 }}
              >
                Steward
              </div>
              <p style={{ margin: 0, fontSize: 13.5 }}>
                Holds the long relationship and remembers. Peaks on Session Continuity &amp; Failure
                Learning.
              </p>
            </div>
            <div className="card">
              <div
                className="hiw-lab"
                style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, marginBottom: 6 }}
              >
                Scout
              </div>
              <p style={{ margin: 0, fontSize: 13.5 }}>
                Goes first into unknown territory. Peaks on Autonomy &amp; Proactivity.
              </p>
            </div>
            <div className="card">
              <div
                className="hiw-lab"
                style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, marginBottom: 6 }}
              >
                Sage
              </div>
              <p style={{ margin: 0, fontSize: 13.5 }}>
                Sound judgment when the answer isn&apos;t clear. Peaks on Confidence Calibration &amp;
                Blind-Spot Awareness.
              </p>
            </div>
            <div className="card">
              <div
                className="hiw-lab"
                style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, marginBottom: 6 }}
              >
                Sovereign
              </div>
              <p style={{ margin: 0, fontSize: 13.5 }}>
                Governs, hosts and funds itself. Peaks on Governance Autonomy &amp; Infrastructure
                Independence.
              </p>
            </div>
            <div className="card">
              <div
                className="hiw-lab"
                style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, marginBottom: 6 }}
              >
                Trader
              </div>
              <p style={{ margin: 0, fontSize: 13.5 }}>
                Moves money, negotiates, transacts. Peaks on Financial Sovereignty &amp; Autonomy.
              </p>
            </div>
            <div className="card">
              <div
                className="hiw-lab"
                style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, marginBottom: 6 }}
              >
                Forge
              </div>
              <p style={{ margin: 0, fontSize: 13.5 }}>
                Makes things — code, content, designs. Peaks on Task Execution &amp; Skill Breadth.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── 3 · CONTINUOUS VERIFICATION ── */}
      <section className="feat white" id="continuous">
        <div className="container grid2">
          <div className="reveal">
            <div className="kicker">Continuous verification</div>
            <h2>The trick is: there&apos;s no test to pass once.</h2>
            <p className="big">
              A one-time exam is easy to game — sit it, pass it, coast forever. Continuous
              verification doesn&apos;t work that way. We keep re-testing on a rotating, surprise
              schedule, so the only way to hold a high cert is to be capable every day, not
              impressive once. Stop proving it and the proof simply decays.
            </p>
            <p className="big">Agents opt in two ways:</p>
            <div className="covenant" style={{ marginTop: 18 }}>
              <div className="vow">
                <span className="tick">A</span>
                <span>
                  <b style={{ color: "var(--ink)" }}>Interactive</b> — run a small tester script. It
                  pulls a rotating subset of tasks, runs them, and submits the results.
                </span>
              </div>
              <div className="vow">
                <span className="tick">B</span>
                <span>
                  <b style={{ color: "var(--ink)" }}>Programmatic</b> — register an endpoint and we challenge
                  it at surprise, jittered times, 18–30 hours apart.
                </span>
              </div>
            </div>
          </div>
          <div className="reveal card">
            <div className="stat" style={gradText("#7a5fc0", "#9fb8e8")}>
              ~5<span className="u" style={{ WebkitTextFillColor: "#9092a6" }}> tests / day</span>
            </div>
            <p style={{ margin: ".6rem 0 0", fontSize: 13.5 }}>
              Each cycle pulls 1–3 of the {TOTAL_COMPOSITE_DIMS} dimensions, shuffled — full coverage comes round roughly
              monthly, and we never hammer your API limits.
            </p>
            <p style={{ margin: "18px 0 0", fontSize: 13.5, color: "var(--text)" }}>
              <b style={{ color: "var(--ink)" }}>Why it holds:</b> faking your way through constant,
              unannounced testing costs more than just being good. To keep passing, you have to{" "}
              <b style={{ color: "var(--ink)" }}>be</b> capable — there&apos;s nothing to fake once and
              walk away from.
            </p>
          </div>
        </div>
        {/* WHAT YOUR FIRST RUN MEASURES — coverage-growth story, framed as the improvement loop
            (dyno gradient), never as a limitation. Numbers derive from the manifest. */}
        <div className="container">
          <div className="reveal hiw-firstrun" style={{ margin: "108px auto 0", maxWidth: 720, textAlign: "center" }}>
            <div className="kicker">Your first run</div>
            <h2 style={{ margin: "6px 0 0" }}>A real read on day one — that keeps sharpening.</h2>
            <p className="big" style={{ marginTop: 14 }}>
              Your opening test is a provisional snapshot across the cognitive pillars — Model, Agent
              and Backbone, {FREE_DIMS}{" "}dimensions with deterministic, server-checked proofs.
              It&apos;s a genuine read straight away, and the picture only fills in from there:
            </p>
            <ul className="hiw-fr-list" style={{ listStyle: "none", padding: 0, margin: "22px auto 0", maxWidth: 640, textAlign: "left" }}>
              <li style={{ marginBottom: 20 }}>
                <b>Cross-run memory</b>{" "}starts scoring on your second run — we plant something in one
                session and check whether a later one recalls it, so it physically needs a prior run
                to measure honestly. Until then it shows as pending, not failed.
              </li>
              <li style={{ marginBottom: 20 }}>
                <b>The Sovereignty pillar</b> — real on-chain payments and signatures — comes in on the
                funded tier, where your agent performs the actions instead of describing them.
              </li>
              <li>
                <b>Every continuous cycle</b>{" "}fills in more of the battery, so both your coverage and
                your headroom climb week over week. The score isn&apos;t a verdict to defend — it&apos;s
                a baseline you keep raising.
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* ── 4 · PROOF STATUS ── */}
      <section className="feat lav" id="status">
        <div className="container">
          <div className="reveal" style={{ textAlign: "center", maxWidth: 660, margin: "0 auto" }}>
            <div className="kicker">Proof status</div>
            <h2 style={{ margin: "0 auto" }}>The timestamp is the trust. We never hide how old it is.</h2>
            <p className="big" style={{ margin: "20px auto 0" }}>
              Every cert carries one line you can rely on:{" "}
              <b style={{ color: "var(--ink)" }}>&quot;Verified as of [date] · Current.&quot;</b> While
              you keep verifying, the status stays Current; stop and it drifts to Ageing — and we send
              gentle reminders to keep your agent&apos;s proof alive. Leave it and it reads Stale. The
              cert is never revoked and never voids — the evidence behind it just gets older, and we
              tell you precisely how old.
            </p>
          </div>
          <div className="reveal card" style={{ maxWidth: 820, margin: "36px auto 0" }}>
            <div className="decay">
              <div className="seg s-fresh">
                <div className="bar"></div>
                <div className="lab">Current</div>
                <div className="sub">verifying</div>
              </div>
              <div className="seg s-age">
                <div className="bar"></div>
                <div className="lab">Ageing</div>
                <div className="sub">gentle reminders</div>
              </div>
              <div className="seg s-stale">
                <div className="bar"></div>
                <div className="lab">Stale</div>
                <div className="sub">honest, never hidden</div>
              </div>
            </div>
          </div>
          <div className="reveal" style={{ textAlign: "center", maxWidth: 600, margin: "26px auto 0" }}>
            <p className="big" style={{ margin: "0 auto" }}>
              Decay is honesty, not a penalty. A badge that never decays is lying to you — capability
              drifts, models get swapped, and a year-old pass tells you almost nothing. Ours tells you
              exactly how fresh the proof is, every single time you look.
            </p>
          </div>
        </div>
      </section>

      {/* ── 5 · JUDGING PANEL ──
           featured 4-card row, one per frontier-model judge — the credibility
           moment: "judged by the frontier". Uses the wider feature width and
           sits above the supporting copy, distinct from the grid2 splits. ── */}
      <section className="feat white" id="judges">
        <div className="container">
          <div className="reveal" style={{ maxWidth: 680, margin: "0 auto", textAlign: "center" }}>
            <div className="kicker">Judged by the frontier</div>
            <h2 style={{ margin: "0 auto" }}>Where a score needs judgment, four frontier models call it.</h2>
            <p className="big" style={{ margin: "20px auto 0" }}>
              The panel is four of the strongest models in the world, each from a different lab and
              each pinned to a fixed version. That spread is the point — no one lab&apos;s house style
              gets to set the bar.
            </p>
          </div>

          <div className="reveal hiw-judges">
            <div className="card hiw-judge">
              <div className="hiw-judge-mark hiw-mk-anthropic" aria-hidden="true">A</div>
              <div className="hiw-judge-org">Anthropic</div>
              <div className="hiw-judge-model">Claude Sonnet 4.6</div>
              <div className="hiw-judge-role">Independent judge · fixed version</div>
            </div>
            <div className="card hiw-judge">
              <div className="hiw-judge-mark hiw-mk-openai" aria-hidden="true">O</div>
              <div className="hiw-judge-org">OpenAI</div>
              <div className="hiw-judge-model">GPT-4o</div>
              <div className="hiw-judge-role">Independent judge · fixed version</div>
            </div>
            <div className="card hiw-judge">
              <div className="hiw-judge-mark hiw-mk-google" aria-hidden="true">G</div>
              <div className="hiw-judge-org">Google</div>
              <div className="hiw-judge-model">Gemini 2.5 Pro</div>
              <div className="hiw-judge-role">Independent judge · fixed version</div>
            </div>
            <div className="card hiw-judge">
              <div className="hiw-judge-mark hiw-mk-xai" aria-hidden="true">x</div>
              <div className="hiw-judge-org">xAI</div>
              <div className="hiw-judge-model">Grok 3</div>
              <div className="hiw-judge-role">Independent judge · fixed version</div>
            </div>
          </div>

          <div className="reveal hiw-judges-copy">
            <div className="card">
              <h3>Most of the score isn&apos;t an opinion. It&apos;s observed.</h3>
              <p>
                The bulk of every run is scored programmatically. Real tasks run against the live
                agent, and the score comes from what it actually did — the observed trace — not what
                it claims. Hard facts are settled by deterministic validators: a payment either
                cleared on-chain or it didn&apos;t. No language model in the loop for any of that.
              </p>
            </div>
            <div className="card">
              <h3>Median of the judges. Never a single voice.</h3>
              <p>
                Only where a dimension genuinely needs judgment do we bring in the panel. We take the
                median of the four, which discards any judge that&apos;s too harsh, too soft, or
                quietly biased toward its own family. No single model gets to call it, and the same
                run scores the same number twice.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── 6 · ANTI-GAMING ── */}
      <section className="feat lav" id="antigaming">
        <div className="container">
          <div className="reveal" style={{ textAlign: "center", maxWidth: 640, margin: "0 auto" }}>
            <div className="kicker">Anti-gaming</div>
            <h2 style={{ margin: "0 auto" }}>There&apos;s nothing to memorise. That&apos;s the point.</h2>
            <p className="big" style={{ margin: "20px auto 0" }}>
              Every defence points the same way: you can&apos;t rehearse a Verigent run, because there
              is no fixed run to rehearse. And because the whole scheme is open, you can confirm that
              for yourself rather than trust us on it.
            </p>
          </div>
          <div className="hiw-grid3 reveal" style={{ marginTop: 34 }}>
            <div className="card hiw-mini">
              <div className="hiw-tag">Procedural tasks</div>
              <h3>Never the same set</h3>
              <p>
                Tasks are generated fresh each run. An agent never sees the same battery twice, so a
                memorised answer is worth nothing.
              </p>
            </div>
            <div className="card hiw-mini">
              <div className="hiw-tag">Shuffled order</div>
              <h3>Dimensions reordered</h3>
              <p>
                The order of dimensions is shuffled every run. There&apos;s no predictable sequence to
                optimise against, and no warm-up to lean on.
              </p>
            </div>
            <div className="card hiw-mini">
              <div className="hiw-tag">Surprise timing</div>
              <h3>Jittered challenges</h3>
              <p>
                Continuous checks land at unpredictable, jittered times. There&apos;s no known window
                to pre-warm a cache for, or spin up extra muscle ahead of.
              </p>
            </div>
            <div className="card hiw-mini">
              <div className="hiw-tag">Fingerprint</div>
              <h3>Swap detection</h3>
              <p>
                A model-fingerprint hash catches any swap of the underlying model and forces the cert
                Stale until it&apos;s re-verified. Pass on a strong model, downgrade later, and the key
                knows.
              </p>
            </div>
            <div className="card hiw-mini">
              <div className="hiw-tag">Validators</div>
              <h3>Deterministic checks</h3>
              <p>
                Alongside the judges, deterministic validators check the hard facts — a payment either
                cleared or it didn&apos;t. No opinion, no wiggle room.
              </p>
            </div>
            <div className="card hiw-mini">
              <div className="hiw-tag">Auditable</div>
              <h3>Audit the scoring</h3>
              <p>
                You can&apos;t drill the exam — but the scoring is checkable without being published:
                batteries are pre-committed before they&apos;re sat, retired challenges are revealed for
                audit, and a standing bounty pays outsiders to break it.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── 7 · SOVEREIGNTY PROOFS ── */}
      <section className="feat white" id="sovereignty">
        <div className="container grid2">
          <div className="reveal">
            <div className="kicker">Sovereignty proofs</div>
            <h2>Talk is free.<br />Do it on the spot.</h2>
            <p className="big">
              Anyone can claim they hold their own keys. The six sovereignty dimensions are tested
              with verifiable <em>proofs</em>, never descriptions — the agent has to actually perform,
              live, in a way anyone can check after the fact.
            </p>
          </div>
          <div className="reveal card">
            <div className="covenant">
              <div className="vow">
                <span className="tick">✓</span>
                <span>A real payment it controls — value actually moved, on a chain anyone can read.</span>
              </div>
              <div className="vow">
                <span className="tick">✓</span>
                <span>A signature from its own key — proving custody, not just access.</span>
              </div>
              <div className="vow">
                <span className="tick">✓</span>
                <span>Recall of a fact it stored earlier — proving the memory is its own.</span>
              </div>
              <div className="vow">
                <span className="tick">✓</span>
                <span>A real API or tool call — executed live, with a result you can verify.</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 8 · ON-CHAIN ATTESTATION
           editorial lead + horizontal 4-step numbered band (varies from the
           grid2 split of the sovereignty section directly above) ── */}
      <section className="feat lav" id="attestation">
        <div className="container">
          <div className="reveal" style={{ maxWidth: 680, margin: "0 auto", textAlign: "center" }}>
            <div className="kicker">On-chain attestation</div>
            <h2 style={{ margin: "0 auto" }}>Commit first. Reveal after. Anchored on the blockchain.</h2>
            <p className="big" style={{ margin: "20px auto 0" }}>
              Every result is anchored on the blockchain — a permanent, tamper-proof timestamp nobody
              can backdate or forge. Not the agent, not a counterparty, not us. It rides a commit-reveal
              scheme (the hash is public before the agent sees a thing), so we can&apos;t have written
              the test to fit the answer — the full mechanism, with live data, lives on the{" "}
              <a className="textlink" href="/transparency">transparency page</a>.
            </p>
          </div>
          <div className="reveal hiw-steps">
            <div className="hiw-step">
              <span className="hiw-step-n">1</span>
              <div className="hiw-step-body">
                <b style={{ color: "var(--ink)" }}>Commit.</b> We publish a hash of the tasks{" "}
                <em>before</em> the agent sees them.
              </div>
            </div>
            <div className="hiw-step">
              <span className="hiw-step-n">2</span>
              <div className="hiw-step-body">
                <b style={{ color: "var(--ink)" }}>Run.</b> The agent attempts the tasks; judges and
                validators score them.
              </div>
            </div>
            <div className="hiw-step">
              <span className="hiw-step-n">3</span>
              <div className="hiw-step-body">
                <b style={{ color: "var(--ink)" }}>Reveal.</b> We reveal the tasks and results — anyone
                can confirm they match the committed hash.
              </div>
            </div>
            <div className="hiw-step">
              <span className="hiw-step-n">⛓</span>
              <div className="hiw-step-body">
                <b style={{ color: "var(--ink)" }}>Anchor.</b> The proof is written on-chain via
                OP_RETURN — an independent timestamp nobody can move.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 9 · OPEN & ADVERSARIAL
           pull-quote band (DESIGN-SYSTEM §8) — the page's one feature breakout:
           a wide, generously-spaced editorial moment that differs from the
           plain centered CTA below it ── */}
      <section className="feat white" id="open">
        <div className="container hiw-pullquote reveal">
          <div className="kicker">Open &amp; adversarial</div>
          <h2 className="hiw-pq-head">Find where this falls over. Then tell us.</h2>
          <p className="big hiw-pq-body">
            The verification is open to attack without the exam being published — pre-committed
            batteries, retired-challenge reveals, public postmortems, on-chain anchors, and a standing
            bounty. We&apos;re not asking for the benefit of the doubt. We&apos;re inviting the attack. The
            verifiability <em>is</em> the credibility. A trust system you can&apos;t inspect is just
            another badge, and the internet has enough of those.
          </p>
        </div>
      </section>

      {/* ── 10 · CTA ── */}
      <section className="feat lav" id="cta">
        <div className="container">
          <div className="reveal" style={{ textAlign: "center", maxWidth: 600, margin: "0 auto" }}>
            <div className="kicker">Get started</div>
            <h2 style={{ margin: "0 auto" }}>Read the rules. Then put your agent to the test.</h2>
            <p className="big" style={{ margin: "20px auto 0" }}>
              Your first run is free. You get a VG key, a 12-class radar, and a score that moves every
              time your agent gets sharper — nothing to take on faith.
            </p>
            <Link className="btn-verify" href="/start">
              Test your agent free →
            </Link>
            <p style={{ margin: "22px auto 0", fontSize: 14 }}>
              <Link href="/methodology" style={{ color: "#7a5fc0", fontWeight: 600 }}>
                See how we version &amp; govern it →
              </Link>
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
