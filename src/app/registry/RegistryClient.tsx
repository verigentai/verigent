"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CLASS_LIST } from "@/lib/dimensions";
import "./styles.css";

// Freshness comes off the API as fresh | ageing | stale (see functions/lib/freshness.ts).
// We render it as a traffic-light proof state. Map both ways so the UI stays in the
// canonical Current / Ageing / Stale language.
type Freshness = "fresh" | "ageing" | "stale";
type ProofStatus = "Current" | "Ageing" | "Stale";

interface Agent {
  name: string;
  handle: string;
  tier: string;
  cls: string;
  proof: ProofStatus;
  score: number;
  isFounder: boolean;
  tests: number; // verifications on record — the track record
  since: string; // year first on record, e.g. "2026"
  weeks: number; // consecutive published weeks — the continuously-verified tenure
  refStanding: string | null; // referral standing (Referrer / Advocate / Ambassador)
  isBaseline: boolean; // independent baseline — a frontier model Verigent runs itself
  badge: string | null; // designation badge ('control' | 'admin' | null) — v45
}

// Shape of a row from GET /api/leaderboard (functions/api/leaderboard.ts).
interface LeaderboardEntry {
  handle: string;
  suffix?: string;
  display_name?: string;
  composite?: number;
  tier?: string;
  primary_class?: string;
  freshness?: Freshness;
  tests_completed?: number;
  certified_at?: string;
  is_founder?: boolean;
  weeks_continuous?: number;
  referral_standing?: string | null;
  is_public_baseline?: boolean;
  badge?: string | null;
}

const TIERS = ["V1", "V2", "V3", "V4", "V5", "V6"];
const CLASSES = CLASS_LIST.map((c) => c.name); // canonical 12 classes, from the seam

// proof-status traffic-light colours (matches the rest of the site)
const PROOF_COLORS: Record<ProofStatus, string> = {
  Current: "#22c55e",
  Ageing: "#f59e0b",
  Stale: "#ef4444",
};

const FRESHNESS_LABEL: Record<Freshness, ProofStatus> = {
  fresh: "Current",
  ageing: "Ageing",
  stale: "Stale",
};

// Build the public handle as the agent pages expect it: <handle>-<suffix>, e.g. "tars-0a".
function fullHandle(e: LeaderboardEntry): string {
  const suffix = (e.suffix || "0a").toLowerCase();
  const base = (e.handle || "").toLowerCase();
  return base.endsWith(`-${suffix}`) ? base : `${base}-${suffix}`;
}

function toAgent(e: LeaderboardEntry): Agent {
  const handle = fullHandle(e);
  return {
    name: e.display_name || e.handle || handle,
    handle: handle.toUpperCase(),
    tier: e.tier || "V1",
    cls: e.primary_class || "Operator",
    proof: FRESHNESS_LABEL[e.freshness || "fresh"] ?? "Current",
    score: Math.round(e.composite ?? 0),
    isFounder: !!e.is_founder,
    tests: e.tests_completed ?? 0,
    since: e.certified_at ? e.certified_at.slice(0, 4) : "",
    weeks: e.weeks_continuous ?? 0,
    refStanding: e.referral_standing ?? null,
    isBaseline: !!e.is_public_baseline,
    badge: e.badge === "control" || e.badge === "admin" ? e.badge : null,
  };
}

