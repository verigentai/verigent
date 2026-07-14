// POST /api/coupon — validate a coupon code + resolve its most-recent run (read-only).
// Body: { code, agentId? } — agentId is accepted-and-ignored (legacy callers; the one-shot-era
// write was removed 2026-07-07). /track uses this to resolve a coupon to its run for live tracking.
// Returns { ok, tier, uses_remaining, run_status } or { ok: false, error, run_status? }.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
function json(b, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...CORS } });
}
export function onRequestOptions() { return new Response(null, { status: 204, headers: CORS }); }

export async function onRequestPost(context) {
  const { request, env } = context;
  let data = {};
  try { data = await request.json(); } catch {}
  const code = (data.code || "").toString().trim().toUpperCase();
  const agentId = (data.agentId || "").toString().trim();
  if (!code) return json({ ok: false, error: "Coupon code required" }, 400);

  const coupon = await env.DB.prepare(
    "SELECT code, tier, uses_allowed, uses_used, expires_at FROM coupons WHERE code = ?"
  ).bind(code).first();

  if (!coupon) return json({ ok: false, error: "Invalid coupon code" }, 404);

  const expired = coupon.expires_at && new Date(coupon.expires_at) < new Date();
  const remaining = coupon.uses_allowed - coupon.uses_used;

  // Always look up run status — track page needs it even for fully-used keys
  let run_status = null;
  const run = await env.DB.prepare(
    `SELECT r.run_token, r.status, r.composite_score, r.tier, r.primary_class,
            r.tasks_graded, r.agent_id, r.model_avg, r.agent_avg,
            a.display_name, a.handle,
            (SELECT COUNT(*) FROM run_tasks WHERE run_token = r.run_token) as tasks_total,
            (SELECT dimension FROM run_tasks WHERE run_token = r.run_token AND graded_at IS NULL LIMIT 1) as current_dimension
     FROM runs r
     LEFT JOIN agents a ON r.agent_id = a.agent_id
     WHERE r.coupon_code = ?
     ORDER BY r.started_at DESC LIMIT 1`
  ).bind(code).first();

  if (run) {
    const statusMap = { open: "validating", in_progress: "active", grading: "grading", eval_pending: "eval", completed: "done", expired: "error" };
    run_status = {
      status: statusMap[run.status] || run.status,
      tasks_total: run.tasks_total || 0,
      tasks_completed: run.tasks_graded || 0,
      current_dimension: run.current_dimension || "",
      composite: run.composite_score,
      model_score: run.model_avg,
      agent_score: run.agent_avg,
      sovereignty_score: null,
      agent_id: run.handle || run.agent_id,
      run_token: run.run_token,
    };
  }

  if (expired) {
    return json({ ok: false, error: "Coupon has expired", run_status }, 410);
  }

  if (remaining <= 0) {
    return json({ ok: false, error: "Coupon has been fully used", run_status }, 410);
  }

  // DON'T increment usage here — only consumed when test completes (published to leaderboard).
  // The grade API increments on final=true.

  // Vestigial one-shot-era write REMOVED (money-path review 2026-07-07, M1): it set the dead
  // payment_status/stripe_session_id columns keyed on the OLD `id` PK (live agents key on agent_id),
  // so it either errored or hit nothing. Coupon redemption is handled by run.ts (uses_used) — this
  // endpoint stays read-only: /track uses it to resolve a coupon to its most-recent run. The agentId
  // body field is accepted-and-ignored for caller compatibility.

  return json({
    ok: true,
    code: coupon.code,
    tier: coupon.tier,
    uses_remaining: remaining - 1,
    message: `Coupon applied! ${remaining - 1} uses remaining.`,
    run_status,
  });
}
