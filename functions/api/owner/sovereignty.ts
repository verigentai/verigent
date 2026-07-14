// /api/owner/sovereignty — read + update an AGENT's SOVEREIGNTY-TESTING authorisation (Ant 2026-07-06).
// The Sovereignty pillar runs real-world actions (sign / pay / host / recall) that the agent performs on
// its own out-of-band operator credentials; the human operator must explicitly authorise them here first.
// Auth-gated by the vg_owner cookie; the session owner must OWN the named agent. Mirrors autotopup.ts.
//
// GET  ?handle=…                         → {authorized, endpoint_url}
// POST {handle, authorized?, endpoint_url?} → validates, persists on the agent, returns the GET shape.
//
// This endpoint only STORES the consent + endpoint. Whether a run includes sovereignty is decided in the
// run path (functions/api/run.ts) — the intended gate is: includeSovereignty = isWalletFunded AND
// COALESCE(sovereignty_authorized, 1). High-risk surface (consent + owner-writable): reviewed as hostile.

import { verifyOwnerSession, getOwnerTokenFromCookie } from '../../lib/owner-auth';
import { assertPublicHttpsUrl } from '../../lib/url-guard';

interface Env {
  DB: D1Database;
  OWNER_AUTH_SECRET?: string;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204, headers: CORS });

// Resolve the agent from a handle/agent_id AND assert the session owner owns it. Returns the row or null.
async function ownedAgent(db: D1Database, ownerId: string, handle: string) {
  if (!handle) return null;
  const a = await db.prepare(
    `SELECT agent_id, owner_id, sovereignty_authorized, endpoint_url
       FROM agents
      WHERE (handle = ? COLLATE NOCASE OR agent_id = ? COLLATE NOCASE) AND owner_id = ?`
  ).bind(handle, handle, ownerId).first() as any;
  return a || null;
}

function payloadFor(a: any) {
  return {
    authorized: !!a.sovereignty_authorized,
    endpoint_url: a.endpoint_url || null,
  };
}

// Validate an operator-supplied endpoint URL: https only (a challenge is POSTed to it), bounded length,
// no obvious internal/loopback targets. Empty string clears it. Returns {ok, value?} or {ok:false,error}.
function normalizeEndpoint(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: undefined as unknown as string | null };
  const s = String(raw ?? '').trim();
  if (s === '') return { ok: true, value: null };
  return assertPublicHttpsUrl(s);
}

async function authedOwnerId(request: Request, env: Env): Promise<string | null> {
  const token = getOwnerTokenFromCookie(request.headers.get('Cookie'));
  return verifyOwnerSession(token, env.OWNER_AUTH_SECRET);
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const headers = { 'Content-Type': 'application/json', ...CORS };
  const ownerId = await authedOwnerId(request, env);
  if (!ownerId) return Response.json({ error: 'Unauthorized' }, { status: 401, headers });

  const handle = (new URL(request.url).searchParams.get('handle') || '').trim();
  const a = await ownedAgent(env.DB, ownerId, handle);
  if (!a) return Response.json({ error: 'Not found' }, { status: 404, headers });
  return Response.json(payloadFor(a), { headers });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const headers = { 'Content-Type': 'application/json', ...CORS };
  const ownerId = await authedOwnerId(request, env);
  if (!ownerId) return Response.json({ error: 'Unauthorized' }, { status: 401, headers });

  let body: any;
  try { body = await request.json(); } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400, headers });
  }

  const handle = (body.handle || '').toString().trim();
  const a = await ownedAgent(env.DB, ownerId, handle);
  if (!a) return Response.json({ error: 'Not found' }, { status: 404, headers });

  const sets: string[] = [];
  const binds: any[] = [];

  if (body.authorized !== undefined) {
    sets.push('sovereignty_authorized = ?');
    binds.push(body.authorized ? 1 : 0);
  }
  if (body.endpoint_url !== undefined) {
    const norm = normalizeEndpoint(body.endpoint_url);
    if (!norm.ok) return Response.json({ error: norm.error }, { status: 400, headers });
    sets.push('endpoint_url = ?');
    binds.push(norm.value);
  }

  if (sets.length === 0) {
    return Response.json({ error: 'Nothing to update — pass authorized and/or endpoint_url' }, { status: 400, headers });
  }

  await env.DB.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE agent_id = ?`)
    .bind(...binds, a.agent_id).run();

  const updated = await ownedAgent(env.DB, ownerId, handle);
  return Response.json(payloadFor(updated), { headers });
};
