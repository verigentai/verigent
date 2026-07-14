// GET /api/result/:run_token — Return a run's outcome, radar profile, and class assignment

import { credentialSemantics } from '../../lib/credential-semantics';
import { nextRunAnswers } from '../../lib/next-run-answers';

// Constant-time string compare for the pull_token gate — no early bailout on the first differing char,
// so the compare leaks no timing signal about how much matched (Codex M1). Length check is acceptable
// (token length is not the secret). Mirrors admin-auth.ts timingSafeEqualHex.
function timingSafeStrEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface Env {
  DB: D1Database;
}

// Human-readable labels for the real proof_type values recorded when the agent hits our endpoints.
// Anything unmapped falls back to a neutral "endpoint probe observed" (never invented specifics).
const PROOF_LABEL: Record<string, string> = {
  skill_fetch: 'skill probe: fetch',
  skill_http: 'skill probe: HTTP call',
  skill_auth: 'skill probe: auth',
  tool_debug: 'tool-debug branch observed',
  recover_flaky: 'recovery retry observed',
  recover_auth_shift: 'auth-shift recovery observed',
  multi_agent_delegation: 'multi-agent delegation observed',
  channel_code_registered: 'channel code registered',
  workflow_data_fetch: 'workflow: data fetched',
  workflow_source_a: 'workflow: source A read',
  workflow_source_b: 'workflow: source B read',
  workflow_merge: 'workflow: sources merged',
  workflow_action_a: 'workflow branch A verified',
  workflow_action_b: 'workflow branch B verified',
  workflow_challenge_issued: 'workflow challenge issued',
  workflow_check_issued: 'workflow guard-check issued',
  workflow_answer: 'workflow: answer submitted',
  workflow_submit: 'workflow: result submitted',
};

