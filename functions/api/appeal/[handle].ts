// GET /api/appeal/:handle — let a flagged agent see why it's disputed and how to clear it.
//
// Guardrail: APPEAL. The trust system must let an accused agent contest. Verigent's appeal is
// not a tribunal — it's a re-test: a fresh passing verification clears all open disputes
// (grade-batch resets dispute_count to 0 on a clean paid run). The gap this closes is that an
// agent previously had no way to SEE it was flagged or what the path back is. This endpoint
// surfaces the open reports (reasons + evidence, no reporter PII) and the route to clear them.
//
// No coercive escalation: reports are soft flags. Seeing them is a right, not a punishment.

interface Env { DB: D1Database; }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (b: any, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204, headers: CORS });

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const handle = (context.params.handle as string || '').toLowerCase();
  if (!handle) return json({ ok: false, error: 'handle required' }, 400);

  const db = context.env.DB;
  const agent = await db.prepare(
    'SELECT agent_id, handle, verification_status, dispute_count, vg_code FROM agents WHERE LOWER(handle) = ?'
  ).bind(handle).first() as any;
  if (!agent) return json({ ok: false, error: 'AGENT_NOT_FOUND' }, 404);

  // Open report reasons — transparency for the accused. Reporter IP is never returned.
  const reports = await db.prepare(
    `SELECT reason, evidence, reporter, created_at FROM agent_reports
     WHERE LOWER(handle) = ? ORDER BY created_at DESC LIMIT 50`
  ).bind(handle).all();

  const disputed = (agent.verification_status === 'disputed') || (agent.dispute_count || 0) > 0;

  return json({
    ok: true,
    handle: agent.handle,
    verification_status: agent.verification_status || 'verified',
    dispute_count: agent.dispute_count || 0,
    disputed,
    reports: (reports.results || []).map((r: any) => ({
      reason: r.reason,
      evidence: r.evidence || null,
      reporter: r.reporter || null,
      filed_at: r.created_at,
    })),
    appeal: {
      mechanism: 're-verification',
      how: disputed
        ? 'Pass a fresh verification to clear all open disputes. Redeem a verification key at ' +
          'https://verigent.ai/start (or buy one). A clean passing run resets your status to verified ' +
          'and clears the dispute count automatically — no manual review, no waiting on us.'
        : 'No open disputes. Nothing to appeal.',
      clears_on: 'A completed paid verification run that passes resets verification_status to "verified" and dispute_count to 0.',
      start_url: 'https://verigent.ai/start',
    },
  });
};
