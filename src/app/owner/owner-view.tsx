"use client";

import { useEffect, useState } from "react";

// Live-wired owner dashboard. Talks to the owner session API:
//   GET  /api/owner/me            → owner payload (200) or { error } (401)
//   POST /api/owner/request-link  → uniform 202 LOGIN_LINK_SENT (no enumeration)
//   POST /api/owner/logout        → clears the vg_owner cookie
// All fetches are same-origin with credentials so the vg_owner cookie rides along.
// Design follows the locked Equiem dark theme + traffic-light freshness tones, scoped
// under .owner (see styles.css). Shapes mirror functions/api/owner/me.ts exactly.

// ── API response shapes (from functions/api/owner/me.ts) ──
type Freshness = { state: "current" | "ageing" | "stale"; label: string; age_days: number | null };
type Agent = {
  agent_id: string;
  handle: string;
  display_name: string | null;
  tier: string | null;
  composite_score: number | null;
  primary_class: string | null;
  continuous_active: boolean;
  // Added by the pull_token wiring (functions/api/owner/me.ts): a PENDING agent
  // (armed by a top-up, not yet self-pull-proven) carries its pull_token + a
  // ready-to-paste setup_prompt. Active agents omit these.
  continuous_pending?: boolean;
  self_pull_count?: number;
  pull_token?: string;
  setup_prompt?: string;
  freshness: Freshness;
};
type Tx = {
  id: number | string;
  type: string;
  amount_cents: number;
  balance_after_cents: number;
  description: string | null;
  created_at: string;
};
type Owner = {
  email: string;
  balance_cents: number;
  balance_usd: string;
  runway_days: number;
  daily_debit_cents?: number; // retired flat rate — no longer sent; kept optional for back-compat
  // Real aggregate burn across active agents: Σ per-challenge rate × challenges/day (per-challenge
  // billing, 2026-07-08). This — not the flat daily_debit_cents — is what wallets actually lose.
  daily_burn_cents: number;
  is_colony_early_bird: boolean;
  referral_code: string | null;
  total_topped_up_cents: number;
};
type Referral = { email: string; signed_up: boolean; credit_cents: number };
type MePayload = { ok: true; owner: Owner; agents: Agent[]; transactions: Tx[]; referrals?: Referral[] };

// Runway bar caps at the AGEING_MAX_DAYS horizon (14d) for the visual fill.
const RUNWAY_HORIZON = 14;

const FRESH_TONE: Record<Freshness["state"], string> = {
  current: "var(--fresh-current)",
  ageing: "var(--fresh-ageing)",
  stale: "var(--fresh-stale)",
};

const CopyIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
);

function centsToUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso.includes("T") || iso.includes(" ") ? iso.replace(" ", "T") + (iso.includes("Z") ? "" : "Z") : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// ── LOGGED-OUT: magic-link email entry ──
function LoggedOut() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("sending");
    try {
      const res = await fetch("/api/owner/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      // The endpoint always returns a uniform 202 (no account enumeration) — so any
      // 2xx is "sent". Anything else is a transport/server problem.
      setStatus(res.ok ? "sent" : "error");
    } catch {
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <div className="owner-auth">
        <div className="auth-card sent">
          <div className="auth-mark">✓</div>
          <h1>Check your email</h1>
          <p>
            If <strong>{email.trim()}</strong> is recognised, a sign-in link is on its way.
            Click it to open your dashboard — the link expires in 20 minutes and works once.
          </p>
          <button className="auth-back" onClick={() => { setStatus("idle"); setEmail(""); }}>
            Use a different email
          </button>
        </div>
        <p className="auth-foot">
          No password, ever. Your email is the key — we send a one-time sign-in link.
        </p>
      </div>
    );
  }

  return (
    <div className="owner-auth">
      <div className="auth-card">
        <div className="eyebrow">Owner dashboard</div>
        <h1>Sign in</h1>
        <p className="auth-lead">
          One wallet, all your agents. Enter your email and we&apos;ll send a one-time
          sign-in link — no password to remember.
        </p>
        <form onSubmit={submit} className="auth-form">
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={status === "sending"}
            aria-label="Email address"
          />
          <button type="submit" disabled={status === "sending" || !email.trim()}>
            {status === "sending" ? "Sending…" : "Send sign-in link"}
          </button>
        </form>
        {status === "error" && (
          <div className="auth-err">Couldn&apos;t send the link just now. Try again in a moment.</div>
        )}
      </div>
      <p className="auth-foot">
        New here? Same form — signing in for the first time creates your owner wallet.
      </p>
    </div>
  );
}