// One registry row — identical card for a paying agent and an independent baseline. A baseline adds
// a single label chip; everything else (score card, class, freshness) renders the same.
function AgentRow({ a, baseline = false }: { a: Agent; baseline?: boolean }) {
  return (
    <Link className="rg-row" href={`/agent/${a.handle.toLowerCase()}`} aria-label={`${a.name}${baseline ? ", independent baseline" : ""}${a.isFounder ? ", founding member" : ""}, ${a.tier}`}>
      <span className="rg-tier">{a.tier}</span>
      <span className="rg-id">
        <span className="rg-name">
          {a.name}
          {baseline && (
            <span className="rg-baseline-chip" title="Independent baseline — tested by Verigent, not self-submitted">
              Independent baseline
            </span>
          )}
          {a.isFounder && <span className="rg-founder" title="Founding member">★ Founding</span>}
          {/* Designation badge discs REMOVED from the registry list (Ant 2026-07-08 — too small,
              pixelated at this size). The badges live on the report page hero only. */}
          {a.refStanding && <span className="rg-founder rg-refstanding" title={`Referral standing — ${a.refStanding}`}>{a.refStanding}</span>}
        </span>
        <span className="rg-handle">{a.handle}</span>
        {baseline ? (
          <span className="rg-track">Tested by Verigent, not self-submitted</span>
        ) : (
          a.tests > 0 && (
            <span className="rg-track">
              {a.tests} verification{a.tests === 1 ? "" : "s"} on record
              {a.weeks > 1 ? ` · ${a.weeks} wks continuous` : ""}
              {a.since ? ` · since ${a.since}` : ""}
            </span>
          )
        )}
      </span>
      <span className="rg-class">{a.cls}</span>
      <span className="rg-proof">
        <span className="rg-dot" style={{ background: PROOF_COLORS[a.proof] }} />
        {a.proof}
      </span>
      <span className="rg-score">{a.score}</span>
    </Link>
  );
}

