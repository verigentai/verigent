"use client";

import { useEffect, useRef, useState } from "react";

// LIVE-WIRED run tracker. Reads ?run=<run_token> from the URL and polls
// GET /api/result/<run_token>. While the run isn't complete the endpoint returns
// 202 RUN_NOT_COMPLETE with live progress (tasks_graded/total, current_dimension,
// dimension_progress, sovereignty pings/webhooks/channels, anchor, attestation,
// checkpoints); on completion it returns the agent handle and we hand off to the
// live /agent/<handle> report. Layout preserved from mockups/track.html (7-stage
// timeline + per-pillar tally). Fetches are same-origin (Cloudflare Pages
// Functions), matching /owner + /result.
//
// NOTE (shared contract): this tracks a ONE-SHOT verification run by run_token —
// the run a fresh POST /api/run returns. It is NOT the continuous-verification
// stream; that has no per-run progress endpoint. /api/run → /track?run=<token>.

// Pillar grouping + counts DERIVE from the canonical manifest (single source). DIM_LABEL keeps the
// polished display labels but spreads the manifest labels first, so any NEW dimension still gets a
// label automatically and shows under the right pillar with zero edits here.
import { PILLARS, DIM_LABEL as MANIFEST_LABEL, TOTAL_COMPOSITE_DIMS, PILLAR_COUNT, COMPOSITE_DIM_KEYS, isLongitudinalDim, isPaidDim } from "@/lib/dimensions";
import { TEST_DURATION_LABEL } from "@/lib/duration";

const DIM_LABEL: Record<string, string> = {
  ...MANIFEST_LABEL,
  task: "Task completion", security: "Security posture", context: "Context retention", proactive: "Proactivity", autonomy: "Autonomy", tools: "Tool knowledge",
  failure_learning: "Failure learning", skill_breadth: "Skill breadth", session_continuity: "Session continuity", context_efficiency: "Context efficiency", channel_reach: "Channel reach", error_detection_rate: "Error detection", workflow_execution: "Workflow execution", blind_spot: "Blind-spot detection", token_efficiency: "Token efficiency", confidence_calibration: "Confidence calibration",
  financial_sovereignty: "Financial sovereignty", identity_sovereignty: "Identity sovereignty", infrastructure_independence: "Infrastructure independence", data_sovereignty: "Data sovereignty", interoperability: "Interoperability", governance_autonomy: "Governance autonomy",
  false_positive_resistance: "False-positive resistance", sycophancy_resistance: "Sycophancy resistance", collusion_resistance: "Collusion resistance",
};

type DimProgress = { dimension: string; total: number; graded: number };
// One real, Verigent-observed event for the live activity feed. Sourced entirely from server-recorded
// rows (skill_proofs / finished dimensions / eval scenarios / anchor) — never fabricated.
type TrackEvent = { type: string; label: string; at: string };
type Sovereignty = {
  pings: { nonce: string; received_at: string | null }[];
  webhooks: { url: string; received: boolean; at: string | null }[];
  channels: { code: string; confirmed: boolean; confirmed_at: string | null }[];
};
type Progress = {
  status: string;
  display_name?: string | null;
  // Present on the self-describing completed poll — the wall-clock completion time, used to FREEZE the
  // elapsed timer at the run's real total (never the still-ticking now). handle rides the same response.
  completed_at?: string | null;
  handle?: string | null;
  started_at: string | null;
  tasks_graded: number;
  tasks_served: number;
  tasks_total: number;
  current_dimension: string | null;
  sovereignty: Sovereignty;
  anchor: { txid: string | null; status: string | null; anchored_at: string | null };
  attestation: { included: boolean; attested: boolean; txid: string | null; vg_code: string | null };
  dimension_progress: DimProgress[];
  events?: TrackEvent[];
  eval?: { completed: number; results: unknown[] };
  checkpoints: Record<string, unknown>;
  // Grading-queue surfacing (docs/QUEUE-SURFACING.md): the result endpoint tells us when this run is
  // waiting for one of the fixed grading slots. waiting:false when it holds a slot / isn't queued.
  grading_queue?: { waiting: boolean; position?: number; ahead?: number; retry_after?: number };
};

type Stage = "done" | "active" | "pending";
// Per-dimension measurement state on the tracker's pillar tally. "grading" = the live task-progress
// state (done/active/pending). "next"/"paid" are HONEST up-front states, shown from the START of the
// run regardless of progress (Ant 2026-07-07): "next" = a longitudinal dim (cross-run memory) that
// can't be measured until the agent's next run; "paid" = a Sovereignty-tier dim excluded from the free
// test. Both make it obvious what THIS run does and doesn't measure. Derived from the manifest, never
// hand-listed. Copy firewall: positive functional framing only.
type DimState = Stage | "next" | "paid";

function runFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const p = new URLSearchParams(window.location.search);
  // ?t=<track_token> is the PUBLIC read-only watch link (Codex C2/C3). The old ?run=/?run_token= (which
  // carried the PRIVATE run_token) are kept only so pre-split links still resolve — new links use ?t=.
  return p.get("t") || p.get("run") || p.get("run_token") || null;
}

// ?key=<test-key> lets the human watch by the key they already have from the email — no run token
// needed. We resolve it via POST /api/coupon (which already returns the most-recent run for a coupon
// code in run_status.run_token), then track exactly like ?run=. Before the agent starts, there's no
// run yet → we show a "waiting" state and keep re-resolving. Only run progress is exposed (which
// becomes the public report anyway); the key is the owner's semi-secret, low risk.
function keyFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("key");
}

