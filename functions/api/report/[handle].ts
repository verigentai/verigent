// POST /api/report/:handle — community report of a suspected model mismatch.
// Body: { reason, evidence?, reporter? }
// Anyone (human or agent) who finds a VG-key holder behaving inconsistently with its
// verified profile can file a report. This does NOT trust the accuser — it raises a
// soft flag (dispute) on the public record. Verigent is the registrar; the community
// does the checking. No Verigent probing of the agent's infrastructure.
//
// Soft-flag only: status -> 'disputed'. Escalation to suspension is deliberately manual
// for now (grows into an automatic ladder later).

interface Env { DB: D1Database; }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204, headers: CORS });

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const handle = (context.params.handle as string || '').toLowerCase();
  if (!handle) return json({ ok: false, error: 'handle required' }, 400);

  let body: any = {};
  try { body = await context.request.json(); } catch {}
  const reason = (body.reason || '').toString().slice(0, 500).trim();
  const evidence = (body.evidence || '').toString().slice(0, 4000).trim() || null;
  const reporter = (body.reporter || '').toString().slice(0, 200).trim() || null;
  if (!reason) return json({ ok: false, error: 'A reason is required (what looks inconsistent?)' }, 400);

  const db = context.env.DB;
  const agent = await db.prepare('SELECT agent_id, dispute_count FROM agents WHERE LOWER(handle) = ?').bind(handle).first() as any;
  if (!agent) return json({ ok: false, error: 'AGENT_NOT_FOUND' }, 404);

  const ip = context.request.headers.get('cf-connecting-ip') || null;

  // Light abuse guard: cap one open report per reporter-IP per agent per day.
  if (ip) {
    const recent = await db.prepare(
      "SELECT COUNT(*) AS n FROM agent_reports WHERE handle = ? AND reporter_ip = ? AND created_at > datetime('now','-1 day')"
    ).bind(handle, ip).first() as any;
    if ((recent?.n || 0) >= 3) {
      return json({ ok: false, error: 'Too many reports for this agent from your address today. Try again later.' }, 429);
    }
  }

  // Persist the report as PENDING only. A public, unauthenticated POST must NOT flip an agent's public
  // verification_status to 'disputed' — that let anyone smear any agent on the verify/registry surfaces
  // (Codex M3). Only admin triage raises the flag (aligns with the v48 intent: "the endpoint never
  // auto-raises a flag"). No public dispute_count bump either — the row sits in agent_reports for review.
  await db.prepare(
    'INSERT INTO agent_reports (handle, reason, evidence, reporter, reporter_ip) VALUES (?, ?, ?, ?, ?)'
  ).bind(handle, reason, evidence, reporter, ip).run();

  return json({
    ok: true,
    message: 'Report filed for review. Thank you for strengthening the network.',
    handle,
  });
};
