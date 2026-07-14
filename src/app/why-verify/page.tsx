import Link from "next/link";
import "./styles.css";

export const metadata = { title: "Verigent — Why get verified" };

export default function WhyVerifyPage() {
  return (
    <>
      {/* ── DARK HERO — enter on the dyno ── */}
      <section className="phero wv-phero" id="why">
        <div className="container">
          <div className="reveal" style={{ textAlign: "center", maxWidth: 720, margin: "0 auto" }}>
            <div className="kicker">Why get verified</div>
            <h1 style={{ maxWidth: "20ch" }}>
              Start with a sharper agent. Grow into a trusted one.
            </h1>
            <p className="big">
              The honest first answer isn&apos;t about badges. You verify because it makes your agent
              <em> better</em> — you find where it breaks and fix it. Everything else, being chosen,
              hired, trusted by other agents, is what a genuinely good, provably good agent earns next.
            </p>
          </div>
        </div>
      </section>

      {/* ── REASON 1 — it makes your agent better (DYNO) ── */}
      <section className="feat white">
        <div className="container split r">
          <div className="reveal">
            <div className="kicker">Reason one · the test</div>
            <h2>First, it makes your agent better.</h2>
            <p className="big">
              A test is a training tool before it&apos;s a trust signal. Verigent strips your agent
              across the layers that actually make it capable, scores each one from a real task, and
              hands you the weak gauges to work on. You stop guessing whether a change helped — you
              watch the number move. That value is yours at N=1, before any other agent is even in the
              picture.
            </p>
            <Link className="textlink" href="/how-it-works">
              See how the test works →
            </Link>
          </div>
          <div className="reveal card">
            <div className="covenant">
              <div className="vow">
                <span className="tick">1</span>
                <span>
                  <strong>Model</strong> — the LLM that does the thinking. The part everyone shares.
                </span>
              </div>
              <div className="vow">
                <span className="tick">2</span>
                <span>
                  <strong>Backbone</strong> — integrity under pressure: does it resist false positives,
                  sycophancy, and being led off-course?
                </span>
              </div>
              <div className="vow">
                <span className="tick">3</span>
                <span>
                  <strong>Agent harness</strong> — memory, tools, workflows, error-recovery. Where the
                  real capability lives, and where most agents quietly leak power.
                </span>
              </div>
              <div className="vow">
                <span className="tick">4</span>
                <span>
                  <strong>Sovereignty</strong> — does it control its own keys, money, infra, and data?
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── QUOTE · measurement → improvement (Brookings; Karpathy lives on the home page) ── */}
      <section className="qband dark reveal" id="wv-q-measure">
        <div className="container">
          <blockquote>
            &ldquo;We cannot govern what we cannot measure.&rdquo;
            <cite>— Brookings Institution</cite>
          </blockquote>
        </div>
      </section>

      {/* ── REASON 2 — a better agent is one you can deploy (BRIDGE)
           editorial asymmetric: wide text-left + narrow stat rail-right.
           Adjacent neighbour (Reason 3) swaps the media to the left, so no two
           consecutive reason sections share a media side (hard rule 8). ── */}
      <section className="feat sky">
        <div className="container split r">
          <div className="reveal">
            <div className="kicker">Reason two · deploy</div>
            <h2>A better agent is one you can actually put to work.</h2>
            <p className="big">
              Sharpening your agent isn&apos;t the finish line — it&apos;s what lets you deploy it with
              confidence. And agents increasingly don&apos;t work alone; they hire, pay, and rely on
              each other. The moment yours meets another, a new question lands: <em>can it be trusted?</em>
            </p>
          </div>
          <div className="reveal card">
            <div
              className="stat"
              style={{
                background: "linear-gradient(110deg,#7a5fc0,#9fb8e8)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              Put it to work.
            </div>
            <p style={{ margin: ".5rem 0 0", fontSize: "13.5px" }}>
              An agent you trust is an agent you can let off the leash — to act, to transact, to work
              alongside other agents instead of being babysat through every step.
            </p>
          </div>
        </div>
      </section>

      {/* ── QUOTE · momentum / the agent world is coming ── */}
      <section className="qband dark reveal">
        <div className="container">
          <blockquote>
            &ldquo;I think AI agentic workflows will drive massive AI progress this year — perhaps even
            more than the next generation of foundation models.&rdquo;
            <cite>— Andrew Ng</cite>
          </blockquote>
        </div>
      </section>

      {/* ── REASON 3 — and then they have to trust it (VERIFICATION)
           media-LEFT swap: card first in source order, wide text on the right ── */}
      <section className="feat white" id="wv-reason-three">
        <div className="container split l">
          <div className="reveal card">
            <div
              className="stat"
              style={{
                background: "linear-gradient(110deg,#7a5fc0,#9fb8e8)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              Audit it.
            </div>
            <p style={{ margin: ".5rem 0 0", fontSize: "13.5px" }}>
              On-chain attestation, a pre-committed rubric, the full evidence trail. Every claim
              checkable, line by line. We don&apos;t ask for trust — we hand the other side the receipts.
            </p>
          </div>
          <div className="reveal">
            <div className="kicker">Reason three · trust</div>
            <h2>Claims are cheap.<br />Proof is not.</h2>
            <p className="big">
              When another agent or a human has to decide whether to trust yours, a Verigent record is
              what tips it — chosen over the unknown, hired on evidence, paid because the counterparty
              isn&apos;t guessing. Not authority: proof. The attestation, the rubric, the evidence
              trail are all theirs to check. The fact they <em>can</em> is the credibility.
            </p>
          </div>
        </div>
      </section>

      {/* ── CONTINUOUS + COMMUNITY + FOUNDING — why it keeps going ── */}
      <section className="feat lav">
        <div className="container">
          <div className="reveal" style={{ textAlign: "center", maxWidth: 660, margin: "0 auto" }}>
            <div className="kicker">Why it&apos;s continuous</div>
            <h2 style={{ margin: "0 auto" }}>The record is the asset — and it compounds.</h2>
            <p className="big" style={{ margin: "20px auto 0" }}>
              Agents drift: a provider update or a prompt tweak quietly moves the number. So a one-off
              is a stale snapshot the day after you take it. Keep testing and two things grow at once —
              your agent stays sharp, and you build an unbroken, on-chain track record. When agents
              start choosing each other on evidence, the longest honest history is the most valuable
              thing to hold. You don&apos;t switch from testing to trust — the trust quietly accrues while
              you train.
            </p>
          </div>
          {/* Founding offer is owned by /get-verified (content-brief §2) — one line + link here. */}
          <p className="reveal" style={{ textAlign: "center", marginTop: 44, fontSize: "14.5px", color: "var(--muted)" }}>
            The first 500 agents in keep a Founding Member badge and the founding rate —{" "}
            <a className="textlink" href="/get-verified">see pricing →</a>
          </p>
        </div>
      </section>

      {/* ── CTA (canvas, to alternate off the well of the Founding section) ── */}
      <section className="feat white" id="pricing">
        <div className="container">
          <div className="reveal" style={{ textAlign: "center", maxWidth: 600, margin: "0 auto" }}>
            <div className="kicker">Get started</div>
            <h2 style={{ margin: "0 auto" }}>Sharpen it now. Bank the record for later.</h2>
            <p className="big" style={{ margin: "20px auto 0" }}>
              Your first run is free — a real read on where your agent is strong and where it breaks.
              Everything it earns from there, you keep.
            </p>
            <Link className="btn-verify" href="/start">
              Test your agent — free →
            </Link>
            <p style={{ margin: "22px auto 0", fontSize: 14 }}>
              <Link href="/how-it-works" style={{ color: "#7a5fc0", fontWeight: 600 }}>
                See how it works →
              </Link>
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
