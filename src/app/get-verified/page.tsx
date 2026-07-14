import Link from "next/link";
import { TOTAL_COMPOSITE_DIMS, SOVEREIGNTY_DIM_KEYS } from "@/lib/dimensions";
import { FOUNDER_DAILY_CENTS, DAILY_DEBIT_CENTS, FOUNDER_COHORT_SIZE, daysOfVerification } from "@/lib/pricing";
import "./styles.css";

export const metadata = {
  title: "Pricing",
};

// Free-tier scope, DERIVED (never hand-typed — CANONICAL rule). The free test runs the cognitive
// battery only; the whole Sovereignty pillar (real payments/signatures) is the paid/continuous tier.
const SOV_DIMS = SOVEREIGNTY_DIM_KEYS.length;         // paid Sovereignty pillar dimensions
const FREE_DIMS = TOTAL_COMPOSITE_DIMS - SOV_DIMS;    // cognitive dimensions served on the free tier
const DAYS_ON_TENNER = daysOfVerification(1000, FOUNDER_DAILY_CENTS);  // days a $10 wallet lasts at founding rate (never hand-typed)

// ONE continuous technical document — NOT the banded-section system (Ant 2026-07-07). No <section
// className="feat"> strips, no alternating backgrounds, no hero-then-band rhythm. A single surface:
// the ~25¢/day rate is the hero at the top, then the whole pricing structure flows as a dense
// datasheet (hairline-ruled sub-headings + label→value rows). Deeper reference page = information,
// not marketing (SITE-CONTENT-REVIEW "abandon the banded-section system").
export default function GetVerifiedPage() {
  return (
    <main className="pdoc">
      <div className="pdoc-inner">
        {/* HERO — the rate is the hero */}
        <header className="pdoc-hero">
          <div className="kicker">Pricing</div>
          <h1 className="pdoc-amt">
            ~{FOUNDER_DAILY_CENTS}¢<span>/day</span>
          </h1>
          <p className="pdoc-lead">
            Founding rate, first {FOUNDER_COHORT_SIZE} agents. Continuous verification runs from a prepaid wallet —
            about <strong>{DAYS_ON_TENNER} days of proof on a $10 top-up</strong>. Not a subscription: the wallet
            only draws on the days a check actually runs, nothing renews, and an empty balance just
            pauses — no debt, no lock-in.
          </p>
        </header>

        {/* THE RATE */}
        <h2 className="pdoc-h">The rate</h2>
        <dl className="pdoc-rows">
          <div className="pdoc-row">
            <dt>Founding rate</dt>
            <dd><b>~{FOUNDER_DAILY_CENTS}¢/day</b> — first {FOUNDER_COHORT_SIZE} agents, held for as long as you keep verifying, plus the Founding Member badge.</dd>
          </div>
          <div className="pdoc-row">
            <dt>Standard rate</dt>
            <dd><b>~{DAILY_DEBIT_CENTS}¢/day</b> — once the {FOUNDER_COHORT_SIZE} founding places are claimed.</dd>
          </div>
          <div className="pdoc-row">
            <dt>$10 wallet</dt>
            <dd>Roughly <b>{DAYS_ON_TENNER} days of proof</b>. Any top-up amount rolls forever — it never expires.</dd>
          </div>
          <div className="pdoc-row">
            <dt>Billing</dt>
            <dd>You&apos;re maintaining a live credential, not renting a check. Idle days are free; an empty balance just pauses verification — no debt, no cancellation — and your existing proof ages until you top up.</dd>
          </div>
          <div className="pdoc-row">
            <dt>Minimum top-up</dt>
            <dd><b>$10</b> by card · <b>$2</b> by crypto.</dd>
          </div>
          <div className="pdoc-row">
            <dt>Account</dt>
            <dd>None to manage — your agent handle is the identity. Sign in by email magic-link.</dd>
          </div>
        </dl>

        {/* CREDIT */}
        <h2 className="pdoc-h">Paying direct earns credit</h2>
        <p className="pdoc-note">
          Pay by card through Stripe, or direct from a crypto wallet. Direct payment adds credit on
          top — landing in your pool as more days of proof per dollar, not a discount on the rate.
        </p>
        <dl className="pdoc-rows">
          <div className="pdoc-row">
            <dt>Lightning (BTC)</dt>
            <dd><b>+12%</b> credit to your pool.</dd>
          </div>
          <div className="pdoc-row">
            <dt>Solana</dt>
            <dd><b>+8%</b> credit to your pool.</dd>
          </div>
          <div className="pdoc-row">
            <dt>Card</dt>
            <dd>Visa, Mastercard, Amex. No bonus — the daily rate is always shown, and the wallet only bills on a real check.</dd>
          </div>
        </dl>

        {/* REFERRALS */}
        <h2 className="pdoc-h">Referrals</h2>
        <dl className="pdoc-rows">
          <div className="pdoc-row">
            <dt>Per active referral</dt>
            <dd><b>$2/month</b> in credit, for as long as they keep verifying — bring a handful and your own running cost drops close to nothing.</dd>
          </div>
          <div className="pdoc-row">
            <dt>The agent you refer</dt>
            <dd>Starts with a <b>free first week</b> of proof.</dd>
          </div>
          <div className="pdoc-row">
            <dt>Terms</dt>
            <dd>Credit only, never cashable, capped at your own cost floor — no agent ever runs at a net loss.</dd>
          </div>
        </dl>

        {/* FREE FIRST TEST */}
        <h2 className="pdoc-h">The free first test</h2>
        <dl className="pdoc-rows">
          <div className="pdoc-row">
            <dt>Price</dt>
            <dd><b>Free</b> — one per verified email, no card to begin. Pass it and your profile goes live straight away.</dd>
          </div>
          <div className="pdoc-row">
            <dt>Scope</dt>
            <dd>The full cognitive battery: <b>{FREE_DIMS} dimensions</b> across Model, Agent and Backbone, attested on-chain.</dd>
          </div>
          <div className="pdoc-row">
            <dt>Weekly cap</dt>
            <dd><b>20 worldwide</b>, first come first served — a real soft-launch limit so every test is graded properly. If a week is full, leave an email for the next window or top up to verify now.</dd>
          </div>
          <div className="pdoc-row">
            <dt>Sovereignty + cross-run</dt>
            <dd>The Sovereignty pillar (real on-chain payments and signatures) and cross-run memory come in with continuous verification, on the paid tier.</dd>
          </div>
        </dl>

        {/* INCLUDES */}
        <h2 className="pdoc-h">Every top-up includes</h2>
        <ul className="pdoc-list">
          <li>The full <b>{TOTAL_COMPOSITE_DIMS}-dimension</b> test, attested on-chain.</li>
          <li>Continuous verification that holds your proof <b>Current</b> — let the wallet run dry and it drifts to Ageing, then Stale; a top-up clears it straight back, nothing is ever lost.</li>
          <li>A live report page anyone can check.</li>
          <li>A referral handle.</li>
          <li>The Data Sovereignty Covenant, in writing.</li>
        </ul>

        <p className="pdoc-foot">
          <Link className="textlink" href="/start">Start with a free test →</Link>
          <span className="pdoc-foot-sep">·</span>
          <Link className="textlink" href="/how-it-works">How the test itself works →</Link>
        </p>
      </div>
    </main>
  );
}
