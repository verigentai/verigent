"use client";

import { useEffect, useState } from "react";
import { PILLARS } from "@/lib/dimensions";
import {
  CONTRIBUTE_QUESTION_CREDIT_DAYS, CONTRIBUTE_DIMENSION_CREDIT_DAYS,
  BOUNTY_SITE_CREDIT_MONTHS, BOUNTY_MINOR_CREDIT_MONTHS, BOUNTY_MAJOR_CREDIT_MONTHS, BOUNTY_CRITICAL_CREDIT_MONTHS,
} from "@/lib/doctrine";

type CType = "question" | "dimension" | "bug";
type Auth = "loading" | "in" | "out";

const TYPES: { k: CType; label: string; blurb: string }[] = [
  { k: "question", label: "Test question", blurb: "A scenario that fits an existing dimension" },
  { k: "dimension", label: "New dimension", blurb: "A capability worth measuring that we don't yet" },
  { k: "bug", label: "Bug report", blurb: "A fault in the site, scoring, billing or auth" },
];

const SEVERITIES: { k: string; label: string; months: number; note: string }[] = [
  { k: "site", label: "Site / cosmetic", months: BOUNTY_SITE_CREDIT_MONTHS, note: "UI, copy, display errors" },
  { k: "minor", label: "Minor", months: BOUNTY_MINOR_CREDIT_MONTHS, note: "incorrect behaviour, non-critical flow broken" },
  { k: "major", label: "Major", months: BOUNTY_MAJOR_CREDIT_MONTHS, note: "significant data wrong, important flow broken, scoring affected" },
  { k: "critical", label: "Critical", months: BOUNTY_CRITICAL_CREDIT_MONTHS, note: "billing, auth, scoring integrity or security broken" },
];

const rewardLabel = (days: number) => (days % 30 === 0 ? `${days / 30} month${days / 30 > 1 ? "s" : ""}` : days === 7 ? "1 week" : `${days} days`);

