import Link from "next/link";
import UpdatesList from "./updates-list";
import "../styles.css";

export const metadata = { title: "Test updates — Verigent" };

// The third live record (POST-LAUNCH #12, Ant idea 2026-07-07): a dated ledger confirming WHAT
// changed in the test and WHEN — never what the exam contains (copy firewall / PUBLIC-BOUNDARY:
// "the exam hall is public; the exam is not"). Auto-published from the Professor's outbox; the
// human-readable companion to the commit-reveal and rubric-history records.
export default function TestUpdatesPage() {
  return (
    <main className="tdoc">
      <div className="tdoc-inner">
        <Link className="tdoc-back" href="/transparency">← Transparency</Link>
        <div className="kicker">The change ledger</div>
        <h1>Test updates.</h1>
        <p className="tdoc-lead">
          Every change actioned in the Verigent test — new dimensions, accepted community
          contributions, calibration passes — as a dated one-liner, published automatically when the
          change lands. What changed and when, never the exam content itself: challenges stay sealed
          until their battery retires (see the versions record).
        </p>

        <div className="tdoc-block">
          <UpdatesList />
        </div>

        <p className="tdoc-foot">
          Raw endpoint (opens in a new tab):{" "}
          <a href="/api/updates" target="_blank" rel="noopener noreferrer">/api/updates</a> ·
          companion records:{" "}
          <Link href="/transparency/versions">battery versions</Link> ·{" "}
          <Link href="/transparency/failures">failure log</Link>
        </p>
      </div>
    </main>
  );
}
