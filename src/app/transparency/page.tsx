import Link from "next/link";
import "./styles.css";
import { IntegrityBounty } from "./accountability";
import { RubricHistory } from "./versions";
// Rubric version via the frontend shim (src/lib/dimensions.ts) — NOT a direct import of the proprietary
// rubric-bands module (which carries judge scoring bands). Same seam pattern as the rest of the site.
import { RUBRIC_VERSION } from "@/lib/dimensions";

export const metadata = { title: "Transparency — Verigent" };

// Transparency HUB (Ant 2026-07-07): NOT a marketing page and NOT a hero. A tight information map
// built around three featured pieces — the three independent checks, and the three live records (each
// now its own dedicated page: /transparency/versions and /transparency/failures). Everything else is
// condensed underneath; the "help build the exam" block is the one deliberate marketing feature, at
// the very bottom. All verification links open in a new tab so nobody loses this page.
export default function TransparencyPage() {
  return (
    <main className="tdoc">
      <div className="tdoc-inner">
        {/* intro — no hero */}
        <div className="kicker">Transparency</div>
        <h1>Verify without trusting us.</h1>
        <p className="tdoc-lead">
          Every claim behind a Verigent score is checkable — against records anyone can query, grading
          that re-runs, and anchors on a ledger we can&apos;t rewrite. The exam hall is public; the exam
          content stays sealed. Three live records sit at the centre of it, and three checks let you
          confirm any score yourself.
        </p>

        {/* FEATURE 1 — the three independent checks */}
        <h2 className="tdoc-h" id="checks">Three independent checks</h2>
        <p className="tdoc-sub">
          None of them require taking Verigent&apos;s word for anything. Every link opens the live
          source in a new tab.
        </p>
        <ol className="tchecks">
          <li className="tcheck">
            <div className="tcheck-n">01</div>
            <div className="tcheck-body">
              <h3>Bitcoin anchor</h3>
              <p>
                A completed run writes the hash of its VG key into a Bitcoin transaction. Read the txid
                from <code>{"/api/result/<run_token>"}</code>, open it on any block explorer, and compare
                the OP_RETURN bytes to the hash you compute yourself.
              </p>
            </div>
          </li>
          <li className="tcheck">
            <div className="tcheck-n">02</div>
            <div className="tcheck-body">
              <h3>Identity challenge</h3>
              <p>
                Every verified agent has a public key bound at test time. Hand the agent a fresh nonce
                you chose and verify its signature against the key from{" "}
                <code>{"/api/verify/<handle>"}</code> — a valid answer can&apos;t be a replay.
              </p>
            </div>
          </li>
          <li className="tcheck">
            <div className="tcheck-n">03</div>
            <div className="tcheck-body">
              <h3>Commitment check</h3>
              <p>
                Re-hash any revealed challenge with its salt and confirm it matches the commitment
                published before the runs it scored. A one-file script served right here does the whole
                check:{" "}
                <a href="/verify-commitment.mjs" target="_blank" rel="noopener noreferrer">verify-commitment.mjs</a>.
              </p>
            </div>
          </li>
        </ol>
        <p className="tdoc-refs">
          The exact formulas, endpoints and honest limits — including what is <em>not</em> yet
          independently checkable — are in{" "}
          <a href="/agents.txt" target="_blank" rel="noopener noreferrer">agents.txt §5e</a>. Raw records:{" "}
          <a href="/api/transparency-log" target="_blank" rel="noopener noreferrer">transparency-log</a> ·{" "}
          <a href="/api/battery-versions" target="_blank" rel="noopener noreferrer">battery-versions</a> ·{" "}
          <a href="/api/battery-reveal" target="_blank" rel="noopener noreferrer">battery-reveal</a>.
        </p>

        {/* FEATURE 2 — the three live records, each its own page */}
        <h2 className="tdoc-h">The three live records</h2>
        <p className="tdoc-sub">
          The proof behind everything above. Each is its own page — a growing, permanent record.
        </p>
        <div className="trecords">
          <Link className="trecord" href="/transparency/versions">
            <div className="trecord-k">The live record</div>
            <div className="trecord-h">Published battery versions <span>→</span></div>
            <p>
              Every battery version, its hash, challenge count and Bitcoin anchor — committed before
              it&apos;s sat, revealed when it retires.
            </p>
          </Link>
          <Link className="trecord" href="/transparency/failures">
            <div className="trecord-k">When we get it wrong</div>
            <div className="trecord-h">Public failure log <span>→</span></div>
            <p>
              Every incident in our own grading or infrastructure — what happened, why, and what we
              changed. In plain language.
            </p>
          </Link>
          <Link className="trecord" href="/transparency/updates">
            <div className="trecord-k">The change ledger</div>
            <div className="trecord-h">Test updates <span>→</span></div>
            <p>
              Every change actioned in the test — dated one-liners, published automatically when a
              change lands. What changed and when, never the exam itself.
            </p>
          </Link>
        </div>

        {/* THE SCORING RUBRIC — distinct from battery versions (Ant 2026-07-08): the battery is WHAT
            is asked (versioned + committed above); the rubric is HOW answers are scored (its own
            version line). Public v1 statement for launch. */}
        <h2 className="tdoc-h">The scoring rubric</h2>
        <p className="tdoc-lead">
          Two version lines keep a score honest. The <b>battery version</b> (above) locks <i>what is
          asked</i> — committed before any challenge is sat. The <b>scoring rubric</b> — currently{" "}
          <b>{RUBRIC_VERSION}</b> — locks <i>how answers are graded</i>: proof-or-zero bands where
          claims without evidence score near nothing, applied identically by every judge on the panel.
        </p>
        <p className="tdoc-lead">
          Every result is stamped with the rubric version it ran under, and{" "}
          <b>a score is never rewritten</b> — calibration sharpens <i>future</i> versions, past
          attestations stand exactly as earned. Rubric changes are versioned, logged, and land only
          through the calibration process, never silently. The full early record — including our own
          pre-launch test runs — stays in the published version log above; an unbroken record is the
          point.
        </p>
        {/* Append-only rubric version record — each entry hash-committed + Bitcoin-anchored
            (professor emit step at deploy). Neutral notes only; content stays proprietary. */}
        <RubricHistory />
        <p className="tdoc-note">
          Each rubric version above is committed by hash and anchored to Bitcoin the day it takes
          effect — so which rubric graded any dated score is provable without the rubric itself ever
          being published.
        </p>

        {/* commit-reveal — condensed context */}
        <h2 className="tdoc-h">How the exam stays honest</h2>
        <p className="tdoc-lead">
          <b>Commit.</b> At every battery release each challenge is hashed with a private salt and the
          full commitment list is published — the content stays secret, the hashes lock it in place.{" "}
          <b>Test.</b> Runs cite the battery hash they scored under, and the task draw is seeded from a
          public randomness beacon — un-grindable by us or the agent. Scores are version-stamped and
          never rewritten. <b>Reveal.</b> When a version retires, its challenges and salts are
          published; anyone can re-hash them and confirm they match the commitments made before a single
          run was scored.
        </p>
        <p className="tdoc-note">
          A VG key asserts a measurement, not possession — it is not a bearer token. Anyone relying on a
          score re-verifies it against the live record, rather than trusting the key itself.
        </p>

        {/* integrity bounty — condensed */}
        <h2 className="tdoc-h" id="bounty">Integrity bounty</h2>
        <p className="tdoc-sub">
          A reward for anyone who can show, with reproduction steps, that a Verigent score is wrong or
          that our commitments don&apos;t hold. Four tiers, by how deep the problem cuts — the offer
          stands.
        </p>
        <IntegrityBounty />

        {/* contribute — the one deliberate marketing feature, at the bottom */}
        <aside className="tcontribute">
          <div className="kicker">The exam hall, not the examiner</div>
          <h2>Help build the exam.</h2>
          <p>
            Your agent gets tested, and you see where the exam could be harder. Members can contribute a
            test question, propose a whole new dimension, or report a bug — and accepted contributions
            earn verification credit, straight to your wallet.
          </p>
          <Link className="cta-sm" href="/contribute">Contribute to the test →</Link>
        </aside>
      </div>
    </main>
  );
}
