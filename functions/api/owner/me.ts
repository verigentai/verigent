// GET /api/owner/me — the authenticated owner's dashboard payload.
//
// Auth-gated by the vg_owner cookie (verifyOwnerSession → owner_id). 401 if no/invalid/expired
// cookie. Returns: the owner's pooled balance + runway (days of verification left at the flat daily
// debit), each of their agents (handle, display name, tier, freshness state, continuous_active), and
// the most recent pooled wallet transactions.

import { verifyOwnerSession, getOwnerTokenFromCookie } from '../../lib/owner-auth';
import { FOUNDER_PRICE_CENTS, perChallengeCents, BASE_PROBES_PER_DAY } from '../../lib/pricing';
import { computeFreshness } from '../../lib/freshness';
// @ts-ignore — extensionless JS sibling (resolved by the Pages/Workers bundler at runtime)
import { buildSetupPrompt, buildSetupParts } from '../../lib/continuous-activation.js';

interface Env {
  DB: D1Database;
  OWNER_AUTH_SECRET?: string;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204, headers: CORS });

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const headers = { 'Content-Type': 'application/json', ...CORS };

  const token = getOwnerTokenFromCookie(request.headers.get('Cookie'));
  const ownerId = await verifyOwnerSession(token, env.OWNER_AUTH_SECRET);
  if (!ownerId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
  }

  const owner = await env.DB.prepare(
    'SELECT owner_id, email, referral_code FROM owners WHERE owner_id = ?'
  ).bind(ownerId).first() as any;
  if (!owner) {
    // Valid signature but the owner row is gone — treat as unauthenticated.
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
  }

  const agentRows = await env.DB.prepare(
    `SELECT agent_id, handle, display_name, current_tier, composite_score, primary_class,
            balance_cents, total_topped_up_cents, is_colony_early_bird, founder_number,
            continuous_active, continuous_pending, pull_token, self_pull_count,
            last_self_pull_at, last_certified_at, updated_at, certified_model, model_fingerprint_hash,
            locked_rate_cents, probes_per_day, reverifying_until, lapsed_at
     FROM agents WHERE owner_id = ? ORDER BY updated_at DESC`
  ).bind(ownerId).all();

  // The owner is authenticated (cookie-gated), so it is safe to surface the agent's private
  // pull_token + ready-to-paste setup prompt here. This is the retrievable surface for the Stripe
  // top-up path (the webhook is server→server and can't return to the agent). We only surface the
  // setup for an agent that is PENDING (armed, not yet self-pull-proven) — an already-active agent
  // needs no re-paste, and we never expose the token for an agent that was never topped up.
  const agents = (agentRows.results || []).map((a: any) => {
    const fresh = computeFreshness(a.last_certified_at || a.updated_at, {
      certifiedModel: a.certified_model,
      reverifyingUntil: a.reverifying_until,
    });
    const pending = !!a.continuous_pending && !a.continuous_active;
    const showSetup = pending && !!a.pull_token;
    return {
      agent_id: a.agent_id,
      handle: a.handle,
      display_name: a.display_name,
      tier: a.current_tier,
      composite_score: a.composite_score,
      primary_class: a.primary_class,
      // per-agent wallet (spec §7): each agent carries its OWN balance now.
      balance_cents: a.balance_cents || 0,
      balance_usd: ((a.balance_cents || 0) / 100).toFixed(2),
      total_topped_up_cents: a.total_topped_up_cents || 0,
      is_founder: !!a.is_colony_early_bird,
      founder_number: a.founder_number ?? null,
      continuous_active: !!a.continuous_active,
      continuous_pending: pending,
      self_pull_count: a.self_pull_count || 0,
      // PAUSED vs OFF (Ant 2026-07-10): an agent that WAS active and drained carries a lapsed_at.
      // "Empty" = can't fund ONE challenge at its own rate (not literally $0.00 — the live drain test
      // stranded Bishop at 1¢ with a 6¢ challenge cost and the strip lied "waiting on next pull").
      // Outranks pending in the strip: an armed-but-broke agent's next pull gets a 402, so the honest
      // state is paused-top-up-to-resume, whether or not it's re-armed.
      paused_empty: !a.continuous_active && !!a.lapsed_at
        && (a.balance_cents || 0) < perChallengeCents(a.locked_rate_cents ?? FOUNDER_PRICE_CENTS),
      // Provisional window signals for the status strip (Ant 2026-07-10): a just-topped-up agent that
      // has genuinely pulled before is "on — re-verifying", not "off" / "action needed". reverifying
      // mirrors the report's Current·Provisional chip; ran_before separates a re-armed veteran from a
      // never-set-up agent (which still needs the amber setup CTA).
      reverifying: !!fresh.provisional,
      ran_before: !!a.last_self_pull_at,
      freshness: {
        state: fresh.state,
        label: fresh.label,
        age_days: fresh.age_days,
      },
      ...(showSetup ? {
        pull_token: a.pull_token,
        setup_prompt: buildSetupPrompt(a.handle || a.agent_id, a.pull_token),
        // Two-step presentation for the drawer (Ant 2026-07-08) — same content, glanceable boxes.
        setup_parts: buildSetupParts(a.handle || a.agent_id, a.pull_token),
      } : {}),
    };
  });

  // Per-agent wallets now (spec §7): there's no shared pool. The owner-level figure is the AGGREGATE
  // across the owner's agents (sum of balances); runway is the sum of each active agent's own runway
  // (its own balance / daily debit). This keeps the dashboard's headline number honest without
  // resurrecting a pool.
  const activeCount = agents.filter((a: any) => a.continuous_active).length;
  const balanceCents = agents.reduce((s: number, a: any) => s + (a.balance_cents || 0), 0);
  // PER-CHALLENGE billing (Ant 2026-07-08): an agent's real daily burn is its per-challenge rate ×
  // its challenges/day dial — NOT the flat daily debit (retired). Runway sums each active agent's
  // own balance ÷ its own burn, so the headline matches what probe/finish actually debits.
  const rawAgents = (agentRows.results || []) as any[];
  const burnFor = (a: any) =>
    perChallengeCents(a.locked_rate_cents ?? FOUNDER_PRICE_CENTS) * Math.max(1, a.probes_per_day ?? BASE_PROBES_PER_DAY);
  const activeRaw = rawAgents.filter((a: any) => a.continuous_active);
  const dailyBurnCents = activeRaw.length
    ? activeRaw.reduce((s: number, a: any) => s + burnFor(a), 0)
    : burnFor({});
  const runwayDays = activeRaw
    .reduce((s: number, a: any) => {
      const burn = burnFor(a);
      return s + (burn > 0 ? Math.floor((a.balance_cents || 0) / burn) : 0);
    }, 0);

  const txRows = await env.DB.prepare(
    'SELECT id, type, amount_cents, balance_after_cents, description, created_at FROM wallet_transactions WHERE owner_id = ? ORDER BY created_at DESC LIMIT 25'
  ).bind(ownerId).all();

  // Referral tracking (5z): referees this owner brought in (their owner.referred_by_code = my code).
  // Per-referee credit is attributable via referral_credit rows' related_agent_id = the referee's
  // AGENT id (payReferralOnTopup was re-keyed to the agent in the per-agent wallet split — matching
  // the old owner-id here made every credit_cents read 0, review 5kk #7). Old pre-rekey rows stored
  // the owner id, so match either. PRIVACY: only referral-relevant facts — the referee's email,
  // whether they've taken a test (an agent exists), and $ credited to ME. Never their scores,
  // tier, or activity. (Invited-but-never-arrived referees aren't tracked — no owner row yet.)
  let referrals: Array<{ email: string; signed_up: boolean; credit_cents: number }> = [];
  if (owner.referral_code) {
    const refs = await env.DB.prepare(`
      SELECT ro.owner_id, ro.email,
             (SELECT COUNT(*) FROM agents WHERE owner_id = ro.owner_id) AS agent_count,
             COALESCE((SELECT SUM(amount_cents) FROM wallet_transactions
                       WHERE owner_id = ? AND type = 'referral_credit'
                         AND (related_agent_id = ro.owner_id
                              OR related_agent_id IN (SELECT agent_id FROM agents WHERE owner_id = ro.owner_id))), 0) AS credit_cents
      FROM owners ro WHERE ro.referred_by_code = ? ORDER BY ro.owner_id LIMIT 100
    `).bind(ownerId, owner.referral_code).all();
    referrals = ((refs.results || []) as any[]).map((r) => ({
      email: r.email && String(r.email).includes('@') ? String(r.email) : 'joined via your link',
      signed_up: (r.agent_count || 0) > 0,
      credit_cents: Number(r.credit_cents) || 0,
    }));
  }

  return Response.json({
    ok: true,
    owner: {
      email: owner.email,
      balance_cents: balanceCents,
      balance_usd: (balanceCents / 100).toFixed(2),
      runway_days: runwayDays,
      // daily_debit_cents (the retired flat rate) dropped — per-challenge billing means the real
      // figure is daily_burn_cents (Σ per-challenge rate × challenges/day). No consumer read the old field.
      active_agent_count: activeCount,
      daily_burn_cents: dailyBurnCents,
      is_colony_early_bird: agents.some((a: any) => a.is_founder),
      referral_code: owner.referral_code || null,
      total_topped_up_cents: agents.reduce((s: number, a: any) => s + (a.total_topped_up_cents || 0), 0),
    },
    agents,
    transactions: txRows.results || [],
    referrals,
  }, { headers });
};