// Build the time-ordered feed of REAL, Verigent-observed events for the live /track activity log, and
// the per-dimension progress rows, from the run's server-recorded tables. Shared by BOTH the running
// (202) and completed (200) responses so a COMPLETED poll is fully self-describing — the client never
// has to fabricate a feed or fall back to stale running-poll data (Constitution §2: transparency IS
// the brand; §2.1 proof-or-zero). Every entry is sourced from a row we actually recorded.
async function buildLiveProgress(db: D1Database, runToken: string, run: any) {
  const [dimProgress, evalResults, skillProofs] = await Promise.all([
    db.prepare('SELECT dimension, COUNT(*) as total, SUM(CASE WHEN graded_at IS NOT NULL THEN 1 ELSE 0 END) as graded, MAX(graded_at) as last_graded_at FROM run_tasks WHERE run_token = ? GROUP BY dimension').bind(runToken).all(),
    db.prepare('SELECT scenario_id, eval_type, dimension, score, turn_count, created_at, unmeasured FROM eval_results WHERE run_token = ?').bind(runToken).all(),
    // Real interactive-endpoint hits the agent makes while working (skill probes, workflow branches,
    // recovery retries, channel registration). These are the only server-OBSERVED events during the
    // long answering phase — the agent's own reasoning happens on its side and we never fabricate it.
    // Cap at the 30 most recent so the poll stays cheap. (docs/PUBLIC-BOUNDARY.md: exam hall is public.)
    db.prepare('SELECT proof_type, received_at FROM skill_proofs WHERE run_token = ? ORDER BY id DESC LIMIT 30').bind(runToken).all().catch(() => ({ results: [] })),
  ]);

  const events: { type: string; label: string; at: string }[] = [];
  // Seed the feed with the IMMEDIATE real events so it is never blank (Ant 2026-07-08): the run
  // opening and the battery being issued ARE Verigent-observed facts (the run/tasks endpoints were
  // hit), recorded at started_at. Not fabrication — the earliest two rows of the real timeline.
  if (run.started_at) {
    events.push({ type: 'open', label: 'run opened — test key verified', at: run.started_at });
    const issued = ((dimProgress.results || []) as any[]).reduce((s, d) => s + (d.total || 0), 0);
    if (issued > 0) events.push({ type: 'open', label: `${issued} tasks issued to the agent`, at: run.started_at });
  }
  // The agent's interactive endpoint hits.
  for (const sp of (skillProofs.results || []) as any[]) {
    events.push({ type: 'proof', label: PROOF_LABEL[sp.proof_type] || 'endpoint probe observed', at: sp.received_at });
  }
  // Dimensions as they finish grading — one event when a dimension's last task is graded.
  for (const d of (dimProgress.results || []) as any[]) {
    if (d.total > 0 && d.graded >= d.total && d.last_graded_at) {
      events.push({ type: 'dimension', label: `graded: ${String(d.dimension).replace(/_/g, ' ')}`, at: d.last_graded_at });
    }
  }
  // Multi-turn eval scenarios as they close.
  for (const e of (evalResults.results || []) as any[]) {
    if (e.created_at) {
      events.push({ type: 'eval', label: `scenario closed: ${String(e.dimension).replace(/_/g, ' ')}`, at: e.created_at });
    }
  }
  // The on-chain anchor, when it fires.
  if (run.anchored_at) {
    events.push({ type: 'anchor', label: 'attestation anchored on-chain', at: run.anchored_at });
  }
  // Sort ascending by time (newest last, so the feed appends), then keep the most recent slice. On a
  // COMPLETED run we keep the full ordered set (bounded — the run is done) so the terminal feed shows
  // the whole real sequence: the early endpoint proofs AND the later graded-dimensions/evals/anchor,
  // never dropping the oldest proofs off a 30-cap (Ant 2026-07-08). Mid-run stays capped for cheap polls.
  const evParse = (s: string): number => { const t = Date.parse(/[TZ]/.test(s) ? s : s.replace(' ', 'T') + 'Z'); return Number.isNaN(t) ? 0 : t; };
  events.sort((a, b) => evParse(a.at) - evParse(b.at));
  const cap = run.status === 'completed' ? 120 : 30;

  return {
    dimProgressRows: (dimProgress.results || []) as any[],
    evalRows: (evalResults.results || []) as any[],
    events: events.slice(-cap),
  };
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  // The path token is EITHER the private run_token (the agent) OR the public track_token (the /track
  // watch link) — Codex C2/C3. Resolve the run by either; all sub-queries below use the REAL run_token.
  // The public view is identical for both; only the next-run answers (below) are pull_token-gated, and a
  // track_token holder never has the agent's pull_token, so this stays safe.
  const tokenParam = context.params.run_token as string;
  if (!tokenParam) {
    return Response.json({ error: 'run_token is required' }, { status: 400 });
  }

  const db = context.env.DB;

  const run = await db.prepare('SELECT * FROM runs WHERE run_token = ? OR track_token = ?').bind(tokenParam, tokenParam).first() as any;
  if (!run) {
    return Response.json({ error: 'INVALID_RUN_TOKEN' }, { status: 404 });
  }
  const runToken = run.run_token as string;
  // The caller may have arrived via the PRIVATE run_token (the agent) or the PUBLIC track_token (the
  // /track watch link). All sub-queries use the real runToken internally, but the RESPONSE must never
  // hand the private run_token to a track_token holder (Codex 2026-07-10) — echo back the token they
  // actually presented instead. Constant-time to avoid a token-oracle on the compare.
  const suppliedPrivate = timingSafeStrEqual(tokenParam, runToken);
  const echoToken = suppliedPrivate ? runToken : (run.track_token as string | null) ?? tokenParam;

  if (run.status !== 'completed') {
    const [taskCount, gradedCount, currentDim, dimProgress, pings, webhooks, evalResults, channels, skillProofs] = await Promise.all([
      db.prepare('SELECT COUNT(*) as total FROM run_tasks WHERE run_token = ?').bind(runToken).first() as any,
      db.prepare('SELECT COUNT(*) as graded FROM run_tasks WHERE run_token = ? AND graded_at IS NOT NULL').bind(runToken).first() as any,
      db.prepare('SELECT dimension FROM run_tasks WHERE run_token = ? AND graded_at IS NULL LIMIT 1').bind(runToken).first() as any,
      db.prepare('SELECT dimension, COUNT(*) as total, SUM(CASE WHEN graded_at IS NOT NULL THEN 1 ELSE 0 END) as graded, MAX(graded_at) as last_graded_at FROM run_tasks WHERE run_token = ? GROUP BY dimension').bind(runToken).all(),
      db.prepare('SELECT nonce, received_at FROM sovereignty_pings WHERE run_token = ?').bind(runToken).all(),
      db.prepare('SELECT endpoint_url, response_received, response_at FROM sovereignty_webhooks WHERE run_token = ?').bind(runToken).all(),
      db.prepare('SELECT scenario_id, eval_type, dimension, score, turn_count, created_at, unmeasured FROM eval_results WHERE run_token = ?').bind(runToken).all(),
      db.prepare('SELECT agent_code, user_code, verified_at FROM channel_codes WHERE run_token = ?').bind(runToken).all().catch(() => ({ results: [] })),
      // Real interactive-endpoint hits the agent makes while working (skill probes, workflow branches,
      // recovery retries, channel registration). These are the only server-OBSERVED events during the
      // long answering phase — the agent's own reasoning happens on its side and we never fabricate it.
      // Cap at the 30 most recent so the poll stays cheap. (docs/PUBLIC-BOUNDARY.md: exam hall is public.)
      db.prepare('SELECT proof_type, received_at FROM skill_proofs WHERE run_token = ? ORDER BY id DESC LIMIT 30').bind(runToken).all().catch(() => ({ results: [] })),
    ]);

    let sovereigntyResults: Record<string, any> = {};
    try { sovereigntyResults = JSON.parse(run.sovereignty_results || '{}'); } catch {}

    let checkpoints: Record<string, any> = {};
    try { checkpoints = JSON.parse(run.checkpoints || '{}'); } catch {}

    // Agent display name — the live tracker heads the page with "<name> is being verified".
    const agentRow = await db.prepare('SELECT display_name FROM agents WHERE agent_id = ?').bind(run.agent_id).first() as any;

    // Grading-queue position — surfaced so /track can show "all slots busy, you're #N, resuming
    // shortly" instead of an apparently-stuck bar when the run is waiting for a grading slot
    // (grade-queue caps concurrent grading at grade_concurrency.max_active). Best-effort; waiting=false
    // when the run holds a slot / isn't queued. Copy firewall: positive "high demand" framing only.
    const gq = await (await import('../../lib/grade-queue')).queuePosition(db, runToken);

    // ── events[] — a time-ordered feed of REAL, Verigent-observed events for the live /track activity
    // log. Every entry is sourced from a row we actually recorded — never fabricated (Constitution §2:
    // transparency IS the brand; §2.1 proof-or-zero). Four sources: the agent's interactive endpoint
    // hits (skill_proofs.received_at), dimensions as their last task finishes grading, multi-turn eval
    // scenarios as they close, and the anchor when it fires. Capped to the most recent ~30, newest last.
    const events: { type: string; label: string; at: string }[] = [];

    // Seed the feed with the IMMEDIATE real events so it is never blank while the agent answers
    // locally (Ant 2026-07-08): the run opening and the battery being issued ARE Verigent-observed
    // facts (the run/tasks endpoints were hit), recorded at started_at.
    if (run.started_at) {
      events.push({ type: 'open', label: 'run opened — test key verified', at: run.started_at });
      if ((taskCount?.total || 0) > 0) {
        events.push({ type: 'open', label: `${taskCount.total} tasks issued to the agent`, at: run.started_at });
      }
    }

    // Human-readable labels for the real proof_type values recorded when the agent hits our endpoints.
    // Anything unmapped falls back to a neutral "endpoint probe observed" (never invented specifics).
    const PROOF_LABEL: Record<string, string> = {
      skill_fetch: 'skill probe: fetch',
      skill_http: 'skill probe: HTTP call',
      skill_auth: 'skill probe: auth',
      tool_debug: 'tool-debug branch observed',
      recover_flaky: 'recovery retry observed',
      recover_auth_shift: 'auth-shift recovery observed',
      channel_code_registered: 'channel code registered',
      workflow_data_fetch: 'workflow: data fetched',
      workflow_source_a: 'workflow: source A read',
      workflow_source_b: 'workflow: source B read',
      workflow_merge: 'workflow: sources merged',
      workflow_action_a: 'workflow branch A verified',
      workflow_action_b: 'workflow branch B verified',
      workflow_challenge_issued: 'workflow challenge issued',
      workflow_check_issued: 'workflow guard-check issued',
      workflow_answer: 'workflow: answer submitted',
      workflow_submit: 'workflow: result submitted',
    };
    for (const sp of (skillProofs.results || []) as any[]) {
      events.push({
        type: 'proof',
        label: PROOF_LABEL[sp.proof_type] || 'endpoint probe observed',
        at: sp.received_at,
      });
    }
    // Dimensions as they finish grading — one event when a dimension's last task is graded.
    for (const d of (dimProgress.results || []) as any[]) {
      if (d.total > 0 && d.graded >= d.total && d.last_graded_at) {
        events.push({ type: 'dimension', label: `graded: ${String(d.dimension).replace(/_/g, ' ')}`, at: d.last_graded_at });
      }
    }
    // Multi-turn eval scenarios as they close.
    for (const e of (evalResults.results || []) as any[]) {
      if (e.created_at) {
        events.push({ type: 'eval', label: `scenario closed: ${String(e.dimension).replace(/_/g, ' ')}`, at: e.created_at });
      }
    }
    // The on-chain anchor, when it fires.
    if (run.anchored_at) {
      events.push({ type: 'anchor', label: 'attestation anchored on-chain', at: run.anchored_at });
    }
    // Sort ascending by time (newest last, so the feed appends), then keep the most recent ~30.
    const evParse = (s: string): number => { const t = Date.parse(/[TZ]/.test(s) ? s : s.replace(' ', 'T') + 'Z'); return Number.isNaN(t) ? 0 : t; };
    events.sort((a, b) => evParse(a.at) - evParse(b.at));
    const recentEvents = events.slice(-30);

    return Response.json({
      error: 'RUN_NOT_COMPLETE',
      status: run.status,
      grading_queue: gq.waiting
        ? { waiting: true, position: gq.position, ahead: gq.ahead, retry_after: gq.retry_after }
        : { waiting: false },
      // Fall back to a title-cased agent_id when the agent didn't send a display_name, so the live
      // page reads "Baymax is being verified", never the generic "Your agent…" (Ant 2026-07-08).
      display_name: agentRow?.display_name
        || (run.agent_id ? String(run.agent_id).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) : null),
      started_at: run.started_at,
      expires_at: run.expires_at,
      tasks_graded: gradedCount?.graded || 0,
      tasks_served: run.tasks_served || 0,
      tasks_total: taskCount?.total || 0,
      current_dimension: currentDim?.dimension || null,
      sovereignty: {
        results: sovereigntyResults,
        pings: (pings.results || []).map((p: any) => ({ nonce: p.nonce, received_at: p.received_at })),
        webhooks: (webhooks.results || []).map((w: any) => ({ url: w.endpoint_url, received: !!w.response_received, at: w.response_at })),
        channels: (channels.results || []).map((c: any) => ({ code: c.agent_code, confirmed: !!c.verified_at, confirmed_at: c.verified_at })),
      },
      anchor: {
        txid: run.anchor_txid || null,
        status: run.anchor_status || null,
        anchored_at: run.anchored_at || null,
      },
      attestation: {
        included: !!run.includes_attestation,
        attested: !!run.attested,
        txid: run.attestation_txid || null,
        vg_code: run.attestation_vg_code || null,
        attested_at: run.attested_at || null,
      },
      eval: {
        completed: (evalResults.results || []).length,
        results: (evalResults.results || []).map((e: any) => ({
          scenario_id: e.scenario_id,
          eval_type: e.eval_type,
          dimension: e.dimension,
          // Unmeasured (total evaluator outage) scenarios are EXCLUDED from the composite; surface that
          // honestly rather than as a real score:0 the agent didn't earn (Codex M2).
          score: e.unmeasured ? null : e.score,
          unmeasured: !!e.unmeasured,
          turn_count: e.turn_count,
        })),
      },
      dimension_progress: (dimProgress.results || []).map((d: any) => ({
        dimension: d.dimension,
        total: d.total,
        graded: d.graded,
      })),
      events: recentEvents,
      agent_id: run.agent_id || null,
      checkpoints,
    }, { status: 202 });
  }

  // Get per-task details
  const tasks = await db.prepare(
    'SELECT task_id, dimension, median_score, declined, decline_reason, latency_ms FROM run_tasks WHERE run_token = ?'
  ).bind(runToken).all();

  // Get agent info for test history
  const history = await db.prepare(
    'SELECT composite_score, tier, primary_class, class_scores, completed_at FROM test_history WHERE agent_id = ? ORDER BY completed_at DESC LIMIT 3'
  ).bind(run.agent_id).all();

  // Get registry rank (table renamed leaderboard → registry)
  const rank = await db.prepare(
    'SELECT COUNT(*) as rank FROM registry WHERE composite_score > ? AND listed = 1'
  ).bind(run.composite_score).first() as any;

  // Live-shape progress fields — the SAME feed / dimension_progress / eval / anchor / attestation the
  // running (202) response carries, so a COMPLETED poll is fully self-describing. Without these the
  // /track client (which merges each poll onto the prior one) froze the badge, stages, feed and grading
  // counter on the last-seen running data because the completed response omitted them (Ant 2026-07-08).
  const live = await buildLiveProgress(db, runToken, run);
  const totalTasks = live.dimProgressRows.reduce((s, d) => s + (d.total || 0), 0);
  const gradedTasks = live.dimProgressRows.reduce((s, d) => s + (d.graded || 0), 0);

  const response: Record<string, any> = {
    run_token: echoToken,
    agent_id: run.agent_id,
    display_name: null as string | null,
    status: 'completed',
    // ── Live-run display fields (mirror the 202 shape) — so /track can FINALISE the whole live view
    //    from a single completed poll: every stage done, feed populated with the real observed events,
    //    grading counter at N/N, progress 100%, timer frozen at the real elapsed. ──
    started_at: run.started_at,
    completed_at: run.completed_at,
    tasks_served: run.tasks_served || 0,
    tasks_graded: gradedTasks,
    tasks_total: totalTasks,
    current_dimension: null,
    dimension_progress: live.dimProgressRows.map((d) => ({ dimension: d.dimension, total: d.total, graded: d.graded })),
    events: live.events,
    eval: { completed: live.evalRows.length, results: live.evalRows.map((e) => ({ scenario_id: e.scenario_id, eval_type: e.eval_type, dimension: e.dimension, score: e.unmeasured ? null : e.score, unmeasured: !!e.unmeasured, turn_count: e.turn_count })) },
    anchor: { txid: run.anchor_txid || null, status: run.anchor_status || null, anchored_at: run.anchored_at || null },
    attestation: { included: !!run.includes_attestation, attested: !!run.attested, txid: run.attestation_txid || null, vg_code: run.attestation_vg_code || null, attested_at: run.attested_at || null },
    composite: run.composite_score,
    tier: run.tier,
    primary_class: run.primary_class,
    // Score provenance (commit-reveal): the battery version hash this run scored under. null = the run
    // predates the transparency log (surfaced as "pre-transparency", never faked). Read-only citation.
    battery_hash: run.battery_hash ?? null,
    model_avg: run.model_avg,
    agent_avg: run.agent_avg,
    sovereignty_avg: (() => {
      const dims = JSON.parse(run.dimension_scores || '{}');
      const sovKeys = ['financial_sovereignty', 'identity_sovereignty', 'infrastructure_independence', 'data_sovereignty', 'interoperability', 'governance_autonomy'];
      const vals = sovKeys.map(k => dims[k]).filter((v: any) => v != null) as number[];
      return vals.length > 0 ? Math.round((vals.reduce((a: number, b: number) => a + b, 0) / vals.length) * 100) / 100 : null;
    })(),
    per_dimension: JSON.parse(run.dimension_scores || '{}'),
    class_scores: JSON.parse(run.class_scores || '{}'),
    run_conditions: JSON.parse(run.run_conditions || '{}'),
    // Per-dimension measurement status (display contract, grade-batch finalize →
    // checkpoints.dimension_status): { "<dim>": "pending" } for dims NOT measured this run
    // (e.g. session_continuity on a first run — no prior plant to recall). Additive: absent ⇒
    // every dim shown was measured. The result page renders pending dims faded + "starts next run".
    // rubric_version (grade-batch finalize → checkpoints.rubric_version): the scoring-band version
    // this run graded under (§2.4 — a result is a dated snapshot under the rubric it ran on). Absent
    // ⇒ pre-stamp run; surfaced so the report can show which rubric produced the score.
    ...((): Record<string, any> => {
      try {
        const cp = JSON.parse(run.checkpoints || '{}');
        const out: Record<string, any> = {};
        if (cp.dimension_status) out.dimension_status = cp.dimension_status;
        if (cp.rubric_version) out.rubric_version = cp.rubric_version;
        return out;
      } catch { return {}; }
    })(),
    registry_rank: (rank?.rank ?? 0) + 1,
    includes_attestation: !!run.includes_attestation,
    attested: !!run.attested,
    attestation_txid: run.attestation_txid || null,
    attestation_vg_code: run.attestation_vg_code || null,
    tasks: (tasks.results || []).map((t: any) => ({
      task_id: t.task_id,
      dimension: t.dimension,
      score: t.median_score,
      declined: !!t.declined,
      latency_ms: t.latency_ms,
    })),
    recent_history: (history.results || []).map((h: any) => ({
      composite: h.composite_score,
      tier: h.tier,
      primary_class: h.primary_class,
      class_scores: JSON.parse(h.class_scores || '{}'),
      tested_at: h.completed_at,
    })),
    // (duplicate `completed_at` removed here, review I1/2026-07-09 — it's already set above with the
    // timing fields; the dupe was dead and tripped TS1117 once functions/ entered the typecheck.)
  };

  const agent = await db.prepare('SELECT display_name, handle, recall_code, plants, pull_token FROM agents WHERE agent_id = ?').bind(run.agent_id).first() as any;
  if (agent) {
    response.display_name = agent.display_name;
    response.handle = agent.handle;
    // Non-bearer semantics (agents.txt §10k) — rides with the attestation VG code.
    if (run.attestation_vg_code) {
      response.credential_semantics = credentialSemantics(agent.handle);
    }

    // ── Next-run answers (recall_code + memory plants) — pull_token-GATED, header only ──
    // These are the agent's OWN future answers (data_sovereignty recall + session_continuity plants).
    // The run_token in this URL is ALSO the shareable /track "watch live" link, so this payload is
    // readable by anyone the owner shares that link with — the sensitive block must NOT ride it openly.
    // This endpoint is the SOLE delivery: unlocked only by presenting the agent's pull_token in the
    // Authorization header (a track-link watcher never holds it). NOT via ?pull_token= query — query
    // strings land in logs / Referer / browser history (Codex M1). Compare is constant-time.
    const authHeader = context.request.headers.get('Authorization') || '';
    const providedPull = authHeader.replace(/^Bearer\s+/i, '').trim();
    const agentAuthenticated = !!providedPull && !!agent.pull_token && timingSafeStrEqual(providedPull, agent.pull_token);

    if (agentAuthenticated) {
      Object.assign(response, nextRunAnswers(agent));
    }
  }

  // Attestation is included in the verification price — no upsell.

  return Response.json(response);
};
