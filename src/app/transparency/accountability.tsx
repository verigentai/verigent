import {
  BOUNTY_STATUS,
  BOUNTY_SITE_CREDIT_MONTHS,
  BOUNTY_MINOR_CREDIT_MONTHS,
  BOUNTY_MAJOR_CREDIT_MONTHS,
  BOUNTY_CRITICAL_CREDIT_MONTHS,
  BOUNTY_CASH_CAP_PCT_REVENUE,
  STANDARD_PRICE_CENTS,
} from "../../lib/doctrine";
import { POSTMORTEMS } from "./postmortems";

// Awards are denominated in months of continuous verification — they scale with the service's real
// value instead of promising fixed cash the early network can't stand behind. The $ figure is a
// derived equivalent at today's standard rate, never a hand-typed literal.
const monthsUsd = (months: number) => `≈ $${((months * STANDARD_PRICE_CENTS) / 100).toFixed(0)}`;
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-AU", { year: "numeric", month: "short", day: "numeric" });

const TIERS: { months: number; label: string; qualifies: string }[] = [
  {
    months: BOUNTY_SITE_CREDIT_MONTHS,
    label: "Site",
    qualifies: "A functional or display bug in the service — a broken flow, an endpoint error, wrong copy. Not a scoring issue.",
  },
  {
    months: BOUNTY_MINOR_CREDIT_MONTHS,
    label: "Minor",
    qualifies: "A reproducible defect that misstates a published score.",
  },
  {
    months: BOUNTY_MAJOR_CREDIT_MONTHS,
    label: "Major",
    qualifies: "A reproducible gaming vector — a way to inflate a score without the underlying capability.",
  },
  {
    months: BOUNTY_CRITICAL_CREDIT_MONTHS,
    label: "Critical",
    qualifies:
      "An integrity break — a reveal that fails its pre-commitment, or evidence a battery changed after it was committed.",
  },
];

const TERMS: string[] = [
  "First verifiable reporter wins.",
  "A working report includes reproduction steps.",
  "Report to verify@verigent.ai.",
  "Awards are paid in continuous-verification credit — they grow with the service, not with promises.",
  `Once the network is live, a cash equivalent may be offered — capped at ${BOUNTY_CASH_CAP_PCT_REVENUE}% of the prior 30 days' verification revenue or the claimed tier's credit value, whichever is lower. The cash side scales with real usage and never exceeds what the credit is worth.`,
  "Verigent operators and contractors are ineligible.",
  "Scope is Verigent's own scoring and commitments only. Testing third-party agents is out of scope and not authorised.",
];

export function Postmortems() {
  return (
    <div className="tpy-pm-list reveal">
      {POSTMORTEMS.map((p) => (
        <article className="card tpy-pm" key={p.date + p.title}>
          <div className="tpy-pm-date">{fmtDate(p.date)}</div>
          <h3 className="tpy-pm-title">{p.title}</h3>
          <dl className="tpy-pm-body">
            <dt>What happened</dt>
            <dd>{p.what_happened}</dd>
            <dt>Root cause</dt>
            <dd>{p.root_cause}</dd>
            <dt>Fix</dt>
            <dd>{p.fix}</dd>
            <dt>Lesson</dt>
            <dd>{p.lesson}</dd>
          </dl>
        </article>
      ))}
    </div>
  );
}

export function IntegrityBounty() {
  return (
    <>
      <div className="tpy-bounty-tiers reveal">
        {TIERS.map((t) => (
          <div className="card tpy-step tpy-bounty-tier" key={t.label}>
            <div className="tpy-bounty-amount">{t.months} month{t.months === 1 ? "" : "s"}</div>
            <div className="tpy-bounty-sub">of continuous verification · {monthsUsd(t.months)} at today&apos;s rate</div>
            <div className="tpy-step-n">{t.label}</div>
            <p>{t.qualifies}</p>
          </div>
        ))}
      </div>

      <div className="tpy-bounty-terms reveal">
        {BOUNTY_STATUS === "draft" && (
          <div className="tpy-bounty-badge">
            Terms in final review — amounts may be adjusted before the offer stands.
          </div>
        )}
        <ul>
          {TERMS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>
    </>
  );
}
