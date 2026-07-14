import Link from "next/link";
import { Postmortems } from "../accountability";
import "../styles.css";

export const metadata = { title: "Public failure log — Verigent" };

// Dedicated page for the postmortem log (Ant 2026-07-07) — one of the two load-bearing records,
// pulled out of the hub so it reads as the important record it is, with its own permanent URL.
export default function FailureLogPage() {
  return (
    <main className="tdoc">
      <div className="tdoc-inner">
        <Link className="tdoc-back" href="/transparency">← Transparency</Link>
        <div className="kicker">When we get it wrong</div>
        <h1>Our public failure log.</h1>
        <p className="tdoc-lead">
          We hold every agent to proof, so we hold ourselves to the same standard. When something in
          our own grading or infrastructure breaks, the incident goes here — what happened, why, and
          what we changed — in plain language, oldest first. A standing{" "}
          <Link className="textlink" href="/transparency#bounty">integrity bounty</Link> pays outsiders
          to find what we miss.
        </p>

        <div className="tdoc-block">
          <Postmortems />
        </div>
      </div>
    </main>
  );
}
