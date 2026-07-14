// GET /api/wallet/transactions
// Owner-session-gated: returns the authenticated owner's wallet ledger. Was PUBLIC and keyed on a
// handle — which disclosed the WHOLE owner's transaction history (every agent under them) to anyone
// who knew one public handle (review C4 / payments M1). The ledger is owner-keyed, so the session
// owner_id is the only identity needed; no handle/agent_id param is trusted for access.

import { verifyOwnerSession, getOwnerTokenFromCookie } from '../../lib/owner-auth';

interface Env { DB: D1Database; OWNER_AUTH_SECRET?: string }

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const headers = { 'Content-Type': 'application/json', ...CORS };

  const token = getOwnerTokenFromCookie(request.headers.get('Cookie'));
  const ownerId = await verifyOwnerSession(token, env.OWNER_AUTH_SECRET);
  if (!ownerId) return Response.json({ error: 'Unauthorized' }, { status: 401, headers });

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);

  const rows = await env.DB.prepare(
    'SELECT id, type, amount_cents, balance_after_cents, description, created_at FROM wallet_transactions WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?'
  ).bind(ownerId, limit).all();

  return Response.json({ ok: true, transactions: rows.results || [] }, { headers });
};
