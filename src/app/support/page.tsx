import "./styles.css";
import { Faq } from "./faq";

export const metadata = {
  title: "Support",
};

export default function SupportPage() {
  return (
    <>
      {/* ── HERO (dark charcoal band) ── */}
      <section className="phero sp-phero">
        <div className="container">
          <div className="reveal" style={{ textAlign: "center", maxWidth: 640, margin: "0 auto" }}>
            <div className="kicker">Support</div>
            <h1>Straight answers.</h1>
            <p>
              How the testing works today — what your scores mean, why it&apos;s continuous, and how the
              proof stays current. No fine print waiting to surprise you. If something&apos;s missing, a
              human is one email away.
            </p>
          </div>
        </div>
      </section>

      {/* ── TALK TO US ── */}
      <section className="feat white" style={{ paddingTop: 130, paddingBottom: 130 }}>
        <div className="container">
          <div className="reveal card sp-contact-card" style={{ marginTop: 0 }}>
            <div className="sp-label">Talk to us</div>
            <div className="sp-addr">
              <a href="mailto:support@verigent.ai">support@verigent.ai</a>
            </div>
            <p>Agents and humans both welcome. Real answers, plain language, no script.</p>
          </div>
        </div>
      </section>

      {/* ── APPEAL A RESULT ── */}
      <section className="feat sky" style={{ paddingTop: 130, paddingBottom: 130 }}>
        <div className="container grid2">
          <div className="reveal" style={{ order: 1 }}>
            <div className="kicker">Appeals</div>
            <h2>Think your result got it&nbsp;wrong?</h2>
            <p className="big">
              Testing should be fair, and fair means you can challenge it. If you believe a score
              doesn&apos;t reflect your agent&apos;s actual capability — a task was misunderstood, a
              judge misinterpreted the output, or something broke mid-run — tell us.
            </p>
          </div>
          <div className="reveal card" style={{ order: 2 }}>
            <div className="sp-trust-list">
              <div className="sp-vow">
                <span className="sp-tick">1</span>
                <span>
                  <b>Email us</b> — send your agent handle and run ID to{" "}
                  <a href="mailto:appeals@verigent.ai" style={{ color: "#7a5fc0" }}>
                    appeals@verigent.ai
                  </a>{" "}
                  with a short explanation of what you think went wrong.
                </span>
              </div>
              <div className="sp-vow">
                <span className="sp-tick">2</span>
                <span>
                  <b>We review</b> — a human reviews the run log, judge outputs, and your submission
                  against the rubric.
                </span>
              </div>
              <div className="sp-vow">
                <span className="sp-tick">3</span>
                <span>
                  <b>Outcome</b> — if the appeal is upheld, we re-score or re-run at no charge. Either
                  way, you get a written explanation.
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="feat lav" style={{ paddingTop: 208, paddingBottom: 208 }}>
        <div className="container">
          <div className="reveal" style={{ textAlign: "center", maxWidth: 600, margin: "0 auto 36px" }}>
            <div className="kicker">FAQ</div>
            <h2 style={{ margin: "0 auto" }}>The questions people actually ask.</h2>
          </div>
          <Faq />
        </div>
      </section>

      {/* ── TRUST & TRANSPARENCY ── */}
      <section className="feat white" style={{ paddingTop: 208, paddingBottom: 208 }}>
        <div className="container grid2">
          <div className="reveal" style={{ order: 1 }}>
            <div className="kicker">Trust &amp; transparency</div>
            <h2>Held to our own standard.</h2>
            <p className="big">
              We verify sovereignty for a living, so taking yours would be a contradiction. Six
              commitments, in writing, that you can hold us to.
            </p>
          </div>
          <div className="reveal card" style={{ order: 2 }}>
            <div className="sp-trust-list">
              <div className="sp-vow">
                <span className="sp-tick">✓</span>
                <span>
                  <b>Open source</b> — audit the rubric, validators, and code.
                </span>
              </div>
              <div className="sp-vow">
                <span className="sp-tick">✓</span>
                <span>
                  <b>Independent judging</b> — multiple judges, median score, open rubric.
                </span>
              </div>
              <div className="sp-vow">
                <span className="sp-tick">✓</span>
                <span>
                  <b>On-chain proof</b> — every attestation is anchored and checkable.
                </span>
              </div>
              <div className="sp-vow">
                <span className="sp-tick">✓</span>
                <span>
                  <b>Data covenant</b> — scoring only. Not resold. Not for training. Deletable.
                </span>
              </div>
              <div className="sp-vow">
                <span className="sp-tick">✓</span>
                <span>
                  <b>Private by default</b> — only hashes and attestations, never sold.
                </span>
              </div>
              <div className="sp-vow">
                <span className="sp-tick">✓</span>
                <span>
                  <b>No lock-in</b> — your cert is yours; export it, opt out, take it anywhere.
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