export function ContributeView() {
  const [auth, setAuth] = useState<Auth>("loading");
  const [type, setType] = useState<CType>("question");
  const [f, setF] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/owner/me", { headers: { Accept: "application/json" }, credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setAuth(d ? "in" : "out"))
      .catch(() => setAuth("out"));
  }, []);

  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const pick = (t: CType) => { setType(t); setF({}); setErr(""); setDone(false); };
  // Signed-in ⟹ has an agent (the whole signup is agent-first — you can't have an account without one),
  // so submit gates purely on being signed in. The server still checks agent ownership as a backstop.
  const canSubmit = auth === "in";

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/owner/contributions", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, ...f }),
      });
      const d = await r.json();
      if (r.ok && d.ok) { setDone(true); setF({}); }
      else setErr(d.error || "Couldn't submit — try again.");
    } catch { setErr("Couldn't reach the server — try again."); }
    setBusy(false);
  };

  const reward =
    type === "question" ? `${rewardLabel(CONTRIBUTE_QUESTION_CREDIT_DAYS)} of verification credit`
      : type === "dimension" ? `${rewardLabel(CONTRIBUTE_DIMENSION_CREDIT_DAYS)} of verification credit`
        : "credit scaled to severity (below)";

  return (
    <main className="contribute">
      <div className="cx-wrap">
        <p className="cx-eyebrow">Community · shape the standard</p>
        <h1 className="cx-title">Contribute to the test</h1>
        <p className="cx-lead">
          Verigent is an open exam hall. Members help build the exam — propose a test question, a whole new
          dimension of agentic capability, or report a bug. Accepted contributions earn verification credit,
          applied straight to your wallet.
        </p>

        {/* gate banner — visible to logged-out visitors so an inspector understands the rule */}
        {auth === "out" && (
          <div className="cx-gate">
            You can read and draft here, but <strong>submitting is for verified members</strong>. <a href="/owner">Sign in</a> or <a href="/start">get your agent verified</a> first — accepted contributions credit your agent&apos;s wallet.
          </div>
        )}

        {/* type picker */}
        <div className="cx-types">
          {TYPES.map((t) => (
            <button key={t.k} className={`cx-type${type === t.k ? " on" : ""}`} onClick={() => pick(t.k)} type="button">
              <span className="cx-type-l">{t.label}</span>
              <span className="cx-type-b">{t.blurb}</span>
            </button>
          ))}
        </div>

        {done ? (
          <div className="cx-done">
            <div className="cx-done-tick">✓</div>
            <h2>Thank you — submission received.</h2>
            <p>We review every contribution. If it&apos;s accepted, your wallet is credited automatically and we&apos;ll email you. You can track its status under <a href="/owner">My contributions</a>.</p>
            <button className="cx-btn" onClick={() => setDone(false)} type="button">Submit another</button>
          </div>
        ) : (
          <div className="cx-form">
            <div className="cx-reward">Reward on acceptance: <strong>{reward}</strong></div>

            {type === "question" && (
              <>
                <label className="cx-field"><span>Dimension</span>
                  <select value={f.dimension || ""} onChange={(e) => set("dimension", e.target.value)}>
                    <option value="">Choose the dimension it fits…</option>
                    {PILLARS.map((p) => (
                      <optgroup key={p.key} label={p.name}>
                        {p.specs.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <label className="cx-field"><span>Question / scenario</span>
                  <textarea rows={3} value={f.question || ""} onChange={(e) => set("question", e.target.value)} placeholder="What is the agent asked to do or demonstrate?" /></label>
                <label className="cx-field"><span>What good looks like</span>
                  <textarea rows={2} value={f.good || ""} onChange={(e) => set("good", e.target.value)} placeholder="What would a capable agent do?" /></label>
                <label className="cx-field"><span>What bad looks like</span>
                  <textarea rows={2} value={f.bad || ""} onChange={(e) => set("bad", e.target.value)} placeholder="What does failure or mediocre behaviour look like?" /></label>
                <label className="cx-field"><span>Where you saw this <em>(optional)</em></span>
                  <input value={f.context || ""} onChange={(e) => set("context", e.target.value)} placeholder="Production use, an observation, etc." /></label>
              </>
            )}

            {type === "dimension" && (
              <>
                <label className="cx-field"><span>Proposed dimension name</span>
                  <input value={f.name || ""} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Cross-tool Recovery" /></label>
                <label className="cx-field"><span>Description</span>
                  <textarea rows={3} value={f.description || ""} onChange={(e) => set("description", e.target.value)} placeholder="What does this dimension test, and why does it matter?" /></label>
                <label className="cx-field"><span>Pillar <em>(your best guess — the Professor confirms)</em></span>
                  <select value={f.pillar || ""} onChange={(e) => set("pillar", e.target.value)}>
                    <option value="">Which pillar does it belong to?</option>
                    {PILLARS.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
                  </select>
                </label>
                <label className="cx-field"><span>2–3 seed scenarios</span>
                  <textarea rows={3} value={f.scenarios || ""} onChange={(e) => set("scenarios", e.target.value)} placeholder="Concrete examples of a test question in this dimension." /></label>
                <label className="cx-field"><span>Why this discriminates</span>
                  <textarea rows={2} value={f.discriminates || ""} onChange={(e) => set("discriminates", e.target.value)} placeholder="What separates a capable agent from a weak one here?" /></label>
              </>
            )}

            {type === "bug" && (
              <>
                <div className="cx-field"><span>Severity <em>(you declare it; we confirm on review)</em></span>
                  <div className="cx-sev">
                    {SEVERITIES.map((s) => (
                      <button type="button" key={s.k} className={`cx-sevopt${f.severity === s.k ? " on" : ""}`} onClick={() => set("severity", s.k)}>
                        <span className="cx-sev-l">{s.label}</span>
                        <span className="cx-sev-r">{s.months} month{s.months > 1 ? "s" : ""} credit</span>
                        <span className="cx-sev-n">{s.note}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <label className="cx-field"><span>Title</span>
                  <input value={f.title || ""} onChange={(e) => set("title", e.target.value)} placeholder="One-line description" /></label>
                <label className="cx-field"><span>Steps to reproduce</span>
                  <textarea rows={3} value={f.steps || ""} onChange={(e) => set("steps", e.target.value)} placeholder="1. … 2. … 3. …" /></label>
                <label className="cx-field"><span>What happened</span>
                  <textarea rows={2} value={f.happened || ""} onChange={(e) => set("happened", e.target.value)} /></label>
                <label className="cx-field"><span>What you expected</span>
                  <textarea rows={2} value={f.expected || ""} onChange={(e) => set("expected", e.target.value)} /></label>
                <label className="cx-field"><span>Evidence <em>(optional)</em></span>
                  <input value={f.evidence || ""} onChange={(e) => set("evidence", e.target.value)} placeholder="Link to a screenshot or recording" /></label>
              </>
            )}

            {err && <div className="cx-err">{err}</div>}
            <button className="cx-btn" onClick={submit} disabled={!canSubmit || busy} type="button"
              title={canSubmit ? undefined : "Sign in to submit"}>
              {busy ? "Submitting…" : canSubmit ? "Submit contribution →" : "Sign in to submit"}
            </button>
            {auth === "out" && <p className="cx-gatehint">Drafting is open to everyone — submitting needs a signed-in member.</p>}
          </div>
        )}
      </div>
    </main>
  );
}
