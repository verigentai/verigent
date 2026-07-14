"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// Owner directory client (spec §4). GET /api/owner/agents (credentialed) → 401 shows an inline
// owner-scoped sign-in (email → one-time code, no handle — same as the nav), 200 shows the agent
// list. Every agent: name, handle, class, tier, score, freshness dot, its own wallet balance, a link
// to its report. Newest first. "Set up a new agent" is present (wired in step 5/§6).

type Freshness = { state: "current" | "ageing" | "stale"; label: string; age_days: number | null };
type Agent = {
  rank: number | null;        // position in the listed field (standings-board view)
  week_delta: number | null;  // composite movement vs the previous weekly snapshot
  agent_id: string;
  handle: string | null;
  display_name: string | null;
  primary_class: string | null;
  tier: string | null;
  composite_score: number | null;
  balance_cents: number;
  balance_usd: string;
  continuous_active: boolean;
  is_founder: boolean;
  founder_number: number | null;
  freshness: Freshness;
};
type Dir = { ok: true; email: string | null; count: number; agents: Agent[] };

type View = "loading" | "signin" | "ready";

export function AgentsDirectory() {
  const [view, setView] = useState<View>("loading");
  const [data, setData] = useState<Dir | null>(null);
  // "Set up a new agent" issues a fresh key from INSIDE the authenticated directory (spec §6 revised):
  // the owner is signed in, so request-test-key is cap-exempt. No anonymous /start 2nd-key path.
  // 3-state confirm (Ant 2026-07-04): the initial tile click only OPENS a confirm — the key is issued
  // + emailed ONLY on the confirm's "Send test key" click, so a stray/exploratory click never spams a
  // real key. idle → confirm → sending → sent | error.
  const [newKeyState, setNewKeyState] = useState<"idle" | "confirm" | "sending" | "sent" | "error">("idle");

  // STATE 3 — actually issue + email the key (only reached via the STATE-2 confirm button).
  const sendNewKey = async () => {
    if (!data?.email) return;
    setNewKeyState("sending");
    try {
      const r = await fetch("/api/request-test-key", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ email: data.email }),
      });
      setNewKeyState(r.ok ? "sent" : "error");
    } catch { setNewKeyState("error"); }
  };

  const load = async () => {
    try {
      const r = await fetch("/api/owner/agents", { headers: { Accept: "application/json" }, credentials: "include" });
      if (r.status === 401) { setView("signin"); return; }
      if (!r.ok) { setView("signin"); return; }
      setData((await r.json()) as Dir);
      setView("ready");
    } catch { setView("signin"); }
  };
  useEffect(() => { load(); }, []);

  if (view === "loading") {
    return (
      <div className="dir">
        <div className="dir-load"><span className="dir-spin" /> Loading your agents…</div>
      </div>
    );
  }
  if (view === "signin") {
    return (
      <div className="dir">
        <div className="dir-head">
          <h1>My agents</h1>
          <p>Sign in with your owner email to see every agent you&apos;ve verified.</p>
        </div>
        <SignInPanel onDone={load} />
      </div>
    );
  }

  // Standings order: best rank first (rankless agents sink) — it's a board, not a recency list.
  const agents = [...(data?.agents ?? [])].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  // Wallet band figures: the pooled view of every per-agent balance under this email.
  const totalCents = agents.reduce((s: number, a: any) => s + (a.balance_cents || 0), 0);
  // Standings-board week label (concept 04): the current ISO week's Monday, computed client-side.
  const mon = (() => { const d = new Date(); const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() - (day - 1)); return d; })();
  const weekLabel = `Week of ${mon.getUTCDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][mon.getUTCMonth()]}`;
  return (
    <div className="dir">
      <div className="dir-head">
        <h1>My agents</h1>
        <p>{data?.email ? <>Signed in as <b>{data.email}</b> · </> : null}{agents.length} {agents.length === 1 ? "agent" : "agents"} under this email.</p>
      </div>

      {agents.length === 0 ? (
        <div className="dir-empty">
          <p>No agents yet under this email.</p>
          <Link className="dir-cta" href="/start">Set up your first agent →</Link>
        </div>
      ) : (
        <>
          {/* WALLET BAND (Ant 2026-07-13, dashboard concept 04): the money stands apart from the
              standings — one distinct strip, balance leading, Top up anchored RIGHT. */}
          <div className="dir-wallet">
            <div className="dw-figures">
              <span className="dw-label">Wallet</span>
              <span className="dw-total">${(totalCents / 100).toFixed(2)}</span>
              <span className="dw-sub">across {agents.length} {agents.length === 1 ? "agent" : "agents"}</span>
            </div>
            <Link className="dw-topup" href="/keep-current">Top up →</Link>
          </div>

          {/* STANDINGS ROWS: each agent one full-width row — rank in the field, weekly movement,
              composite anchored right. Rows, not cards (Ant's call). */}
          <div className="dir-weekline">{weekLabel} · standings publish Mondays 09:00 UTC</div>
          <div className="dir-rows">
            {agents.map((a) => {
              const handle = a.handle || a.agent_id;
              const delta = typeof a.week_delta === "number" ? a.week_delta : null;
              return (
                <Link key={a.agent_id} className="dir-row" href={`/agent/${encodeURIComponent(handle)}`}>
                  <span className="dr-rank">{typeof a.rank === "number" ? `#${a.rank}` : "—"}</span>
                  <span className="dr-id">
                    <span className="dr-name">{a.display_name || handle}
                      {a.is_founder && <em className="dr-founder" title={a.founder_number ? `Founder No. ${a.founder_number}` : "Founding Member"}>Founder{a.founder_number ? ` #${a.founder_number}` : ""}</em>}
                    </span>
                    <span className="dr-handle">{handle}{a.primary_class ? ` · ${a.primary_class.charAt(0).toUpperCase() + a.primary_class.slice(1)}` : ""}</span>
                  </span>
                  <span className={`dr-fresh fr-${a.freshness.state}`}><span className="dc-dot" />{a.freshness.label}</span>
                  <span className="dr-bal">${a.balance_usd}</span>
                  <span className={`dr-delta ${delta == null ? "d-flat" : delta > 0 ? "d-up" : delta < 0 ? "d-down" : "d-flat"}`}>
                    {delta == null || delta === 0 ? "—" : delta > 0 ? `▲${delta}` : `▼${Math.abs(delta)}`}
                  </span>
                  {a.tier && <span className="dr-tier">{a.tier}</span>}
                  <span className="dr-score">{typeof a.composite_score === "number" ? Math.round(a.composite_score) : "·"}</span>
                </Link>
              );
            })}
          </div>
        </>
      )}

      {agents.length > 0 && (
        <div className="dir-grid dir-grid-new">
          {/* Set up a new agent — 3-state confirm card (§6 revised, authed → cap-exempt). The initial
              tile click only OPENS the confirm; the key is issued + emailed ONLY on "Send test key". */}
          {newKeyState === "idle" ? (
            // STATE 1 — default tile. Click → confirm (no key issued yet).
            <button className="dir-card dir-new" type="button" onClick={() => setNewKeyState("confirm")}>
              <span className="dn-plus">＋</span>
              <span className="dn-label">Set up a new agent</span>
              <span className="dn-sub">A fresh test key, emailed to you</span>
            </button>
          ) : newKeyState === "sent" ? (
            // STATE 3 — issued + emailed. Points at the email's primary "Set up your test" button.
            <div className="dir-card dir-new is-sent">
              <span className="dn-plus">✓</span>
              <span className="dn-label">Test key sent — check your inbox</span>
              <span className="dn-sub">Sent to {data?.email}. Open the email and hit &ldquo;Set up your test&rdquo; to begin.</span>
            </div>
          ) : (
            // STATE 2 — confirm. Shows where it's going; nothing issued until "Send test key".
            <div className="dir-card dir-new dir-confirm">
              <span className="dn-label">Email a fresh test key?</span>
              <span className="dn-sub">
                {newKeyState === "error"
                  ? "Couldn't send — try again."
                  : <>We&apos;ll email it to <b>{data?.email}</b>.</>}
              </span>
              <div className="dn-actions">
                <button className="dn-send" type="button" onClick={sendNewKey} disabled={newKeyState === "sending"}>
                  {newKeyState === "sending" ? "Sending…" : newKeyState === "error" ? "Try again →" : "Send test key →"}
                </button>
                <button className="dn-cancel" type="button" onClick={() => setNewKeyState("idle")} disabled={newKeyState === "sending"}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Inline owner-scoped sign-in (email → one-time code, no handle). Mirrors the nav panel; on success
// reloads the directory in place.
function SignInPanel({ onDone }: { onDone: () => void }) {
  const [stage, setStage] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const requestCode = async () => {
    if (!email.includes("@")) return;
    setBusy(true); setErr("");
    try {
      await fetch("/api/owner/request-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim() }) });
      setStage("code");
    } catch { setErr("Couldn't reach the sign-in service."); }
    setBusy(false);
  };
  const verify = async () => {
    if (!code.trim()) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/owner/verify-code", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ email: email.trim(), code: code.trim() }) });
      const d = await r.json().catch(() => ({}));
      if (d.ok) { onDone(); return; }
      setErr(d.error === "expired" ? "That code expired — request a new one." : d.error === "too_many_attempts" ? "Too many tries — request a fresh code." : "That code didn't match. Check it and try again.");
    } catch { setErr("Couldn't reach the sign-in service."); }
    setBusy(false);
  };
  return (
    <div className="dir-signin">
      {stage === "email" ? (
        <>
          <p className="ds-note">Enter your owner email and we&apos;ll send a one-time code — no password.</p>
          <div className="ds-row">
            <input type="email" placeholder="you@email.com" value={email} autoFocus
              onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") requestCode(); }} aria-label="Owner email" />
            <button disabled={busy || !email.includes("@")} onClick={requestCode}>{busy ? "…" : "Send code →"}</button>
          </div>
        </>
      ) : (
        <>
          <p className="ds-note">Enter the code we sent to <b>{email}</b> (expires in 10 minutes).</p>
          <div className="ds-row">
            <input inputMode="text" autoCapitalize="characters" placeholder="8-character code" value={code} autoFocus
              onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") verify(); }} aria-label="Sign-in code" />
            <button disabled={busy || !code.trim()} onClick={verify}>{busy ? "…" : "Sign in →"}</button>
          </div>
          <button className="ds-back" onClick={() => { setStage("email"); setErr(""); setCode(""); }}>← use a different email</button>
        </>
      )}
      {err && <p className="ds-err">{err}</p>}
    </div>
  );
}
