interface Env { DB: D1Database; }

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const code = (url.searchParams.get('code') || '').trim();
  if (!code) return Response.json({ valid: false, reason: 'No key provided' });

  const coupon = await env.DB.prepare(
    'SELECT uses_allowed, uses_used, expires_at, email FROM coupons WHERE code = ?'
  ).bind(code).first() as any;

  if (!coupon) return Response.json({ valid: false, reason: 'Key not found' });
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) return Response.json({ valid: false, reason: 'Key has expired' });

  // Check for any runs using this key
  const run = await env.DB.prepare(
    `SELECT status, composite_score, tier, run_token FROM runs WHERE coupon_code = ? ORDER BY started_at DESC LIMIT 1`
  ).bind(code).first() as any;

  if (run) {
    if (run.status === 'completed') {
      return Response.json({
        valid: false,
        reason: 'This key has already been used for a completed test.',
        run_status: 'completed',
        tier: run.tier,
        composite: run.composite_score,
      });
    }
    if (run.status === 'expired') {
      return Response.json({
        valid: true,
        reason: 'Previous test expired — you can reuse this key.',
        run_status: 'expired',
        uses_remaining: 1,
        // email intentionally NOT returned (B4, review 2026-07-09): this endpoint is unauthenticated
        // and keyed on a guessable coupon code — returning owner email made it a PII-harvest oracle.
      });
    }
    if (run.status === 'open' || run.status === 'in_progress' || run.status === 'grading') {
      return Response.json({
        valid: false,
        reason: 'A test is currently in progress with this key.',
        run_status: run.status,
        run_token: run.run_token,
      });
    }
  }

  if (coupon.uses_used >= coupon.uses_allowed) {
    return Response.json({ valid: false, reason: 'Key has been fully used' });
  }

  return Response.json({
    valid: true,
    uses_remaining: coupon.uses_allowed - coupon.uses_used,
    // email intentionally NOT returned (B4, review 2026-07-09) — see note above.
  });
};