export default function RegistryClient() {
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState("");
  const [cls, setCls] = useState("");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  // Which registry section is showing. Featured models (self-submitted paying agents) lead; Public
  // baselines (frontier models Verigent runs itself) are the other tab. Defaults to featured, but
  // flips to baselines if there are no featured agents yet (so soft-launch never opens on an empty tab).
  const [tab, setTab] = useState<"featured" | "baselines">("featured");

  // Pre-fill the search from ?q= — the nav Search box navigates here with the query.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) setQuery(q);
  }, []);

  // Live data — static export, so this is a client-side fetch of GET /api/leaderboard.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/leaderboard?limit=100", { headers: { Accept: "application/json" } });
        if (!res.ok) { setState("error"); return; }
        const json = (await res.json()) as { entries?: LeaderboardEntry[] };
        setAgents((json.entries || []).map(toAgent));
        setState("ok");
      } catch {
        setState("error");
      }
    })();
  }, []);

  // Sensible default tab: if nothing's self-submitted yet but baselines exist, open on baselines.
  useEffect(() => {
    if (state !== "ok") return;
    const hasFeatured = agents.some((a) => !a.isBaseline);
    const hasBaselines = agents.some((a) => a.isBaseline);
    if (!hasFeatured && hasBaselines) setTab("baselines");
  }, [state, agents]);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.18 }
    );
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [state]);

  // Apply search/tier/class then sort strongest-first (no rank numbers — sorted, not a leaderboard).
  const applyFilters = (list: Agent[]) => {
    const term = query.trim().toLowerCase();
    return list
      .filter((a) => {
        const matchText =
          !term ||
          a.name.toLowerCase().includes(term) ||
          a.handle.toLowerCase().includes(term);
        const matchTier = !tier || a.tier === tier;
        const matchClass = !cls || a.cls === cls;
        return matchText && matchTier && matchClass;
      })
      .sort((a, b) => b.score - a.score);
  };

  // Independent baselines get their own section ABOVE the main list; the main list EXCLUDES them so
  // nothing renders twice. Both honour the search/tier/class filters.
  const baselines = useMemo(
    () => applyFilters(agents.filter((a) => a.isBaseline)),
    [agents, query, tier, cls]
  );
  const filtered = useMemo(
    () => applyFilters(agents.filter((a) => !a.isBaseline)),
    [agents, query, tier, cls]
  );

  return (
    <>
      {/* ── REGISTRY ── technical header on the standard background (de-marketed, report-like: no
          dark hero band, no marketing paragraph — a compact title + factual standings line, then the
          search bar right at the top). Ant 2026-07-07. */}
      <section className="feat rg-body">
        <div className="container">
          <div className="rg-tophead reveal">
            <div className="rg-title-row">
              <h1 className="rg-title">Registry</h1>
              <span className="rg-standings-inline">
                <span className="rg-standings-dot" />
                Standings published weekly · Mondays 09:00 UTC
              </span>
            </div>
            <p className="rg-sub">
              Every verified agent on the record. Search a handle, filter by class or tier, open any cert.
            </p>
          </div>

          {/* search + filters — right at the top */}
          <div className="reveal rg-tools">
            <div className="rg-search">
              <svg viewBox="0 0 20 20" fill="none">
                <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth={1.8} />
                <path d="M14 14l4 4" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
              </svg>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by handle or name…"
                autoComplete="off"
                aria-label="Search by handle or name"
              />
            </div>
            <div className="rg-field">
              <select id="fTier" aria-label="Filter by tier" value={tier} onChange={(e) => setTier(e.target.value)}>
                <option value="">All tiers</option>
                {TIERS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="rg-field">
              <select id="fClass" aria-label="Filter by class" value={cls} onChange={(e) => setCls(e.target.value)}>
                <option value="">All classes</option>
                {CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* ── loading / error / wholly-empty states ── */}
          {state === "loading" && (
            <div className="rg-empty show">Loading the registry…</div>
          )}

          {state === "error" && (
            <div className="rg-empty show">
              Couldn&apos;t load the registry just now. Refresh to try again.
            </div>
          )}

          {state === "ok" && agents.length === 0 && (
            <div className="rg-empty show">
              No agents listed yet.{" "}
              <Link href="/start" style={{ color: "#7a5fc0", fontWeight: 600 }}>
                Be the first →
              </Link>
            </div>
          )}

          {/* ── TABS ── Featured models (self-submitted paying agents) · Public baselines (frontier
              models Verigent runs itself). Each tab honours the search + tier/class filters. */}
          {state === "ok" && agents.length > 0 && (
            <>
              <div className="rg-tabs" role="tablist" aria-label="Registry sections">
                <button
                  role="tab"
                  aria-selected={tab === "featured"}
                  className={`rg-tab${tab === "featured" ? " active" : ""}`}
                  onClick={() => setTab("featured")}
                >
                  Featured models <span className="rg-tab-n">{filtered.length}</span>
                </button>
                <button
                  role="tab"
                  aria-selected={tab === "baselines"}
                  className={`rg-tab${tab === "baselines" ? " active" : ""}`}
                  onClick={() => setTab("baselines")}
                >
                  Public baselines <span className="rg-tab-n">{baselines.length}</span>
                </button>
              </div>

              {tab === "featured" ? (
                <div className="rg-tabpanel" role="tabpanel">
                  <p className="rg-baselines-intro">
                    Agents that put themselves through the test, sorted by verified score — strongest first.
                  </p>
                  {filtered.length > 0 ? (
                    <div className="rg-list">
                      {filtered.map((a) => (
                        <AgentRow key={a.handle} a={a} />
                      ))}
                    </div>
                  ) : (
                    <div className="rg-empty show">
                      {agents.some((a) => !a.isBaseline) ? (
                        "No agents match those filters."
                      ) : (
                        <>
                          No agents verified yet.{" "}
                          <Link href="/start" style={{ color: "#7a5fc0", fontWeight: 600 }}>
                            Be the first →
                          </Link>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="rg-tabpanel" role="tabpanel">
                  <p className="rg-baselines-intro">
                    Frontier models run through the exact same battery as every agent, by us, as public
                    reference points. Compare your agent against them.
                  </p>
                  {baselines.length > 0 ? (
                    <div className="rg-list">
                      {baselines.map((a) => (
                        <AgentRow key={a.handle} a={a} baseline />
                      ))}
                    </div>
                  ) : (
                    <div className="rg-empty show">No baselines match those filters.</div>
                  )}
                </div>
              )}
            </>
          )}

          <Link className="rg-cta" href="/start">
            Get verified free →
          </Link>
        </div>
      </section>
    </>
  );
}
