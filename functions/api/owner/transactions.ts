// /api/owner/transactions — full wallet-transaction history + export (POST-LAUNCH #15, Ant
// 2026-07-10). The data has existed since day one (every credit/debit lands in
// wallet_transactions); this is the owner-facing surface for tax/reconciliation.
//
// GET ?format=json|csv (default json) &handle=<agent> (optional per-agent filter) &limit=<n>
// Auth: vg_owner cookie (mirrors sovereignty.ts). Owner-scoped ALWAYS — the query keys on the
// session's owner_id, and the optional agent filter re-asserts ownership, so no parameter can
// widen the window to another owner's money.

import { verifyOwnerSession, getOwnerTokenFromCookie } from '../../lib/owner-auth';
import { transactionsToCsv, type TxRow } from '../../lib/tx-export';

interface Env {
  DB: D1Database;
  OWNER_AUTH_SECRET?: string;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Bounded but generous: a year of 5-challenge days is ~1.8k rows/agent. A cap keeps a huge
// account from turning the export into an unbounded D1 scan.
const MAX_ROWS = 10_000;

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204, headers: CORS });

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const headers = { 'Content-Type': 'application/json', ...CORS };
  const ownerId = await verifyOwnerSession(getOwnerTokenFromCookie(request.headers.get('Cookie')), env.OWNER_AUTH_SECRET);
  if (!ownerId) return Response.json({ error: 'Unauthorized' }, { status: 401, headers });

  const url = new URL(request.url);
  const format = (url.searchParams.get('format') || 'json').toLowerCase();
  const handle = (url.searchParams.get('handle') || '').trim();
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || MAX_ROWS, 1), MAX_ROWS);

  // Optional per-agent filter — ownership re-asserted (an unowned/unknown handle is a plain 404,
  // never a silent fall-through to the whole pool).
  let agentId: string | null = null;
  if (handle) {
    const a = await env.DB.prepare(
      'SELECT agent_id FROM agents WHERE (handle = ? COLLATE NOCASE OR agent_id = ? COLLATE NOCASE) AND owner_id = ?'
    ).bind(handle, handle, ownerId).first() as any;
    if (!a) return Response.json({ error: 'Not found' }, { status: 404, headers });
    agentId = a.agent_id;
  }

  const rows = await env.DB.prepare(`
    SELECT id, created_at, type, agent_id, amount_cents, balance_after_cents, description, related_run_token
    FROM wallet_transactions
    WHERE owner_id = ?${agentId ? ' AND agent_id = ?' : ''}
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).bind(...(agentId ? [ownerId, agentId, limit] : [ownerId, limit])).all();
  const txs = (rows.results || []) as unknown as TxRow[];

  if (format === 'csv') {
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(transactionsToCsv(txs), {
      headers: {
        ...CORS,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="verigent-transactions${agentId ? '-' + agentId : ''}-${stamp}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  return Response.json({ ok: true, count: txs.length, transactions: txs }, {
    headers: { ...headers, 'Cache-Control': 'no-store' },
  });
};
