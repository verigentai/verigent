// POST /api/owner/probes — persist the probes-per-day slider (owner controls on the report).
// Body: { handle, probes_per_day } — 5..20. Auth: vg_owner cookie; the agent must belong to the
// authenticated owner. The stored value is the scheduler's target cadence for this agent.

import { verifyOwnerSession, getOwnerTokenFromCookie } from '../../lib/owner-auth';

interface Env {
  DB: D1Database;
  OWNER_AUTH_SECRET?: string;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204, headers: CORS });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const headers = { 'Content-Type': 'application/json', ...CORS };

  const token = getOwnerTokenFromCookie(request.headers.get('Cookie'));
  const ownerId = await verifyOwnerSession(token, env.OWNER_AUTH_SECRET);
  if (!ownerId) return Response.json({ error: 'Unauthorized' }, { status: 401, headers });

  let body: any;
  try { body = await request.json(); } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400, headers });
  }

  const handle = (body.handle || '').toString().trim();
  const probes = Math.round(Number(body.probes_per_day));
  if (!handle) return Response.json({ error: 'handle required' }, { status: 400, headers });
  if (!Number.isFinite(probes) || probes < 5 || probes > 20) {
    return Response.json({ error: 'probes_per_day must be between 5 and 20' }, { status: 400, headers });
  }

  const res = await env.DB.prepare(
    'UPDATE agents SET probes_per_day = ? WHERE handle = ? COLLATE NOCASE AND owner_id = ?'
  ).bind(probes, handle, ownerId).run();
  if (((res.meta as any)?.changes ?? 0) === 0) {
    return Response.json({ error: 'Agent not found for this owner' }, { status: 404, headers });
  }

  return Response.json({ ok: true, probes_per_day: probes }, { headers });
};