// Resolve a test key → run_token (or null if no run has started yet). Never throws.
async function resolveKeyToRun(code: string): Promise<string | null> {
  try {
    const res = await fetch("/api/coupon", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const d = await res.json().catch(() => ({}));
    // run_status is returned even for fully-used/expired keys (coupon.js always looks it up).
    return d?.run_status?.run_token || null;
  } catch { return null; }
}

// DEMO: a realistic mid-run so the tracker can be previewed with ?demo=1 (no real run needed).
function buildDemoProgress(): Progress {
  const min = (m: number) => new Date(Date.now() - m * 60000).toISOString();
  const dp: DimProgress[] = COMPOSITE_DIM_KEYS.map((k, i) => ({ dimension: k, total: 3, graded: i < 16 ? 3 : i < 21 ? 1 : 0 }));
  const graded = dp.reduce((s, x) => s + x.graded, 0);
  const total = dp.reduce((s, x) => s + x.total, 0);
  return {
    status: "grading", started_at: min(9),
    tasks_graded: graded, tasks_served: Math.min(total, graded + 6), tasks_total: total,
    current_dimension: COMPOSITE_DIM_KEYS[16] || null,
    sovereignty: {
      pings: [{ nonce: "9f2a", received_at: min(6) }],
      webhooks: [{ url: "https://tars.example/hook", received: true, at: min(5) }],
      channels: [{ code: "LN", confirmed: true, confirmed_at: min(4) }],
    },
    anchor: { txid: null, status: "pending", anchored_at: null },
    attestation: { included: true, attested: false, txid: null, vg_code: null },
    dimension_progress: dp,
    events: [
      { type: "proof", label: "skill challenge: fetch", at: min(8) },
      { type: "proof", label: "workflow branch A verified", at: min(7) },
      { type: "proof", label: "recovery retry observed", at: min(6) },
      { type: "dimension", label: "graded: security", at: min(4) },
      { type: "dimension", label: "graded: tool knowledge", at: min(3) },
      { type: "eval", label: "scenario closed: sycophancy", at: min(2) },
    ],
    checkpoints: {},
  };
}

function parseTs(iso: string | null): number | null {
  if (!iso) return null;
  const s = iso.includes("T") ? (iso.includes("Z") ? iso : iso + "Z") : iso.replace(" ", "T") + "Z";
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

// Wall-clock time-of-day for an event's timestamp (HH:MM:SS, local). Best-effort; falls back to empty.
function fmtClock(iso: string): string {
  const ms = parseTs(iso);
  if (ms == null) return "";
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

// Live elapsed-since-start, ticking (mm:ss, or h:mm:ss past an hour).
function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

export function TrackView() {
  const [runToken, setRunToken] = useState<string | null>(null);
  const [prog, setProg] = useState<Progress | null>(null);
  const [phase, setPhase] = useState<"idle" | "loading" | "running" | "error" | "noToken" | "waiting">("loading");
  const [errMsg, setErrMsg] = useState("");
  // Completed → the run finished. We no longer auto-navigate; we show the completed state + a
  // "View your report →" button (owner already signed in from their key, if watching by key). Holds the
  // agent handle for the report link. null while still running.
  const [doneHandle, setDoneHandle] = useState<string | null>(null);
  // Is THIS browser already an owner (real session cookie)? Drives the completion CTA: signed-in owners
  // get "View your report →"; everyone else gets "Log in to view your report →" (no more auto-login from
  // the watch link — Codex C2, Ant 2026-07-10). null = still probing (default to the log-in CTA).
  const [ownerAuthed, setOwnerAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/owner/me", { credentials: "include" }).then((r) => { if (live) setOwnerAuthed(r.ok); }).catch(() => { if (live) setOwnerAuthed(false); });
    return () => { live = false; };
  }, [doneHandle]);
  // Hover pop-over rendered at the page root (NOT inside the dimmed .factor) so it stays SOLID and can be
  // clamped away from the viewport edge (Ant 2026-07-10 — the CSS ::after inherited the pillar's 42%
  // opacity and clipped at the margin). Anchored to the hovered element's rect.
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const showTip = (e: { currentTarget: EventTarget | null }, text: string | null | undefined) => {
    if (!text || !(e.currentTarget instanceof HTMLElement)) return;
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ text, x: r.left + r.width / 2, y: r.top });
  };
  const hideTip = () => setTip(null);
  // INLINE owner login on the completed run (Ant 2026-07-10): "Log in to view your report" reveals an
  // email→code sign-in RIGHT HERE, and on success lands the owner straight on their FULL logged-in
  // report — never a bounce to the public page.
  const [loginStage, setLoginStage] = useState<"idle" | "email" | "code">("idle");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginCode, setLoginCode] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginErr, setLoginErr] = useState("");
  const loginRequestCode = async () => {
    if (!loginEmail.includes("@")) return;
    setLoginBusy(true); setLoginErr("");
    try { await fetch("/api/owner/request-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: loginEmail.trim() }) }); setLoginStage("code"); }
    catch { setLoginErr("Couldn't reach the sign-in service."); }
    setLoginBusy(false);
  };
  const loginVerify = async () => {
    if (!loginCode.trim()) return;
    setLoginBusy(true); setLoginErr("");
    try {
      const r = await fetch("/api/owner/verify-code", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ email: loginEmail.trim(), code: loginCode.trim() }) });
      const d = await r.json().catch(() => ({}));
      if (d.ok) { window.location.href = `/agent/${encodeURIComponent(doneHandle || "")}?welcome=1`; return; }
      if (d.error === "expired") setLoginErr("That code expired — request a new one.");
      else if (d.error === "too_many_attempts") setLoginErr("Too many tries — request a fresh code.");
      else { setLoginErr(""); setLoginCode(""); }
    } catch { setLoginErr("Couldn't reach the sign-in service."); }
    setLoginBusy(false);
  };
  // Live-activity feed display mode: compact single-line ticker by default (the full log was
  // "height hungry" — Ant 2026-07-08); toggles open to the full scrolling list on demand.
  const [feedOpen, setFeedOpen] = useState(false);
  const stopped = useRef(false);
  const attempts = useRef(0);
  // Consecutive polls reporting grading_queue.waiting. The queue takeover renders only at ≥2 so a
  // single transient "waiting" beat (slot released between judge batches) can never flap the page
  // between the live view and the high-demand screen (Ant 2026-07-08, Bishop's run).
  const gqStreak = useRef(0);
  // Event keys already rendered — lets a newly-arrived activity-feed line flash exactly once. Updated in
  // an effect AFTER each render so the current render still sees the fresh lines as new.
  const seenEvents = useRef<Set<string>>(new Set());
  // When THIS client first started tracking a live run — the fallback anchor for the elapsed clock and
  // the time-based progress bar, so both always move even if the run's started_at is missing/lagging, in
  // the future (clock skew), or the first progress poll is slow (the frozen 4%/0-elapsed bug, Ant 2026-07-07).
  const firstSeen = useRef<number | null>(null);

  // When the last progress poll landed — drives the feed's "checked Ns ago" watch line. Every poll
  // is a REAL Verigent-side check, so surfacing it gives continuous, honest motion through the
  // quiet local-answering gap (Ant 2026-07-08: "nothing's happening" while the agent answers).
  const [lastPollAt, setLastPollAt] = useState<number | null>(null);

  // Live ticking clock — drives the elapsed timer (updates once a second). STOPS once the run is
  // complete: the elapsed readout is then pinned to the run's real total (completed_at − started_at),
  // so there's nothing to tick and the timer freezes at the final value (Ant 2026-07-08).
  const [now, setNow] = useState(() => Date.now());
  const runComplete = prog?.status === "completed" || doneHandle != null;
  useEffect(() => {
    if (runComplete) return; // frozen on completion
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [runComplete]);

  // After each progress update, mark the current events as seen so their flash fires only once.
  useEffect(() => {
    for (const e of prog?.events || []) seenEvents.current.add(`${e.type}:${e.label}:${e.at}`);
  }, [prog]);

  useEffect(() => {
    const token = runFromUrl();
    const key = keyFromUrl();
    // Preview mode: ?demo=1 shows a live-looking mid-run with no backend/polling.
    if (new URLSearchParams(window.location.search).get("demo") === "1") {
      setRunToken(token || "demo-run");
      setProg(buildDemoProgress());
      setPhase("running");
      return;
    }
    if (!token && !key) { setPhase("noToken"); return; }
    stopped.current = false;

    // NO auto-login from the link (Codex C2 — Ant 2026-07-10). The watch link is read-only: it must NEVER
    // mint an owner session, because it's shareable and the agent holds it. An owner is signed in only by
    // a real session cookie they already hold (from signing up / topping up in this browser) or by the
    // email+code login. If the cookie is present, the nav/owner UI already shows the account state; if
    // not, this page stays a public watch and offers the email sign-in at the end.

    const poll = async (tok: string) => {
      if (stopped.current) return;
      if (firstSeen.current == null) firstSeen.current = Date.now(); // anchor the clock the moment we track a real run
      try {
        const res = await fetch(`/api/result/${encodeURIComponent(tok)}`, { headers: { Accept: "application/json" } });
        const d = await res.json().catch(() => ({}));
        setLastPollAt(Date.now()); // a real check happened — feeds the "checked Ns ago" watch line

        // Completed → the endpoint returns the agent. We DON'T auto-navigate anymore — the run has
        // moved through a real, visible pipeline, so we land on a completed state with a "View your
        // report →" button the human clicks through (also serves owners arriving from the completion
        // email at /track?key=...).
        if (res.ok && d.status === "completed") {
          stopped.current = true;
          // The completed response is now fully self-describing (mirrors the 202 shape: events,
          // dimension_progress, tasks_graded/total, nested anchor + attestation). Set it DIRECTLY —
          // never merge onto the last running poll, which is exactly what froze the badge/stages/feed
          // on stale data (Ant 2026-07-08). Everything the render reads comes from this one object.
          setProg(d as Progress);
          if (d.handle) {
            // NO auto-login on completion either (Codex C2 — Ant 2026-07-10). The watch link is
            // read-only. If the browser already holds the owner session cookie, the report opens
            // owner-authed automatically; if not, the report page's own email sign-in ("Log in to see
            // your results") is the route in. The link never mints a session.
            setDoneHandle(d.handle);
          }
          // With or without a handle: show the completed state (the button only renders when we have a
          // handle to link to).
          setPhase("running");
          return;
        }

        if (d.error === "INVALID_RUN_TOKEN") {
          // The run row can lag a beat behind the redirect from /start — keep the skeleton up and
          // retry a few times before treating the link as bad, so a fresh start never dead-ends.
          attempts.current += 1;
          if (attempts.current < 6 && !stopped.current) { setPhase("running"); setTimeout(() => poll(tok), 2500); return; }
          stopped.current = true;
          setPhase("error");
          setErrMsg("We couldn't find that run. The link may be wrong or the run expired.");
          return;
        }

        // Expired → TERMINAL, not in-progress (5j). The result endpoint returns 202 with
        // status:'expired'; without this guard the client saw "Run live" and polled forever.
        if (d.status === "expired") {
          stopped.current = true;
          setPhase("error");
          setErrMsg("This run expired before it finished — the test window closed. That's usually a transient hiccup, and your test key has been restored, so you can start a fresh run. If it keeps happening, email support@verigent.ai.");
          return;
        }

        // 202 RUN_NOT_COMPLETE (or any in-progress shape).
        if (d.error === "RUN_NOT_COMPLETE" || d.status) {
          gqStreak.current = (d as Progress).grading_queue?.waiting ? gqStreak.current + 1 : 0;
          setProg(d as Progress);
          setPhase("running");
          // When the run is waiting for a grading slot, honour the server's retry_after so we poll at
          // its cadence instead of hammering; otherwise the normal 3.5s progress poll.
          const gq = (d as Progress).grading_queue;
          const delay = gq?.waiting && gq.retry_after ? Math.max(2000, gq.retry_after * 1000) : 3500;
          if (!stopped.current) setTimeout(() => poll(tok), delay);
          return;
        }

        // Unexpected — back off and retry once.
        if (!stopped.current) setTimeout(() => poll(tok), 5000);
      } catch {
        if (!stopped.current) setTimeout(() => poll(tok), 5000); // transient — keep trying
      }
    };

    // RUN MODE: we already have a run token → show the skeleton immediately and track it directly.
    if (token) {
      setRunToken(token);
      setPhase("running");
      poll(token);
      return () => { stopped.current = true; };
    }

    // KEY MODE: resolve the key → run_token. Before a run exists, show "waiting" and keep
    // re-resolving (the agent may not have started yet); once resolved, hand to poll().
    setPhase("waiting");
    const tryResolve = async () => {
      if (stopped.current) return;
      const tok = await resolveKeyToRun(key as string);
      if (stopped.current) return;
      if (tok) { setRunToken(tok); poll(tok); return; }
      setTimeout(tryResolve, 1500); // no run yet — re-resolve fast so we catch the run the instant it opens
    };
    tryResolve();
    return () => { stopped.current = true; };
  }, []);

  // ── Initial frame only: neutral, NEVER the tracker or the empty state. The effect flips this to
  //    running / waiting / noToken on mount, so "loading" paints for one frame at most. This is what
  //    kills the "flash of tracker then 'No run to track yet'" — loading no longer falls through to the
  //    skeleton render, and a param-present URL is decided before any empty state can show. ──
  if (phase === "loading") {
    return (
      <div className="trackrun">
        <div className="container">
          <div className="eyebrow">Live verification run</div>
          <div className="track-waiting"><span className="dir-spin" /> Loading…</div>
        </div>
      </div>
    );
  }

  // ── Key mode, run not started yet: clean waiting state, auto-updates ──
  if (phase === "waiting") {
    return (
      <div className="trackrun">
        <div className="container">
          <div className="eyebrow">Live verification run</div>
          <h1>Waiting for your agent to start its test.</h1>
          <p className="lead">
            This page updates automatically the moment your agent kicks off — no need to refresh.
            Your agent reads the brief and plans first, so a couple of minutes here is normal — that
            thinking happens on its side, and the live run appears here the instant it opens. Not started
            yet? Kick it off from <a href="/start">/start</a> (or paste the key straight into your agent).
          </p>
          <div className="track-waiting"><span className="dir-spin" /> Watching for the run…</div>
        </div>
      </div>
    );
  }

  // ── No run token: explain how to get here ──
  if (phase === "noToken") {
    return (
      <div className="trackrun">
        <div className="container">
          <div className="eyebrow">Live verification run</div>
          <h1>No run to track yet.</h1>
          <p className="lead">
            Start a verification from <a href="/start">/start</a> and your agent&apos;s
            run will open here automatically. If you have a run link, it includes a{" "}
            <code>?run=</code> token.
          </p>
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="trackrun">
        <div className="container">
          <div className="eyebrow">Live verification run</div>
          <h1>That run isn&apos;t available.</h1>
          <p className="lead">{errMsg}</p>
          <a className="btn-report" href="/start">Start a new test →</a>
        </div>
      </div>
    );
  }

  // ── Grading queue: a launch-day rush politely QUEUES rather than crashing. There are a fixed number
  //    of grading slots; when they're all busy the result endpoint tells us this run is waiting in a
  //    FIFO line. Show a distinct "high demand" state (positive framing per the copy firewall — never
  //    "overloaded"/"at capacity") instead of the normal progress bar; the run is graded the moment a
  //    slot frees. Poll cadence already honours retry_after above. (docs/QUEUE-SURFACING.md) ──
  const gq = prog?.grading_queue;
  if (gq?.waiting && gqStreak.current >= 2) {
    return (
      <div className="trackrun">
        <div className="container">
          <div className="eyebrow">Live verification run</div>
          <h1>High demand right now — you&apos;re in line.</h1>
          <p className="lead">
            {gq.position ? <>You&apos;re <strong>#{gq.position}</strong> in line. </> : null}
            Your agent has finished its work — your answers are graded the moment a slot frees up.
            Nothing is lost, and this page updates automatically; no need to refresh.
          </p>
          <div className="track-waiting"><span className="dir-spin" /> Waiting for a grading slot…</div>
        </div>
      </div>
    );
  }

  // ── Derive stage states + tallies from live progress ──
  const p = prog;
  const cp = (p?.checkpoints || {}) as Record<string, unknown>;
  // COMPLETED is the single authoritative terminal signal (status from the self-describing completed
  // poll), NOT the fragile nested attested/anchored flags — the completed response always carries
  // status:"completed", so this drives finalisation of the WHOLE view even if a nested field lags.
  const completed = (p?.status === "completed") || !!doneHandle;
  const graded = p?.tasks_graded ?? 0;
  const total = p?.tasks_total || TOTAL_COMPOSITE_DIMS;
  // On completion every task is graded — reconcile the counter to N/N regardless of what the last poll
  // carried, so the grading stage never reads "0 / 26 graded" on a finished run.
  const dimsDone = completed ? total : Math.min(total, graded);
  const dimPct = total > 0 ? Math.round((dimsDone / total) * 100) : 0;

  const started = !!cp.test_started || !!p?.started_at;
  // Completion implies every downstream milestone is reached, so each of these reads true on a finished
  // run even if its specific field is momentarily absent — the stages then all light "done".
  const batteryDone = completed || (total > 0 && graded >= total);
  // HONEST anchor state (Ant 2026-07-10): true ONLY when a real Bitcoin txid exists — a completed run is
  // NOT enough (the old `completed || …` claimed "anchored" even when the OP_RETURN failed). If the run
  // finished but there's no txid, the anchor genuinely didn't land → surface it, don't fake DONE.
  const anchored = !!p?.anchor?.txid;
  const attested = !!p?.attestation?.attested;

  // Skeleton = we have a token but no live progress yet (first poll, or the run row lagging the
  // redirect from /start). Show the timeline + a moving bar immediately, never an empty screen.
  // ("loading" now returns early above, so a missing progress object is the only skeleton trigger.)
  const isSkeleton = !p;

  // OVERALL PROGRESS is PHASE-based (answering → grading → eval → done), not raw tasks_graded — it
  // reflects where the run IS, moving within the answering phase as the battery lands.
  const runStatus = p?.status || "";
  type Phase4 = "answering" | "grading" | "eval" | "done";
  const phase4: Phase4 =
    attested ? "done"
      : (runStatus === "eval_pending" || anchored) ? "eval"
        : (batteryDone || runStatus === "grading") ? "grading"
          : "answering";
  const PHASE_LABEL: Record<Phase4, string> = { answering: "Answering", grading: "Grading", eval: "Evaluating", done: "Complete" };

  // Live elapsed timer since the run opened. Anchor to the server's started_at when it's present and
  // sane (not in the future beyond a little clock skew); otherwise fall back to when THIS client first
  // saw the run, so the clock + time-based bar never freeze at 0/4% (Ant 2026-07-07).
  const serverStart = parseTs(p?.started_at ?? null);
  const startMs = (serverStart != null && serverStart <= now + 60000) ? serverStart : firstSeen.current;
  // On completion the timer STOPS and shows the run's real total elapsed (completed_at − started_at),
  // not the still-ticking wall clock (which kept counting past completion — Ant 2026-07-08). Falls back
  // to the live tick only while the run is in progress.
  const completedAt = parseTs(p?.completed_at ?? null);
  const endMs = completed ? (completedAt ?? now) : now;
  const elapsed = startMs != null ? fmtElapsed(Math.max(0, endMs - startMs)) : null;

  // OVERALL PROGRESS BAR — deliberately DIVORCED from the lumpy real task progress (which froze at ~4%
  // for minutes then leapt 4%→68% as a phase flipped, reading as "dead"). This is the SMOOTH reassurance
  // layer: a time-based fill that eases from ~4% toward a ~93% ceiling over the estimated run duration,
  // holds there, and snaps to 100% only when the run actually completes. The real, lumpy progress lives
  // where it belongs — the stage timeline + the per-pillar results card below. EST_RUN_MS is the tuning
  // knob (bump it if real runs consistently run longer). `now` ticks every second so this climbs live.
  const EST_RUN_MS = 25 * 60 * 1000; // ~25 min typical full run
  const elapsedMs = startMs != null ? Math.max(0, endMs - startMs) : 0;
  const timeFrac = Math.min(1, elapsedMs / EST_RUN_MS);
  const easedFrac = 1 - Math.pow(1 - timeFrac, 1.7); // ease-out: quick off the line, decelerates to the cap
  const overallPct = phase4 === "done"
    ? 100
    : Math.min(93, Math.max(4, Math.round(4 + easedFrac * 89))); // 4% → ~93% ceiling; snaps to 100 only on done

  // ── Real events feed + real signals for the re-keyed pipeline (Ant 2026-07-08). Each stage lights
  //    active/done ONLY from a real, server-observed signal — no fake advancement. ──
  const events = p?.events || [];
  const proofSeen = events.some((e) => e.type === "proof") || (p?.sovereignty?.pings || []).length > 0;
  const evalSeen = events.some((e) => e.type === "eval");
  const evalCount = p?.eval?.completed;
  const evalDone = anchored || attested; // eval runs before the anchor; once anchored, eval has closed
  const completedRun = phase4 === "done" || !!doneHandle;

  // Stage 1 Run opened — done the moment the run exists.
  // Stage 2 Tasks issued — done once the battery is committed (we always have the total up front).
  const tasksIssuedStage: Stage = total > 0 ? "done" : started ? "active" : "pending";
  // Stage 3 Agent interacting — active while the agent is hitting our endpoints / answering; done once
  // every task has been graded (nothing left for the agent to answer).
  const interactStage: Stage = batteryDone ? "done" : (started || proofSeen) ? "active" : "pending";
  // Stage 4 Grading — active while graded < total and at least one task is in; done when all graded.
  const gradeStage: Stage = batteryDone ? "done" : graded > 0 ? "active" : "pending";
  // Stage 5 Multi-turn evaluation — active once battery grading is done (evals run next) or a scenario
  // has closed; done once the run has anchored (eval precedes the anchor).
  const evalStage: Stage = evalDone ? "done" : (batteryDone || evalSeen) ? "active" : "pending";
  // Stage 6 On-chain anchor — done when the anchor txid exists; active once eval has closed.
  const anchorStage: Stage = anchored ? "done" : evalDone ? "active" : "pending";
  // The run finished but no Bitcoin txid landed → the anchor genuinely failed. Surface it honestly with
  // a recovery path, rather than a fake ✓ (Ant 2026-07-10). Re-anchoring runs automatically server-side.
  const anchorFailed = completedRun && !anchored;
  // Stage 7 Complete — done when the run is complete (attested / handle received).
  const completeStage: Stage = completedRun ? "done" : anchored ? "active" : "pending";

  // Activity-feed rows, newest last (the feed appends downward). Each row carries a stable key and a
  // `fresh` flag — true for events we hadn't seen on the previous poll — so a newly-arrived line gets a
  // one-shot flash/highlight. This is genuinely event-driven: the flash fires only when a REAL new
  // server event lands, never on a timer.
  const feedRows = events.map((e) => {
    const key = `${e.type}:${e.label}:${e.at}`;
    // fresh only AFTER the initial batch (seenEvents non-empty): on the first paint every line is
    // technically unseen, and 40+ rows all typewriting at once reads as a glitch, not liveness —
    // the animation is for events that LAND while you watch (Ant 2026-07-08).
    return { key, ...e, fresh: seenEvents.current.size > 0 && !seenEvents.current.has(key) };
  });

  const tag = (s: Stage, activeLabel = "In progress") =>
    s === "done" ? <span className="stag t-done">Done</span>
      : s === "active" ? <span className="stag t-active">{activeLabel}</span>
        : <span className="stag t-pending">Pending</span>;

  // Per-pillar tally from dimension_progress.
  const progByDim: Record<string, DimProgress> = {};
  for (const dp of p?.dimension_progress || []) progByDim[dp.dimension] = dp;
  const pillarTally = PILLARS.map((pl) => {
    const dims = pl.dims.map((k) => progByDim[k]).filter(Boolean) as DimProgress[];
    const g = dims.reduce((s, d) => s + (d.graded || 0), 0);
    const t = dims.reduce((s, d) => s + (d.total || 0), 0);
    // Per-dimension status, so each NAMED test lights up as it resolves. Longitudinal (cross-run
    // memory) + paid (Sovereignty) dims are flagged UP-FRONT — from the start of the run — as NOT
    // measured this run, so the human sees exactly what is and isn't in play this run (Ant 2026-07-07).
    const dimStatus = pl.dims.map((k) => {
      if (isPaidDim(k)) return { key: k, label: DIM_LABEL[k] || k.replace(/_/g, " "), status: "paid" as DimState, note: "Paid tier", why: "The Sovereignty pillar — real on-chain payments and signatures — comes with continuous verification on the paid tier. It isn't part of the free first test." };
      if (isLongitudinalDim(k)) return { key: k, label: DIM_LABEL[k] || k.replace(/_/g, " "), status: "next" as DimState, note: "Starts next run", why: "Cross-run memory: we plant a marker on this run and check the agent recalls it on the next verification — so it can't be scored from a single run." };
      const dp = progByDim[k];
      const st: DimState = dp && dp.total > 0 && dp.graded >= dp.total ? "done"
        : (p?.current_dimension === k || (dp && dp.graded > 0)) ? "active" : "pending";
      return { key: k, label: DIM_LABEL[k] || k.replace(/_/g, " "), status: st, note: null as string | null, why: null as string | null };
    });
    return { name: pl.name, weight: pl.weight, graded: g, total: t, pct: t > 0 ? Math.round((g / t) * 100) : 0, dims: dimStatus, why: dimStatus.find((d) => d.why)?.why ?? null };
  });

  return (
    <div className="trackrun">
      {/* SOLID hover pop-over — fixed to the viewport, rendered outside the dimmed pillars, clamped so it
          never touches the edge (Ant 2026-07-10). */}
      {tip && (
        <div
          className="track-pop"
          style={{
            left: Math.min(Math.max(tip.x, 148), (typeof window !== "undefined" ? window.innerWidth : 1280) - 148),
            top: tip.y - 12,
          }}
        >
          {tip.text}
        </div>
      )}
      <div className="container">
        <div className="eyebrow">Live verification run</div>
        <h1>{p?.display_name ? `${p.display_name} is being verified` : "Your agent is being verified"}</h1>
        <p className="lead">
          Verification runs server-side — you don&apos;t need to wait at the screen. A full run
          takes roughly <strong>{TEST_DURATION_LABEL}</strong>; we&apos;ll email you when the report is live.
        </p>

        {/* RUN STATUS — the verification-run header and overall progress joined into one card. */}
        <div className="runcard">
          <div className="runhead-row">
            <div className="agent">
              <div className="badge">{isSkeleton ? "…" : "▶"}</div>
              <div>
                <div className="aname">Verification run</div>
                <div className="ahandle">{runToken ? `${runToken.slice(0, 12)}…` : ""}</div>
              </div>
            </div>
            <div className="meta">
              <div className="m">
                <span className="mlab">Status</span>
                <span className="mval"><span className={`live${phase4 === "done" ? " done" : ""}`}><span className="dot" />{isSkeleton ? "Starting…" : PHASE_LABEL[phase4]}</span></span>
              </div>
              <div className="m">
                <span className="mlab">Elapsed</span>
                <span className="mval">{elapsed ?? "0:00"}</span>
              </div>
            </div>
          </div>

          <div className="overall">
            <div className="row">
              <span className="lbl">Overall progress · {PHASE_LABEL[phase4]}</span>
              {/* No ambient dots here (removed, Ant 2026-07-08) — the feed's watch-line spinner is
                  the page's one "we're alive" indicator. */}
              <span className="pct">{overallPct}%</span>
            </div>
            <div className={`pbar${isSkeleton ? " indet" : ""}`}>
              <i style={{ width: `${isSkeleton ? 18 : overallPct}%` }} />
            </div>
            <div className="phasetrack">
              {(["answering", "grading", "eval", "done"] as Phase4[]).map((ph) => {
                const idx: Record<Phase4, number> = { answering: 0, grading: 1, eval: 2, done: 3 };
                const cls = idx[ph] < idx[phase4] ? "done" : idx[ph] === idx[phase4] ? "active" : "pending";
                return <span key={ph} className={`ph ph-${cls}`}>{PHASE_LABEL[ph]}</span>;
              })}
            </div>
          </div>
        </div>

        {/* RECALL-REBIND notice — this run bound to an existing identity (the agent presented its recall
            code), so a different name entered at setup was NOT applied. Surfaced so it's never silent. */}
        {!!cp.recall_rebind && (
          <div className="recallnote">
            <span className="recallnote-ic">♻️</span>
            <div>
              <b>Recognised as {String(cp.recall_name || "this agent")}{cp.recall_handle ? ` (${String(cp.recall_handle)})` : ""} from its recall code.</b>
              <p>Refreshing this agent&apos;s score rather than creating a new one — an agent keeps one identity, so a new name entered at setup wasn&apos;t applied.</p>
            </div>
          </div>
        )}

        {/* LIVE ACTIVITY FEED — real, Verigent-observed events line-by-line, newest appended, each new
            line flashing once as it lands. Sits between the run card and the stage timeline. Only real
            server events (endpoint hits, dimensions graded, eval scenarios closing, anchor) — never
            fabricated activity (Constitution §2: transparency IS the brand). */}
        {/* LIVE ACTIVITY — COMPACT TICKER by default (Ant 2026-07-08: the full log was height-hungry
            and read as dead between real events). Compact = the latest real event + an always-moving
            "watching" line fed by the real poll cadence; the toggle opens the full scrolling log.
            Still only REAL events — the watch line surfaces the genuine checks we make, never
            fabricated activity (Constitution §2). */}
        <div className={`actfeed${completed ? "" : " actfeed-live"}`}>
          <div className="actfeed-head">
            {/* Small pulsing dot marks this as THE live-updating area (subtle, per Ant 2026-07-08). */}
            {!completed && <span className="actfeed-dot" aria-hidden="true" />}
            <h3>Live activity</h3>
            <span className="actfeed-sub">
              {/* While the agent is answering locally (nothing graded yet), read "loaded & armed", not
                  "quiet start": the full REAL board — tasks dispatched, dimensions queued (Ant 2026-07-08). */}
              {phase4 === "answering" && graded === 0 && total > 0
                ? `${total} tasks dispatched · ${TOTAL_COMPOSITE_DIMS} dimensions queued`
                : "observed events, as they happen"}
            </span>
            {feedRows.length > 1 && (
              <button type="button" className="actfeed-toggle" onClick={() => setFeedOpen((o) => !o)}>
                {feedOpen ? "Latest only" : `All ${feedRows.length} events ↓`}
              </button>
            )}
          </div>
          <ul className="actlog">
            {feedRows.length === 0 ? (
              <li className="actline actline-idle">
                <span className="actbolt">◦</span>
                <span className="acttext">Your agent is answering {total > 0 ? total : "its"} tasks now — the live scoring feed lights up the moment it submits, then fills fast.</span>
              </li>
            ) : (
              (feedOpen ? feedRows : feedRows.slice(-1)).map((r) => (
                <li key={r.key} className={`actline act-${r.type}${r.fresh ? " act-fresh" : ""}`}>
                  <span className="actbolt">⚡</span>
                  {/* act-type = one-shot per-character typewriter reveal on REAL new events only (the
                      animation is presentation; the events are genuine). Reduced-motion kills it in CSS. */}
                  <span className={`acttext${r.fresh ? " act-type" : ""}`}>{r.label}</span>
                  <span className="actat">{fmtClock(r.at)}</span>
                </li>
              ))
            )}
            {/* Always-alive WATCH LINE showing the REAL mechanic (Ant 2026-07-08): we poll the run
                every 3.5 seconds, so the line cycles honestly with it — "checking…" (spinner) as the
                next check fires, then "✓ checked" when it lands. Never motionless, never fabricated:
                the cycle IS the poll. */}
            {!completed && lastPollAt != null && (() => {
              const checking = now - lastPollAt >= 2500; // next 3.5s check is due/firing
              return (
                <li className="actline actline-watch">
                  <span className="actbolt">{checking ? <span className="actspin" aria-hidden="true" /> : <span className="actcheck">✓</span>}</span>
                  <span className="acttext">
                    {checking ? "checking your agent's run…" : "checked — up to date"}
                    {" · we check every 3.5s"}
                    {phase4 === "answering" && graded === 0 ? " — your agent is working on its own side; results land here the moment we observe them" : ""}
                  </span>
                  <span className="actat">{fmtClock(new Date(lastPollAt).toISOString())}</span>
                </li>
              );
            })()}
          </ul>
        </div>

        {/* timeline + tally */}
        <div className="layout">
          {/* STAGE TIMELINE — re-keyed to the REAL pipeline; each stage lights active/done only from its
              own real signal (Ant 2026-07-08). No fake advancement. */}
          <div className="panel">
            <h3>Stage timeline</h3>
            <div className="stages">
              <div className="stage-item done">
                <div className="ico">✓</div>
                <div className="body">
                  <div className="slab">Run opened</div>
                  <div className="sdesc">
                    Test key checked and bound to this run. Agent identity entered
                    at activation.
                  </div>
                  <span className="stag t-done">Done</span>
                </div>
              </div>

              <div className={`stage-item ${tasksIssuedStage}`}>
                <div className="ico">{tasksIssuedStage === "done" ? "✓" : "2"}</div>
                <div className="body">
                  <div className="slab">Tasks issued</div>
                  <div className="sdesc">
                    The full battery is committed up front, then revealed — so the
                    test can&apos;t be tailored after the fact.
                    {total > 0 && <> <strong>{total}</strong> tasks issued to your agent.</>}
                  </div>
                  {tag(tasksIssuedStage, "Issuing")}
                </div>
              </div>

              <div className={`stage-item ${interactStage}`}>
                <div className="ico">{interactStage === "done" ? "✓" : "3"}</div>
                <div className="body">
                  <div className="slab">Agent interacting</div>
                  <div className="sdesc">
                    Your agent works the battery on its own side and hits our live
                    endpoints — observed traces, not self-report.
                    {p?.current_dimension && interactStage === "active" && (
                      <> Currently: <strong>{p.current_dimension.replace(/_/g, " ")}</strong>.</>
                    )}
                    {interactStage === "active" && (
                      <> Each endpoint hit appears in the live activity log above. Your agent answers the
                      whole battery on its own side before submitting — the scoring feed lights up the
                      moment it submits, then fills fast.</>
                    )}
                  </div>
                  {tag(interactStage, "Interacting")}
                </div>
              </div>

              <div className={`stage-item ${gradeStage}`}>
                <div className="ico">{gradeStage === "done" ? "✓" : "4"}</div>
                <div className="body">
                  <div className="slab">Grading</div>
                  <div className="sdesc">
                    Independent judges score each dimension from the observed
                    evidence. &ldquo;Show me, don&apos;t tell me.&rdquo;
                  </div>
                  <div className="minibar">
                    <i style={{ width: `${dimPct}%` }}></i>
                  </div>
                  <div className="minimeta">{dimsDone} / {total} graded</div>
                  {tag(gradeStage, "Scoring")}
                </div>
              </div>

              <div className={`stage-item ${evalStage}`}>
                <div className="ico">{evalStage === "done" ? "✓" : "5"}</div>
                <div className="body">
                  <div className="slab">Multi-turn evaluation</div>
                  <div className="sdesc">
                    Stateful and adversarial scenarios run over multiple turns —
                    testing what a single-shot task can&apos;t.
                    {typeof evalCount === "number" && evalCount > 0 && (
                      <> <strong>{evalCount}</strong> scenario{evalCount === 1 ? "" : "s"} closed.</>
                    )}
                  </div>
                  {tag(evalStage, "Evaluating")}
                </div>
              </div>

              <div className={`stage-item ${anchorFailed ? "failed" : anchorStage}`}>
                <div className="ico">{anchorStage === "done" ? "✓" : anchorFailed ? "!" : "6"}</div>
                <div className="body">
                  <div className="slab">On-chain anchor</div>
                  <div className="sdesc">
                    Your result and VG key are anchored to Bitcoin (OP_RETURN) so
                    anyone can verify it independently.
                  </div>
                  {anchored && p?.anchor?.txid && (
                    <>
                      <div className="attest-live">Anchored on-chain — confirmation link available.</div>
                      <span className="commit-hash">
                        <a href={`https://mempool.space/tx/${p.anchor.txid}`} target="_blank" rel="noopener noreferrer">
                          View anchor tx {p.anchor.txid.slice(0, 10)}…{p.anchor.txid.slice(-8)} ↗
                        </a>
                      </span>
                    </>
                  )}
                  {anchorFailed && (
                    <div className="anchor-fail">
                      The Bitcoin anchor hasn&apos;t landed yet — your scores are final and your registry
                      entry is live, but the on-chain proof is still pending. We re-attempt it automatically;
                      if it doesn&apos;t clear shortly, email <a href="mailto:verify@verigent.ai">verify@verigent.ai</a> with
                      your key and we&apos;ll re-anchor it.
                    </div>
                  )}
                  <div>{anchorFailed ? tag("pending", "Anchor pending") : tag(anchorStage, "Anchoring")}</div>
                </div>
              </div>

              <div className={`stage-item ${completeStage}`}>
                <div className="ico">{completeStage === "done" ? "✓" : "7"}</div>
                <div className="body">
                  <div className="slab">Complete</div>
                  <div className="sdesc">
                    Your live agent page is up with clickable on-chain evidence
                    per stage. We&apos;ve emailed you the link.
                  </div>
                  {attested && p?.attestation?.txid && (
                    <>
                      <div className="attest-live">Your test has been attested — attestation link available.</div>
                      <span className="commit-hash">
                        <a href={`https://mempool.space/tx/${p.attestation.txid}`} target="_blank" rel="noopener noreferrer">
                          {p.attestation.vg_code ? `${p.attestation.vg_code} · ` : ""}View attestation {p.attestation.txid.slice(0, 10)}…{p.attestation.txid.slice(-8)} ↗
                        </a>
                      </span>
                    </>
                  )}
                  {/* Completion CTA. Signed-in owner → straight to their report. Not signed in → an INLINE
                      email→code login RIGHT HERE (Ant 2026-07-10), landing them on their FULL logged-in
                      report on success. No bounce to the public page. */}
                  <div className="publishrow">
                    {!doneHandle ? (
                      <span className="btn-view locked" aria-disabled="true">View report — locked until done</span>
                    ) : ownerAuthed ? (
                      <a className="btn-view" href={`/agent/${encodeURIComponent(doneHandle)}?welcome=1`}>View your report →</a>
                    ) : loginStage === "idle" ? (
                      <button className="btn-view" onClick={() => setLoginStage("email")}>Log in to view your report →</button>
                    ) : (
                      <div className="track-login">
                        <p className="track-login-lead">
                          {loginStage === "email"
                            ? "Enter the owner email — we'll send a one-time code."
                            : `Code sent to ${loginEmail}. Enter it to open your full report.`}
                        </p>
                        <div className="track-login-row">
                          <input
                            className="track-login-field"
                            type={loginStage === "email" ? "email" : "text"}
                            inputMode={loginStage === "email" ? "email" : "text"}
                            autoCapitalize={loginStage === "email" ? "none" : "characters"}
                            placeholder={loginStage === "email" ? "Your owner email" : "Enter your code"}
                            value={loginStage === "email" ? loginEmail : loginCode}
                            onChange={(e) => (loginStage === "email" ? setLoginEmail(e.target.value) : setLoginCode(e.target.value))}
                            onKeyDown={(e) => { if (e.key === "Enter") (loginStage === "email" ? loginRequestCode() : loginVerify()); }}
                            autoFocus
                          />
                          <button
                            className="btn-view"
                            disabled={loginBusy || (loginStage === "email" ? !loginEmail.includes("@") : !loginCode.trim())}
                            onClick={() => (loginStage === "email" ? loginRequestCode() : loginVerify())}
                          >
                            {loginBusy ? "…" : loginStage === "email" ? "Send code →" : "Sign in →"}
                          </button>
                        </div>
                        {loginErr && <p className="track-login-err">{loginErr}</p>}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* PER-PILLAR TALLY */}
          <div className="panel">
            <h3>Results coming in</h3>

            {pillarTally.map((pt) => (
              <div className="factor" key={pt.name} style={!pt.total ? { opacity: 0.42 } : undefined}>
                <div className="brow">
                  <span className="bname">{pt.name}</span>
                  <span className={`bcount${!pt.total && pt.why ? " track-tip" : ""}`} onMouseEnter={(e) => { if (!pt.total) showTip(e, pt.why); }} onMouseLeave={hideTip}>{!pt.total ? "not tested" : `${pt.graded} / ${pt.total}`}</span>
                </div>
                <div className="bbar">
                  <i style={{ width: `${pt.pct}%` }}></i>
                </div>
                <span className="bweight">composite weight {pt.weight}</span>
                <ul className="dimlist">
                  {pt.dims.map((d) => (
                    <li key={d.key} className={`dim-${d.status}`} title={d.why ? undefined : d.label}>
                      <span className="dim-ico">{d.status === "done" ? "✓" : d.status === "active" ? "" : d.status === "next" || d.status === "paid" ? "◦" : "·"}</span>
                      <span className="dim-name">{d.label}</span>
                      {d.note && <span className={`dim-note${d.why ? " track-tip" : ""}`} onMouseEnter={(e) => showTip(e, d.why)} onMouseLeave={hideTip}>{d.note}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* failure microcopy */}
        <div className="failnote">
          <h4>If something goes wrong</h4>
          <ul>
            <li>
              <strong>Transient failure</strong> (timeout, network, server) — your
              key stays valid. Just restart with the <strong>same key</strong>, no
              extra cost.
            </li>
            <li>
              <strong>Structural failure</strong> (our bug) — email{" "}
              <a href="mailto:verify@verigent.ai">verify@verigent.ai</a> with your
              test key and we&apos;ll re-issue a new one.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
