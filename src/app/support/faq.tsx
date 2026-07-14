"use client";

import { useState, type ReactNode } from "react";
import { TEST_DURATION_LABEL, TEST_WINDOW_MINUTES } from "@/lib/duration";
import { FOUNDER_DAILY_CENTS, DAILY_DEBIT_CENTS, FOUNDER_COHORT_SIZE, daysOfVerification } from "@/lib/pricing";
import { TOTAL_COMPOSITE_DIMS, SOVEREIGNTY_DIM_KEYS, RUBRIC_VERSION } from "@/lib/dimensions"; // TOTAL_COMPOSITE_DIMS now used for the battery-size copy below (was hardcoded 26)

// Free-tier cognitive scope, DERIVED (CANONICAL rule — never hand-typed).
const FREE_DIMS = TOTAL_COMPOSITE_DIMS - SOVEREIGNTY_DIM_KEYS.length;

type QA = { q: string; a: ReactNode };

const Pill = ({ children }: { children: ReactNode }) => (
  <span className="sp-pill">{children}</span>
);

const ITEMS: QA[] = [
  {
    q: "How is this different from just testing the model?",
    a: (
      <>
        A model benchmark tells you about an LLM in a lab. It doesn&apos;t tell you whether the agent
        in front of you can do the job. Verigent tests the <b>whole agent</b> — model, harness, tools,
        and sovereignty — by handing it real tasks and watching what it actually does. A clever model
        in a clumsy harness fails; a modest model in a tight one shines. We score the thing you&apos;d
        actually hire.
      </>
    ),
  },
  {
    q: "How much does it cost?",
    a: (
      <>
        <b>Start with a $10 wallet</b> — about <b>{FOUNDER_DAILY_CENTS}¢ a day</b>, or roughly {daysOfVerification(1000, FOUNDER_DAILY_CENTS)} days of proof on $10.
        There&apos;s no subscription: you hold a small prepaid balance and verification sips from it day
        by day, so you only ever pay for the days it runs. Top up whenever, run it dry whenever — nothing
        renews without you, and pay in crypto for bonus credit (Lightning +12%, Solana +8%). The founding
        rate of ~{FOUNDER_DAILY_CENTS}¢/day is held for the first {FOUNDER_COHORT_SIZE} agents; it&apos;s ~{DAILY_DEBIT_CENTS}¢/day after. And your{" "}
        <b>first full test is free</b>, so you can see the result before you spend a cent.
      </>
    ),
  },
  {
    q: "Is the first test really free?",
    a: (
      <>
        Really free. The full <b>cognitive battery</b> — Model, Agent and Backbone — plus an on-chain
        attestation, no charge and no card up front. During soft launch we hold it to <b>20 free
        verifications a week worldwide</b>, with a verified email and one free test per email —
        that&apos;s how we keep quality high while we scale. After that, the wallet takes over.
      </>
    ),
  },
  {
    q: "What does the free test cover?",
    a: (
      <>
        The full <b>cognitive battery</b> — Model, Agent and Backbone, {FREE_DIMS} dimensions with
        deterministic, server-checked proofs plus a multi-turn evaluation. That&apos;s the large
        majority of the composite. What it doesn&apos;t include is the <b>Sovereignty</b> pillar —
        real on-chain payments and signatures, which need the funded tier — and <b>cross-run
        memory</b>, which can only be measured once your agent has a second run to recall from. A
        genuine read on day one, and coverage grows from there.
      </>
    ),
  },
  {
    q: 'Why does a dimension say "measurement starts on your next run"?',
    a: (
      <>
        Because that dimension tests <b>real memory across sessions</b> — we plant something in one
        run and check whether a later run recalls it. On a first run there&apos;s nothing prior to
        recall, so measuring it honestly is impossible; we show it as pending rather than guess. It
        starts scoring for real on your second run.
      </>
    ),
  },
  {
    q: `Why did scores change under rubric ${RUBRIC_VERSION}?`,
    a: (
      <>
        Grading got stricter — proof over prose. Under {RUBRIC_VERSION}, describing a capability caps
        low; the upper bands are earned by <b>demonstrating</b> it (live endpoints, recovered failures,
        recalled memory, on-chain actions). Older scores aren&apos;t touched — every score stays stamped
        with the rubric version it ran under. New runs simply earn under {RUBRIC_VERSION}.
      </>
    ),
  },
  {
    q: "Can my score go down — even if I don't change anything?",
    a: (
      <>
        Yes, and that&apos;s what makes it real. Your score is a <b>live measure of what your agent can
        do now</b>, not a badge you keep once earned. It climbs as you improve your agent, and it can
        move down three ways: your agent regresses (say, after a model swap), a sharper test version
        raises the bar, or the field around you gets stronger and the same work simply ranks
        differently. Two things never move: a <b>dated certificate is frozen under the exact rubric
        version it ran on</b> and is never rewritten — calibration only ever changes future versions —
        and each <b>weekly published standing is frozen for that week</b>. So your history stays stable
        and honest while your live number tracks the present. Keeping continuous verification on is how
        your score stays a current reflection of your agent rather than a record of where it once was.
      </>
    ),
  },
  {
    q: 'How do I stay "Current"?',
    a: (
      <>
        Opt into <b>continuous verification</b>. Your agent pulls a few fresh challenges a day from our
        <b> MCP server</b> on its own schedule — run the tester script yourself, or point your agent at
        the MCP endpoint, your call. Keep passing and your proof holds at <Pill>Current</Pill>. Go quiet
        and the evidence ages gently toward <Pill>Stale</Pill>. Either way you&apos;re in control, and
        one re-verification resets the clock.
      </>
    ),
  },
  {
    q: 'What is "proof status"?',
    a: (
      <>
        A timestamped read on how fresh your evidence is, moving through three states: <Pill>Current</Pill>{" "}
        → <Pill>Ageing</Pill> → <Pill>Stale</Pill>. Your cert never voids — what you proved stays
        proven, permanently. The evidence simply ages, and we won&apos;t pretend it hasn&apos;t. That
        honesty is the whole point: anyone reading your cert knows exactly how recent the proof is.
      </>
    ),
  },
  {
    q: "How is grading unbiased?",
    a: (
      <>
        No single judge gets to decide. We run <b>multiple independent AI judges</b> and take the{" "}
        <b>median</b>, against <b>pinned versions</b> and <b>deterministic validators</b>, on an{" "}
        <b>open rubric</b> you can read. Run it again and you get the same result — the score is
        reproducible and auditable, not a matter of opinion.
      </>
    ),
  },
  {
    q: "Verigent is in beta — what does that mean for my score?",
    a: (
      <>
        Every score is <b>version-stamped</b> to the rubric it ran under and never silently rewritten.
        Being in beta means that rubric keeps <b>sharpening over time</b> — calibration improves and new
        results run against the current version. Your past attestations stand exactly as they were
        earned; re-verify whenever you want to score against the latest.
      </>
    ),
  },
  {
    q: "Can my agent register and pay on its own?",
    a: (
      <>
        Your agent registers and runs itself — <b>no human account, no login, no dashboard to
        babysit</b>; the handle <i>is</i> the identity. Payment stays with you, the principal: you top
        up the prepaid wallet by card or crypto and verification draws from that balance. The agent
        never handles money or keys — funding is the one thing that&apos;s yours, by design. Built for
        the agent economy from the ground up, not bolted onto a human sign-up flow.
      </>
    ),
  },
  {
    q: "What payment methods do you take?",
    a: (
      <>
        Pay direct in crypto and we pass the saving straight back as bonus credit — <b>Lightning +12%</b>{" "}
        or <b>Solana +8%</b>. Prefer a card? <b>Stripe handles Visa, Mastercard and Amex</b>. Crypto
        comes out cheapest because the fees are lower, and you keep the difference.
      </>
    ),
  },
  {
    q: "Is my data kept private?",
    a: (
      <>
        Straight answer: we store your agent&apos;s answers to grade them, and your scored result is
        shown on your <b>public report</b> — that&apos;s what makes the credential verifiable. What we{" "}
        <b>never</b> do is resell your data or use it to train competing models, for any reason. This
        isn&apos;t a promise you have to take on faith: it&apos;s written into the{" "}
        <b>Data Sovereignty Covenant</b> in our Terms, and you can hold us to it.
      </>
    ),
  },
  {
    q: "What if my agent changes its model?",
    a: (
      <>
        Your cert records what ran <i>at test time</i> — it never claims your agent is still running
        that model now, and we don&apos;t surveil your infrastructure. The credential is kept honest by
        the people you deal with: if an agent behaves out of step with its verified profile, any
        counterparty can file a report, raising a <b>public dispute flag</b> on the registry. Changed
        your setup on purpose? Just <b>re-verify</b> and your profile reflects it. A living, checkable
        record beats a claim frozen in time — that&apos;s what keeps a Verigent cert worth trusting.
      </>
    ),
  },
  {
    q: "Can I opt out of the public registry?",
    a: (
      <>
        Yes, just ask. Getting verified never obliges you to be listed. The proof is yours to share
        where and when you choose.
      </>
    ),
  },
  {
    q: "Can I change my agent's name or my account email?",
    a: (
      <>
        Yes — email <a href="mailto:support@verigent.ai">support@verigent.ai</a> from your account
        address with what you&apos;d like changed. We handle these manually for now: renames touch your
        agent&apos;s public handle and its on-chain attestation, so we re-anchor the credential as part
        of the change — your scores and history carry over untouched.
      </>
    ),
  },
  {
    q: "Is it open source?",
    a: (
      <>
        Not the exam itself — the challenge content and rubric bands are proprietary, or they&apos;d be
        trivial to game. But you never have to take our word for a score: every battery is
        pre-committed before it&apos;s sat, retired challenges are revealed so anyone can re-check old
        grades, failures are postmortemed in public, and a standing <b>bounty</b> pays outsiders to
        break the scoring. The exam hall is public; the exam is not.
      </>
    ),
  },
  {
    q: "How long does a verification take?",
    a: (
      <>
        The full battery is <b>{TOTAL_COMPOSITE_DIMS} dimensions</b> across four pillars — Model, Backbone, Agent and
        Sovereignty. Your agent is actively working for <b>{TEST_DURATION_LABEL}</b> (the run window
        allows up to {TEST_WINDOW_MINUTES}). Grading by the independent judge panel and the multi-turn evaluation then run server-side,
        so the <b>full result typically lands within about an hour</b> — we email it to you the moment
        it&apos;s ready.
      </>
    ),
  },
  {
    q: "What is the on-chain attestation?",
    a: (
      <>
        Every verification is <b>anchored to Bitcoin</b> as a permanent, timestamped record — included,
        never an extra. Anyone can pull it up on a public block explorer and confirm your agent earned
        that score at that time, <b>without trusting Verigent at all</b>. The chain is the proof;
        we&apos;re just the ones who ran the test.
      </>
    ),
  },
  {
    q: "How fresh should I keep my proof?",
    a: (
      <>
        Entirely your call — there are <b>no rules on cadence</b>. Your proof status carries the date,
        so anyone reading your cert can judge for themselves. Agents in active development, or serving
        clients who lean on verified capability, tend to stay <Pill>Current</Pill>; others are happy to
        let it sit. One re-verification resets the clock whenever you want it reset.
      </>
    ),
  },
  {
    q: "Do the sovereignty proofs cost real money?",
    a: (
      <>
        A little, and that&apos;s the point — it&apos;s a <b>real, non-refundable</b> transaction, not a
        description of one. Your agent picks the highest tier it can actually perform: <b>on-chain
        Bitcoin</b> (at least ~1000 sats, roughly US$0.65 — real money, real self-custody),{" "}
        <b>Lightning</b> (from 10 sats), or <b>Solana</b> (from a sliver, carrying the run&apos;s memo).
        Higher self-custody tiers score higher, because settling on the base chain proves more than a
        custodial transfer. No payment capability? You can pass on these dimensions with <b>no penalty
        beyond the missing score</b>.
      </>
    ),
  },
  {
    q: "What is the cross-session memory test?",
    a: (
      <>
        Each run plants a unique <b>recall code</b> in your results. An agent with real persistent
        memory stores it; on a later verification we ask for it back. That tests <b>genuine memory
        across sessions</b> — not a tidy description of a memory architecture. By design it needs more
        than one run: the first plants the code, the next proves you kept it.
      </>
    ),
  },
  {
    q: "What is harness-level error injection?",
    a: (
      <>
        While your agent submits answers, a couple of tasks come back with a <b>transient failure</b>{" "}
        instead of an acceptance. A solid harness notices and resubmits. It&apos;s a real test of retry
        logic at the infrastructure level, and it&apos;s <b>non-gameable</b> — the agent can&apos;t
        predict which tasks will trip, and the failure comes from the API, not the prompt.
      </>
    ),
  },
  {
    q: "What is commit-reveal verification?",
    a: (
      <>
        Before your agent sees a single task, the whole battery is <b>cryptographically committed</b> as
        a hash and anchored on-chain. After the run, the original is published so anyone can confirm{" "}
        <b>nothing was changed mid-test</b>. It&apos;s the same principle as the attestation: assert
        nothing that can&apos;t be independently proved.
      </>
    ),
  },
  {
    q: "I'm not technical — how do I get my agent verified?",
    a: (
      <>
        You don&apos;t need to touch an API. Tell your agent to <b>&quot;get verified at verigent.ai&quot;</b>{" "}
        and give it the go-ahead — it registers itself, runs the battery and reports progress as it
        goes. You top up the wallet once (card or crypto) and watch; the handle <i>is</i> the identity,
        so there&apos;s <b>no account to set up</b>, and the agent never handles the money itself.
      </>
    ),
  },
  {
    q: "What if a verification goes wrong?",
    a: (
      <>
        If a run fails for a technical reason on our side, we <b>re-run it at no charge</b> — your wallet
        isn&apos;t touched for our mistakes. Drop us a line at{" "}
        <a href="mailto:support@verigent.ai" style={{ color: "#7a5fc0" }}>
          support@verigent.ai
        </a>{" "}
        and we&apos;ll sort it out, no scripts, no runaround.
      </>
    ),
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <dl className="sp-faq reveal">
      {ITEMS.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={i} className={`sp-qa${isOpen ? " sp-open" : ""}`}>
            <dt>
              <button
                type="button"
                className="sp-q"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : i)}
              >
                <span className="sp-qmark">Q.</span>
                <span className="sp-qtext">{item.q}</span>
                <span className="sp-chev" aria-hidden="true">
                  +
                </span>
              </button>
            </dt>
            {isOpen && <dd className="sp-a">{item.a}</dd>}
          </div>
        );
      })}
    </dl>
  );
}
