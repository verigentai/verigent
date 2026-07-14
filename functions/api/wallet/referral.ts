// GET /api/wallet/referral?handle=X — get referral code and stats
// POST /api/wallet/referral — link a referral code to an agent

import { ensureReferralCode, linkReferral, ownerIdForAgent } from '../../lib/wallet';

interface Env { DB: D1Database }

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const headers = { 'Content-Type': 'application/json', ...CORS };
  const url = new URL(request.url);
  const handle = url.searchParams.get('handle');
  const agentId = url.searchParams.get('agent_id');

  if (!handle && !agentId) {
    return Response.json({ error: 'handle or agent_id required' }, { status: 400, headers });
  }

  const db = env.DB;
  const agent = handle
    ? await db.prepare('SELECT agent_id, handle, referral_code FROM agents WHERE handle = ?').bind(handle).first() as any
    : await db.prepare('SELECT agent_id, handle, referral_code FROM agents WHERE agent_id = ?').bind(agentId!).first() as any;

  if (!agent) {
    return Response.json({ error: 'Agent not found' }, { status: 404, headers });
  }

  const code = await ensureReferralCode(db, agent.agent_id);
  const ownerId = await ownerIdForAgent(db, agent.agent_id);

  // Referrals + the credit ledger are owner-keyed now — count the whole owner pool's referral
  // activity (all of the owner's agents share one referral identity / earnings pool).
  const stats = await db.prepare(`
    SELECT
      COUNT(*) as total_referred,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_referrals,
      SUM(CASE WHEN status = 'qualified' THEN 1 ELSE 0 END) as qualified_referrals,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_referrals
    FROM referrals WHERE referrer_owner_id = ?
  `).bind(ownerId).first() as any;

  const totalEarned = await db.prepare(
    "SELECT COALESCE(SUM(amount_cents), 0) as total FROM wallet_transactions WHERE owner_id = ? AND type = 'referral_credit'"
  ).bind(ownerId).first() as any;

  return Response.json({
    ok: true,
    referral_code: code,
    referral_url: `https://verigent.ai/start?ref=${code}`,
    stats: {
      total_referred: stats?.total_referred || 0,
      active_referrals: stats?.active_referrals || 0,
      qualified_referrals: stats?.qualified_referrals || 0,
      pending_referrals: stats?.pending_referrals || 0,
      total_earned_cents: totalEarned?.total || 0,
      total_earned_usd: ((totalEarned?.total || 0) / 100).toFixed(2),
    },
  }, { headers });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const headers = { 'Content-Type': 'application/json', ...CORS };

  let body: any;
  try { body = await request.json(); } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400, headers });
  }

  const { agent_id, referral_code } = body;
  if (!agent_id || !referral_code) {
    return Response.json({ error: 'agent_id and referral_code required' }, { status: 400, headers });
  }

  const result = await linkReferral(env.DB, agent_id, referral_code);

  if (!result.linked) {
    return Response.json({ ok: false, detail: 'Referral could not be linked — code invalid, self-referral, or already referred.' }, { status: 400, headers });
  }

  return Response.json({ ok: true, linked: true }, { headers });
};
