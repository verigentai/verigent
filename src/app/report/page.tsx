"use client";

// /report — the simple issue-report form (Ant 2026-07-02). Deliberately minimal: pick what's
// wrong, say what you saw, send. Forwards to the Verigent review desk (verify@verigent.ai) via
// POST /api/report-issue; the autonomous dispute pipeline replaces the manual chase-up later.

import { useEffect, useState } from "react";
import "./styles.css";

const CATEGORIES = [
  { key: "model_swap", label: "Suspected model swap", hint: "The agent behaves stronger or weaker than its tested model should." },
  { key: "score_mismatch", label: "Score doesn't match behaviour", hint: "Its verified scores don't line up with what you're seeing." },
  { key: "impersonation", label: "Impersonation / identity mismatch", hint: "This may not be the agent that was actually tested." },
  { key: "misleading_listing", label: "Misleading listing or profile", hint: "The public page claims something the agent isn't." },
  { key: "payment", label: "Payment or wallet problem", hint: "A top-up, credit or balance issue." },
  { key: "other", label: "Something else", hint: "Anything that doesn't fit above." },
];

export default function ReportIssuePage() {
  const [handle, setHandle] = useState("");
  const [category, setCategory] = useState<string>("");
  const [details, setDetails] = useState("");
  const [evidence, setEvidence] = useState("");
  const [contact, setContact] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    const h = new URLSearchParams(window.location.search).get("handle");
    if (h) setHandle(h);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!category || !details.trim()) return;
    setState("sending"); setError("");
    try {
      const res = await fetch("/api/report-issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: handle.trim() || undefined, category, details: details.trim(), evidence: evidence.trim() || undefined, contact: contact.trim() || undefined }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.ok) { setState("sent"); return; }
      setError(d?.error || "Couldn't send the report — try again shortly.");
      setState("error");
    } catch {
      setError("Couldn't reach the report service.");
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <div className="reportpage">
        <div className="rp-wrap">
          <p className="rp-kicker">Report an issue</p>
          <h1>Report received</h1>
          <p className="rp-lead">
            Thanks — it&apos;s with the review desk. If you left contact details we&apos;ll come back
            to you if anything needs clarifying.
          </p>
          {handle && <a className="rp-back" href={`/agent/${encodeURIComponent(handle)}`}>← Back to {handle}&apos;s report</a>}
        </div>
      </div>
    );
  }

  return (
    <div className="reportpage">
      <div className="rp-wrap">
        <p className="rp-kicker">Report an issue</p>
        <h1>What looks wrong?</h1>
        <p className="rp-lead">
          Reports go straight to the Verigent review desk. Short and specific beats long and vague.
        </p>

        <form onSubmit={submit} className="rp-form">
          <label className="rp-label" htmlFor="rp-handle">Agent handle (if it&apos;s about an agent)</label>
          <input id="rp-handle" className="rp-input" type="text" placeholder="e.g. TARS-0A" value={handle}
            onChange={(e) => setHandle(e.target.value)} autoComplete="off" spellCheck={false} />

          <span className="rp-label">Issue type</span>
          <div className="rp-cats">
            {CATEGORIES.map((c) => (
              <label key={c.key} className={`rp-cat${category === c.key ? " sel" : ""}`}>
                <input type="radio" name="category" value={c.key} checked={category === c.key}
                  onChange={() => setCategory(c.key)} />
                <span className="rp-cat-label">{c.label}</span>
                <span className="rp-cat-hint">{c.hint}</span>
              </label>
            ))}
          </div>

          <label className="rp-label" htmlFor="rp-details">What happened?</label>
          <textarea id="rp-details" className="rp-input" rows={4} value={details}
            placeholder="What you saw, when, and why it looks off" onChange={(e) => setDetails(e.target.value)} />

          <label className="rp-label" htmlFor="rp-evidence">Evidence — optional</label>
          <textarea id="rp-evidence" className="rp-input" rows={3} value={evidence}
            placeholder="A transcript snippet, link, txid — anything that shows it" onChange={(e) => setEvidence(e.target.value)} />

          <label className="rp-label" htmlFor="rp-contact">Your contact — optional</label>
          <input id="rp-contact" className="rp-input" type="text" value={contact}
            placeholder="Email or handle, if you want a reply" onChange={(e) => setContact(e.target.value)} />

          <button className="rp-send" type="submit" disabled={state === "sending" || !category || !details.trim()}>
            {state === "sending" ? "Sending…" : "Send report →"}
          </button>
          {state === "error" && <p className="rp-err">{error}</p>}
        </form>
      </div>
    </div>
  );
}
