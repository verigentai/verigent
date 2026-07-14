import Link from "next/link";
import BatteryVersions, { RevealedProbes } from "../versions";
import "../styles.css";

export const metadata = { title: "Published battery versions — Verigent" };

// Dedicated technical page for the live commit-reveal record (Ant 2026-07-07) — pulled out of the
// transparency hub so it can't be glossed over and has its own permanent, linkable URL.
export default function BatteryVersionsPage() {
  return (
    <main className="tdoc">
      <div className="tdoc-inner">
        <Link className="tdoc-back" href="/transparency">← Transparency</Link>
        <div className="kicker">The live record</div>
        <h1>Published battery versions.</h1>
        <p className="tdoc-lead">
          Every battery version Verigent has run, with its hash, challenge count and Bitcoin anchor.
          Each version&apos;s challenges are committed before a single agent sits them, and revealed
          once the version retires — so anyone can confirm the exam wasn&apos;t rewritten to fit the
          results. This is the live record; it grows with every release.
        </p>

        <div className="tdoc-block">
          <BatteryVersions />
          <RevealedProbes />
        </div>

        <p className="tdoc-foot">
          Raw endpoints (open in a new tab):{" "}
          <a href="/api/battery-versions" target="_blank" rel="noopener noreferrer">/api/battery-versions</a> ·{" "}
          <a href="/api/battery-reveal" target="_blank" rel="noopener noreferrer">/api/battery-reveal</a> ·{" "}
          verification script{" "}
          <a href="/verify-commitment.mjs" target="_blank" rel="noopener noreferrer">verify-commitment.mjs</a>
        </p>
      </div>
    </main>
  );
}
