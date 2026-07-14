// GET /api/wallet/balance?handle=X or ?agent_id=X
// Owner-AWARE: the financial fields (balance, total topped up, per-check rate, checks remaining,
// referral code) are returned ONLY to the authenticated owner of THIS agent; any other caller gets a
// minimal, non-financial payload (review C4 / payments M1 — these figures were world-readable off a
// public handle). The report's OwnerControls fetches this same-origin, so the owner's vg_owner cookie
// rides along automatically and the drawer keeps showing live balance after a top-up.

import { getBalance, getBalanceByHandle } from '../../lib/wallet';
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
  const url = new URL(request.url);
  const handle = url.searchParams.get('handle');
  const agentId = url.searchParams.get('agent_id');

  if (!handle && !agentId) {
    return Response.json({ error: 'handle or agent_id required' }, { status: 400, headers });
  }

  const balance = handle
    ? await getBalanceByHandle(env.DB, handle)
    : await getBalance(env.DB, agentId!);

  if (!balance) {
    return Response.json({ error: 'Agent not found' }, { status: 404, headers });
  }

  // Is the caller the authenticated owner of THIS agent? Only then do the wallet figures go over the wire.
  const token = getOwnerTokenFromCookie(request.headers.get('Cookie'));
  const sessionOwner = await verifyOwnerSession(token, env.OWNER_AUTH_SECRET);
  const isOwner = !!sessionOwner && balance.owner_id === sessionOwner;

  if (!isOwner) {
    // Non-owner / public view — identity + activity only, no financials.
    return Response.json({
      ok: true,
      handle: balance.handle,
      continuous_active: balance.continuous_active,
      is_colony_early_bird: balance.is_colony_early_bird,
    }, { headers });
  }

  return Response.json({
    ok: true,
    handle: balance.handle,
    balance_cents: balance.balance_cents,
    balance_usd: (balance.balance_cents / 100).toFixed(2),
    total_topped_up_cents: balance.total_topped_up_cents,
    rate_cents_per_check: balance.rate_cents_per_check,
    checks_remaining: balance.checks_remaining,
    continuous_active: balance.continuous_active,
    is_colony_early_bird: balance.is_colony_early_bird,
    referral_code: balance.referral_code,
  }, { headers });
};
