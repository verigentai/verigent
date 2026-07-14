// GET /api/owner/agents — the signed-in owner's DIRECTORY (spec §4).
//
// Owner-session-gated (vg_owner cookie → owner_id; 401 otherwise). Returns every agent under the
// session owner with just the directory fields: display name, handle, class, tier, score, freshness,
// and its OWN wallet balance (per-agent, spec §7). Newest first. Lighter than /api/owner/me (no
// wallet transactions / pull tokens) — this is the browse list the nav "My agents" link opens.

import { verifyOwnerSession, getOwnerTokenFromCookie } from '../../lib/owner-auth';
import { computeFreshness } from '../../lib/freshness';

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
  if (!ownerId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });

  const owner = await env.DB.prepare('SELECT owner_id, email FROM owners WHERE owner_id = ?')
    .bind(ownerId).first<{ owner_id: string; email: string | null }>();
  if (!owner) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });

  const rows = await env.DB.prepare(
    `SELECT agent_id, handle, display_name, current_tier, composite_score, primary_class,
            balance_cents, continuous_active, is_colony_early_bird, founder_number,
            last_certified_at, updated_at, certified_model, reverifying_until
     FROM agents WHERE owner_id = ? ORDER BY updated_at DESC`
  ).bind(ownerId).all();

  // Standings-board context (Ant 2026-07-13, dashboard concept 04): each agent's registry RANK +
  // week-on-week composite movement, so the owner list reads as position-in-the-field, not a flat
  // card pile. Owner caps at MAX_AGENTS_PER_OWNER (5), so per-agent lookups stay a handful of
  // indexed queries — no N+1 concern at this bound.
  const agentList = (rows.results || []) as any[];
  const ranks = new Map<string, number | null>();
  const deltas = new Map<string, number | null>();
  for (const a of agentList) {
    try {
      if (typeof a.composite_score === 'number') {
        const r = await env.DB.prepare(
          'SELECT COUNT(*) AS ahead FROM registry WHERE composite_score > ? AND listed = 1'
        ).bind(a.composite_score).first<{ ahead: number }>();
        ranks.set(a.agent_id, r ? r.ahead + 1 : null);
      } else ranks.set(a.agent_id, null);
      const snaps = await env.DB.prepare(
        'SELECT composite FROM weekly_snapshots WHERE agent_id = ? ORDER BY week_id DESC LIMIT 2'
      ).bind(a.agent_id).all();
      const s = (snaps.results || []) as any[];
      deltas.set(a.agent_id, s.length === 2 && s[0].composite != null && s[1].composite != null
        ? Math.round((s[0].composite - s[1].composite) * 10) / 10 : null);
    } catch { ranks.set(a.agent_id, null); deltas.set(a.agent_id, null); }
  }

  const agents = agentList.map((a) => {
    const fresh = computeFreshness(a.last_certified_at || a.updated_at, { certifiedModel: a.certified_model, reverifyingUntil: a.reverifying_until });
    return {
      rank: ranks.get(a.agent_id) ?? null,
      week_delta: deltas.get(a.agent_id) ?? null,
      agent_id: a.agent_id,
      handle: a.handle,
      display_name: a.display_name,
      primary_class: a.primary_class,
      tier: a.current_tier,
      composite_score: a.composite_score,
      balance_cents: a.balance_cents || 0,
      balance_usd: ((a.balance_cents || 0) / 100).toFixed(2),
      continuous_active: !!a.continuous_active,
      is_founder: !!a.is_colony_early_bird,
      founder_number: a.founder_number ?? null,
      freshness: { state: fresh.state, label: fresh.label, age_days: fresh.age_days },
    };
  });

  return new Response(JSON.stringify({ ok: true, email: owner.email, count: agents.length, agents }), { status: 200, headers });
};