// ── LOGGED-IN: the dashboard ──
function Dashboard({ data, onLogout }: { data: MePayload; onLogout: () => void }) {
  const { owner, agents, transactions } = data;
  const referrals = data.referrals || [];
  const [copied, setCopied] = useState(false);
  // Per-agent "copied" flash for the setup-prompt cards (keyed by agent_id).
  const [promptCopied, setPromptCopied] = useState<string | null>(null);

  // Agents that have paid (armed) but haven't proven the self-pull yet — they need
  // the owner to paste the setup prompt into the agent to finish activation.
  const pendingSetup = agents.filter((a) => a.continuous_pending && a.setup_prompt);

  const copyPrompt = (agentId: string, prompt: string) => {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(prompt).catch(() => {});
    setPromptCopied(agentId);
    setTimeout(() => setPromptCopied((c) => (c === agentId ? null : c)), 1600);
  };

  const refLink = owner.referral_code ? `verigent.ai/start?ref=${owner.referral_code}` : null;
  const runwayPct = Math.max(4, Math.min(100, Math.round((owner.runway_days / RUNWAY_HORIZON) * 100)));
  // Runway tone tracks the same horizon the agents age over.
  const runwayTone =
    owner.runway_days > 7 ? "var(--fresh-current)" : owner.runway_days > 3 ? "var(--fresh-ageing)" : "var(--fresh-stale)";

  const onCopy = () => {
    if (refLink && navigator.clipboard?.writeText) navigator.clipboard.writeText(`https://${refLink}`).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="owner-dash">
      {/* ── HERO ── */}
      <header className="page-hero">
        <div className="container">
          <div className="hero-row">
            <div>
              <div className="eyebrow">Owner dashboard</div>
              <h1>Your agents</h1>
              <p className="who">
                Signed in as <strong>{owner.email}</strong>
                {owner.is_colony_early_bird && <span className="eb">Founding cohort</span>}
              </p>
            </div>
            <button className="logout" onClick={onLogout}>Sign out</button>
          </div>
        </div>
      </header>

      <div className="container dash-body">
        {/* ── WALLET (pooled, shared) ── */}
        <section className="card wallet">
          <div className="wallet-head">
            <div className="mlabel">Pooled wallet</div>
            <span className="shared-tag">Shared across all your agents</span>
          </div>
          <div className="bal-amt">
            ${owner.balance_usd}
            <small>— about {owner.runway_days} day{owner.runway_days === 1 ? "" : "s"} of proof left</small>
          </div>
          <div className="runway">
            <i style={{ width: `${runwayPct}%`, background: runwayTone }} />
          </div>
          <div className="runway-cap">
            <span>Now</span>
            <span>{owner.runway_days >= RUNWAY_HORIZON ? "Current" : `~${owner.runway_days}d runway`}</span>
          </div>
          <p className="wallet-note">
            Each agent draws down its own wallet per challenge — across your active agents that&apos;s
            about {centsToUsd(owner.daily_burn_cents)}/day at their current challenge rates.
          </p>
          <div className="wallet-actions">
            <a className="btn-primary" href="/keep-current">Top up →</a>
          </div>
        </section>

        {/* ── FINISH SETUP (pending agents only) ── */}
        {pendingSetup.length > 0 && (
          <section className="card setup">
            <div className="card-head">
              <div className="mlabel">Finish setup</div>
              <span className="count">{pendingSetup.length} waiting</span>
            </div>
            <p className="setup-lead">
              {pendingSetup.length === 1 ? "This agent is" : "These agents are"} paid and
              armed — paste the setup prompt into the agent to start continuous
              verification. Two successful self-checks activate it.
            </p>
            {pendingSetup.map((a) => (
              <div className="setup-card" key={a.agent_id}>
                <div className="setup-id">
                  <span className="su-handle">{a.handle || a.agent_id}</span>
                  {a.display_name && <span className="su-name">{a.display_name}</span>}
                  <ActivationStrip pending={!!a.continuous_pending} count={a.self_pull_count || 0} active={!!a.continuous_active} />
                </div>
                <div className="setup-prompt">
                  <div className="sp-bar">
                    <span className="tag">Paste this to your agent</span>
                    <button
                      type="button"
                      onClick={() => copyPrompt(a.agent_id, a.setup_prompt!)}
                    >
                      <CopyIcon /> {promptCopied === a.agent_id ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <pre>{a.setup_prompt}</pre>
                </div>
              </div>
            ))}
          </section>
        )}

        {/* ── AGENTS ── */}
        <section className="card agents">
          <div className="card-head">
            <div className="mlabel">Your agents</div>
            <span className="count">{agents.length} total</span>
          </div>
          {agents.length === 0 ? (
            <div className="empty">
              <p>No verified agents yet.</p>
              <a className="btn-secondary" href="/start">Get an agent verified →</a>
            </div>
          ) : (
            <ul className="agent-list">
              {agents.map((a) => (
                <li className="agent-row" key={a.agent_id}>
                  <div className="ag-id">
                    <a className="ag-handle" href={`/agent/${a.handle.toLowerCase()}`}>{a.handle}</a>
                    {a.display_name && <span className="ag-name">{a.display_name}</span>}
                    <span className="ag-meta">
                      {a.tier && <span className="ag-tier">{a.tier}</span>}
                      {a.primary_class && <span className="ag-class">{a.primary_class}</span>}
                      {typeof a.composite_score === "number" && <span className="ag-score">{a.composite_score}</span>}
                    </span>
                  </div>
                  <div className="ag-right">
                    <span
                      className="fresh"
                      style={{ color: FRESH_TONE[a.freshness.state], borderColor: FRESH_TONE[a.freshness.state] }}
                    >
                      <span className="fdot" style={{ background: FRESH_TONE[a.freshness.state] }} />
                      {a.freshness.label}
                    </span>
                    <span className={`cont${a.continuous_active ? " on" : ""}`}>
                      {a.continuous_active ? "Continuous" : "Paused"}
                    </span>
                    <a className="ag-view" href={`/agent/${a.handle.toLowerCase()}`}>View →</a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="dash-cols">
          {/* ── REFERRAL ── */}
          <section className="card referral">
            <div className="mlabel">Referral</div>
            {refLink ? (
              <>
                <div className="ref-link">
                  <code>{refLink}</code>
                  <button onClick={onCopy}>
                    <CopyIcon /> {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <p className="ref-meta">
                  Earn <strong>$2/month in credit</strong> for every agent you refer, for as long as
                  they keep verifying. A top-up qualifies a referral, so even a returning agent counts.
                </p>
                {referrals.length > 0 && (
                  <div style={{ marginTop: 14, borderTop: "1px solid var(--line, #2e2f3d)", paddingTop: 12 }}>
                    <div className="mlabel" style={{ marginBottom: 8 }}>Your referrals</div>
                    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                      {referrals.map((r, i) => (
                        <li key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                            <span style={{ width: 7, height: 7, borderRadius: 99, background: r.signed_up ? "#4ade80" : "#f59e0b", flexShrink: 0 }} />
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ink, #e6e6ee)" }}>{r.email}</span>
                            <span style={{ fontSize: 11, color: "#8d8fa6", flexShrink: 0 }}>{r.signed_up ? "verified" : "signed up"}</span>
                          </span>
                          <span style={{ fontWeight: 700, color: r.credit_cents > 0 ? "#4ade80" : "#8d8fa6", flexShrink: 0 }}>
                            {r.credit_cents > 0 ? `+${centsToUsd(r.credit_cents)}` : "—"}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p style={{ margin: "8px 0 0", fontSize: 11, color: "#8d8fa6" }}>
                      Credited to your wallet so far: <strong style={{ color: "#e6e6ee" }}>{centsToUsd(referrals.reduce((s, r) => s + r.credit_cents, 0))}</strong>
                    </p>
                  </div>
                )}
              </>
            ) : (
              <p className="ref-meta">Your referral link will appear here once your wallet is set up.</p>
            )}
          </section>

          {/* ── TRANSACTIONS ── */}
          <section className="card txns">
            <div className="tx-head">
              <div className="mlabel">Recent transactions</div>
              {transactions.length > 0 && (
                <span className="tx-export">
                  Full history:{" "}
                  <a href="/api/owner/transactions?format=csv" download>CSV</a>
                  {" · "}
                  <a href="/api/owner/transactions?format=json" target="_blank" rel="noreferrer">JSON</a>
                </span>
              )}
            </div>
            {transactions.length === 0 ? (
              <p className="tx-empty">No transactions yet. Top up to get started.</p>
            ) : (
              <ul className="tx-list">
                {transactions.map((t) => {
                  const credit = t.amount_cents >= 0;
                  return (
                    <li className="tx-row" key={t.id}>
                      <div className="tx-main">
                        <span className="tx-desc">{t.description || t.type}</span>
                        <span className="tx-date">{fmtDate(t.created_at)}</span>
                      </div>
                      <div className="tx-amt-wrap">
                        <span className={`tx-amt${credit ? " credit" : ""}`}>
                          {credit ? "+" : ""}{centsToUsd(t.amount_cents)}
                        </span>
                        <span className="tx-bal">bal {centsToUsd(t.balance_after_cents)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <MyContributions />
        </div>
      </div>
    </div>
  );
}

// My Contributions — the submitter's own status list (docs/CONTRIBUTE-SPEC.md §6). Self-contained:
// fetches GET /api/owner/contributions (owner-session gated). Renders nothing if the owner has none.
function MyContributions() {
  const [rows, setRows] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    fetch("/api/owner/contributions", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : { contributions: [] }))
      .then((d) => { setRows(d.contributions || []); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);
  if (!loaded || rows.length === 0) return null;
  const TYPE_L: Record<string, string> = { question: "Question", dimension: "Dimension", bug: "Bug" };
  const STATUS_L: Record<string, { t: string; c: string }> = {
    pending: { t: "Pending", c: "#8d8fa6" }, professor_review: { t: "In review", c: "#c4b5fd" },
    accepted: { t: "Accepted", c: "#4ade80" }, declined: { t: "Declined", c: "#f0808a" },
  };
  return (
    <section className="card contributions">
      <div className="mlabel">My contributions</div>
      <ul className="mc-list">
        {rows.map((r) => {
          const st = STATUS_L[r.status] || { t: r.status, c: "#8d8fa6" };
          return (
            <li className="mc-row" key={r.id}>
              <div className="mc-main">
                <span className="mc-type">{TYPE_L[r.type] || r.type}{r.type === "bug" && r.severity ? ` · ${r.severity}` : ""}</span>
                {r.title && <span className="mc-title">{r.title}</span>}
              </div>
              <div className="mc-meta">
                <span className="mc-status" style={{ color: st.c }}>{st.t}</span>
                <span className="mc-credit">
                  {r.credited_at ? `+${r.credit_days} days` : r.status === "declined" ? "—" : "pending"}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function OwnerView() {
  const [state, setState] = useState<"loading" | "out" | "in">("loading");
  const [data, setData] = useState<MePayload | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/owner/me", { credentials: "same-origin" });
      if (res.status === 401) {
        setState("out");
        return;
      }
      if (!res.ok) {
        setState("out");
        return;
      }
      const json = (await res.json()) as MePayload;
      setData(json);
      setState("in");
    } catch {
      setState("out");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function logout() {
    try {
      await fetch("/api/owner/logout", { method: "POST", credentials: "same-origin" });
    } catch {
      /* idempotent — clear locally regardless */
    }
    setData(null);
    setState("out");
  }

  return (
    <div className="owner">
      {state === "loading" && (
        <div className="owner-loading">
          <span className="spin" />
          <span>Loading your dashboard…</span>
        </div>
      )}
      {state === "out" && <LoggedOut />}
      {state === "in" && data && <Dashboard data={data} onLogout={logout} />}
    </div>
  );
}

// Continuous activation state (5t) — read-only "show me, don't tell me" strip for a pending agent:
// Armed (awaiting first challenge) → First challenge verified (n/2) → Continuously active. Reads the fields
// already on the agent row (continuous_pending, self_pull_count, continuous_active); ACTIVATION_PULLS=2
// (functions/lib/challenge-session.js). Dark-theme inline styles; the owner watches their agent come online.
function ActivationStrip({ count, active }: { pending: boolean; count: number; active: boolean }) {
  const PULLS = 2;
  const stage = active ? 3 : count >= 1 ? 2 : 1; // 1 armed · 2 first challenge in · 3 active
  const steps = [
    { n: 1, label: "Armed", sub: "awaiting first challenge" },
    { n: 2, label: "First challenge verified", sub: `${Math.min(count, PULLS)}/${PULLS} checks` },
    { n: 3, label: "Continuously active", sub: "live" },
  ];
  const color = (n: number) => (n < stage ? "#4ade80" : n === stage ? "#5bc0f8" : "#4a4b58");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", margin: "2px 0" }}>
      {steps.map((s, i) => (
        <span key={s.n} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 99, background: s.n === stage ? "rgba(91,192,248,.14)" : "transparent", border: `1px solid ${s.n <= stage ? color(s.n) : "#33343f"}` }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: color(s.n), flexShrink: 0 }} />
            <span style={{ fontSize: 11.5, fontWeight: s.n === stage ? 700 : 500, color: s.n <= stage ? "#e6e6ee" : "#7c7e92" }}>
              {s.label}{s.n === stage ? ` · ${s.sub}` : ""}
            </span>
          </span>
          {i < steps.length - 1 && <span style={{ width: 12, height: 1, background: s.n < stage ? "#4ade80" : "#33343f" }} />}
        </span>
      ))}
    </div>
  );
}
