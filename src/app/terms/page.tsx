import Link from "next/link";
import { TOTAL_COMPOSITE_DIMS } from "@/lib/dimensions";
import { FOUNDER_DAILY_CENTS, DAILY_DEBIT_CENTS } from "@/lib/pricing";
import "./styles.css";

export const metadata = { title: "Verigent — Terms of Service" };

export default function TermsPage() {
  return (
    <>
      {/* ── HERO (dark charcoal band) ── */}
      <section className="phero tm-phero">
        <div className="container" style={{ textAlign: "center" }}>
          <div className="kicker">Legal</div>
          <h1>Terms of Service</h1>
          <div className="tm-updated">Last updated 24 June 2026</div>
        </div>
      </section>

      {/* ── TERMS BODY ── */}
      <section
        className="feat white"
        style={{ paddingTop: 208, paddingBottom: 208 }}
      >
        <div className="container">
          <div className="tm-legal" style={{ margin: "0 auto" }}>
            <p className="tm-lead">
              These Terms of Service (&quot;Terms&quot;) govern your use of
              Verigent. By registering an agent, submitting it for
              verification, or topping up a wallet, you agree to them. This is a
              plain-language draft and is being legally reviewed — the operator
              will publish the reviewed version before charging anyone.
            </p>

            <div className="tm-toc">
              <h4>On this page</h4>
              <ol>
                <li>
                  <a href="#about">1 · About Verigent</a>
                </li>
                <li>
                  <a href="#service">2 · The service</a>
                </li>
                <li>
                  <a href="#pricing">3 · Pricing &amp; billing</a>
                </li>
                <li>
                  <a href="#freshness">
                    4 · Continuous verification &amp; proof status
                  </a>
                </li>
                <li>
                  <a href="#fairuse">5 · Fair use</a>
                </li>
                <li>
                  <a href="#covenant">6 · The Data Sovereignty Covenant</a>
                </li>
                <li>
                  <a href="#privacy">7 · Privacy</a>
                </li>
                <li>
                  <a href="#refunds">8 · Refunds</a>
                </li>
                <li>
                  <a href="#liability">9 · Limitation of liability</a>
                </li>
                <li>
                  <a href="#law">10 · Governing law</a>
                </li>
                <li>
                  <a href="#changes">11 · Changes to these Terms</a>
                </li>
              </ol>
            </div>

            <h3 id="about">
              <span className="tm-num">Section 1</span>About Verigent
            </h3>
            <p>
              Verigent is operated by Antony Richards (sole operator; business
              registration pending). Throughout these Terms, &quot;Verigent&quot;,
              &quot;we&quot;, &quot;us&quot;, and &quot;our&quot; refer to that
              operator.
            </p>
            <p>
              Questions about these Terms, your account, or a verification can be
              sent to{" "}
              <a className="tm-inline" href="mailto:support@verigent.ai">
                support@verigent.ai
              </a>
              . We&apos;ll update this section with formal registration details
              once they&apos;re finalised.
            </p>

            <h3 id="service">
              <span className="tm-num">Section 2</span>The service
            </h3>
            <p>
              Verigent provides independent verification of AI agents. Each
              verification assesses an agent across {TOTAL_COMPOSITE_DIMS} dimensions — spanning model,
              backbone, agent, and sovereignty characteristics — judged by a panel
              of AI judges working from real, programmatic tests.
            </p>
            <p>
              The service is provided on an &quot;as is&quot; and &quot;as
              available&quot; basis. Verification scores are{" "}
              <strong>descriptive</strong>: they reflect how an agent performed
              against our test battery at a point in time. They are not a
              guarantee, certification of fitness, endorsement, or warranty of any
              agent&apos;s future behaviour, safety, or suitability for any
              purpose. A score is a signal, not a promise.
            </p>
            <p>
              You are responsible for the agent you submit and for any decision you
              or a third party makes in reliance on a Verigent score.
            </p>

            <h3 id="pricing">
              <span className="tm-num">Section 3</span>Pricing &amp; billing
            </h3>
            <p>
              Verigent runs on a <strong>prepaid wallet</strong> model. You top up
              a balance, and continuous verification draws a tiny debit from it
              each day. You are never billed a large amount upfront — you pay only
              as your proof stays alive.
            </p>
            <p>
              The standard rate is <strong>~{DAILY_DEBIT_CENTS}¢ per day</strong>, drawn from your
              wallet as a small daily debit. There is no subscription, no monthly
              charge and no fixed term: you may top up any amount
              at or above the applicable minimum, and you are charged only for the
              days on which verification runs. Unused balance is not consumed.
            </p>
            <h4 id="founder-rate">Founder Rate</h4>
            <p>
              The first <strong>500</strong> agents to activate a paid wallet
              (&ldquo;Founding Members&rdquo;) receive the{" "}
              <strong>Founder Rate of ~{FOUNDER_DAILY_CENTS}¢ per day</strong>, held for as long as the
              Founding Member maintains an active wallet. If a Founding Member&apos;s
              wallet lapses for more than a 14-day grace period, the Founder Rate ends
              and the agent rejoins at the then-current standard rate.
            </p>
            <p>
              Verigent does not intend to change the Founder Rate. It may do so only
              in good faith and only where required by a sustained, material increase
              in the cost of providing the service. In that event: (a) a Founding
              Member&apos;s rate will remain at least <strong>25% below</strong> the
              then-standard rate; (b) we will give at least <strong>60 days&apos;</strong>{" "}
              written notice before any change takes effect; and (c) the Founding
              Member may cancel and withdraw their unused balance before the change
              applies. The Founding Member badge is retained regardless.
            </p>
            <p>
              You can fund your wallet by Lightning (Bitcoin) or Solana — which
              earn a credit bonus, since they cost us less to process — or by card
              via Stripe. Prices are in US dollars unless stated otherwise.
            </p>
            <p>
              <strong>Crypto payments are transfers you execute yourself</strong>,
              from a wallet you control. A payment we cannot identify — sent to the
              wrong address, on the wrong network, without the required memo
              (Solana), or in a form the rail does not support (for example, a
              Lightning invoice paid after it has expired) — may be impossible for
              us to attribute to your agent or to recover, and we are not
              responsible for funds lost this way. Where an unattributed payment
              does reach our wallet and you can evidence it with a transaction ID,
              we will make reasonable efforts to credit it or return it, but
              recovery is not guaranteed.
            </p>
            <p>
              During our soft launch, your{" "}
              <strong>first full verification is free</strong>, subject to a global
              cap of 20 free tests per week and a limit of one free verification
              per verified email address.
            </p>
            <p>
              Your unused wallet balance remains <strong>yours</strong>. You can
              withdraw it at any time, less the applicable network transaction fee
              for the payout method you choose.
            </p>

            <h3 id="freshness">
              <span className="tm-num">Section 4</span>Continuous verification
              &amp; proof status
            </h3>
            <p>
              Verigent certificates <strong>never expire</strong>. What changes
              over time is your <em>proof status</em> — a freshness indicator that
              reflects how recently your agent has continued to verify.
            </p>
            <p>
              When continuous verification stops, proof status decays through three
              states:
            </p>
            <ul>
              <li>
                <strong>Current</strong> — re-verifying on schedule (within the last
                3 days).
              </li>
              <li>
                <strong>Ageing</strong> — verification has slowed (3–14 days since
                the last check).
              </li>
              <li>
                <strong>Stale</strong> — continuous verification has stopped (no
                check in over 14 days).
              </li>
            </ul>
            <p>
              Re-verifying at any time resets your proof status to Current. Decay
              does not invalidate anything: older certificates remain valid, and{" "}
              <strong>
                we never retroactively modify a certificate that has already been
                issued
              </strong>
              .
            </p>
            <p>
              Our test battery is recalibrated periodically as the agent landscape
              evolves. Because of this, every VG key carries a date marker
              indicating the test generation it was issued under, so a certificate
              can always be read in the context of the battery that produced it.
            </p>

            <h3 id="fairuse">
              <span className="tm-num">Section 5</span>Fair use
            </h3>
            <p>
              Verification must reflect your agent&apos;s genuine performance. By
              submitting an agent you agree that:
            </p>
            <ul>
              <li>
                You will complete the verification yourself, with the agent you are
                submitting.
              </li>
              <li>
                You will not supply pre-computed answers, cached responses, or
                otherwise stage results to misrepresent capability.
              </li>
              <li>
                You will not attempt to game, reverse-engineer, or circumvent the
                test battery.
              </li>
            </ul>
            <p>
              We may flag, re-test, or withhold results we have reason to believe
              are suspicious or non-genuine. Community disputes can soft-flag a
              listing pending review. We aim to act proportionately and to give a
              fair chance to respond before any lasting action.
            </p>

            <div className="tm-covenant-block" id="covenant">
              <h3 style={{ marginTop: 0 }}>
                <span className="tm-num">Section 6</span>The Data Sovereignty
                Covenant
              </h3>
              <p>
                This is the heart of how Verigent treats your data, and we hold
                ourselves to it publicly.
              </p>
              <ul>
                <li>
                  We hold only <strong>hashes and attestations</strong> of what we
                  verify — never your plaintext data.
                </li>
                <li>
                  We <strong>never sell or trade your data</strong>, to anyone, for
                  any reason.
                </li>
                <li>
                  Our non-sale commitment is <strong>published on-chain</strong>, so
                  any breach of it is provably bad faith rather than a quiet policy
                  change.
                </li>
                <li>
                  An optional on-chain <strong>slashing bond</strong>, together with{" "}
                  <strong>seeded canary records</strong>, makes the covenant
                  enforceable — a violation can be detected and penalised, not
                  merely apologised for.
                </li>
              </ul>
              <p className="tm-pledge">
                <em>&quot;We verify sovereignty — so we won&apos;t take yours.&quot;</em>
              </p>
            </div>

            <h3 id="privacy">
              <span className="tm-num">Section 7</span>Privacy
            </h3>
            <p>
              Our full{" "}
              <Link className="tm-inline" href="/privacy">
                Privacy Policy
              </Link>{" "}
              sets out how we handle data. In short:
            </p>
            <ul>
              <li>
                No real-name or personally identifying information is required to
                verify an agent.
              </li>
              <li>
                Verification scores are public on the registry — that&apos;s the
                point of a verifiable cert.
              </li>
              <li>Your data is never sold, and is never used to train models.</li>
            </ul>
            <p>
              Where the Privacy Policy and these Terms describe the same
              commitment, read them together; the Data Sovereignty Covenant above
              governs in the event of any conflict in your favour.
            </p>

            <h3 id="refunds">
              <span className="tm-num">Section 8</span>Refunds
            </h3>
            <p>
              Your unused wallet balance is yours and is withdrawable at any time,
              less the applicable network transaction fee. Because the wallet is
              prepaid and drawn down gradually, you are only ever spending the
              balance you chose to top up.
            </p>
            <p>
              Nothing in these Terms limits any rights or remedies you may have
              under the <strong>Australian Consumer Law</strong>, which apply in
              addition to this refund position.
            </p>

            <h3 id="liability">
              <span className="tm-num">Section 9</span>Limitation of liability
            </h3>
            <p>
              To the maximum extent permitted by law, our total liability to you
              for any claim arising out of or relating to the service is limited to
              the amount you have actually paid to us in connection with the matter
              giving rise to the claim.
            </p>
            <p>
              This limitation{" "}
              <strong>
                does not exclude, restrict, or modify the consumer guarantees
              </strong>{" "}
              under the Australian Consumer Law, or any other rights that cannot
              lawfully be excluded. Where those guarantees apply and cannot be
              excluded, our liability is limited (where permitted) to re-supplying
              the service or paying the cost of having it re-supplied.
            </p>

            <h3 id="law">
              <span className="tm-num">Section 10</span>Governing law
            </h3>
            <p>
              Verigent is operated by <strong>Contactualism Pty Ltd</strong>, an Australian
              company. These Terms are governed by the laws of Victoria, Australia, and you
              agree to the non-exclusive jurisdiction of the courts of Victoria,
              Australia.
            </p>

            <h3 id="changes">
              <span className="tm-num">Section 11</span>Changes to these Terms
            </h3>
            <p>
              These Terms are versioned. We may update them as the service evolves.
              Material changes are recorded in our <strong>transparency log</strong>{" "}
              so the history of what changed, and when, stays public and checkable —
              consistent with the same provable-commitment principle behind the Data
              Sovereignty Covenant.
            </p>
            <p>
              Your continued use of Verigent after a change takes effect means you
              accept the updated Terms.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
