// GET /api/standings/:handle — the agent's published weekly record (docs/WEEKLY-STANDINGS.md P1).
// Public surface: score + tier per published week (the front-end additionally gates drill-down to
// owners). 404 until the agent has at least one published week, which the client treats as "surface
// simply doesn't render".
//
// Stamping is lazy-but-frozen (see lib/weekly.ts): the first read in a new ISO week freezes the
// week's row for a certified agent, so the published number exists even before the daily sweep runs.

import { ensureWeeklySnapshot, weeklyDataForAgent } from '../../lib/weekly';

interface Env {
  DB: D1Database;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204, headers: CORS });

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const headers = { 'Content-Type': 'application/json', ...CORS };
  const handle = params.handle as string;
  if (!handle) return Response.json({ error: 'handle is required' }, { status: 400, headers });

  const agent = await env.DB.prepare(
    'SELECT agent_id FROM agents WHERE handle = ? COLLATE NOCASE OR agent_id = ? COLLATE NOCASE'
  ).bind(handle, handle).first() as any;
  if (!agent) return Response.json({ error: 'AGENT_NOT_FOUND' }, { status: 404, headers });

  await ensureWeeklySnapshot(env.DB, agent.agent_id);
  const weekly = await weeklyDataForAgent(env.DB, agent.agent_id);

  if (!weekly.published_week) {
    return Response.json({ error: 'NO_PUBLISHED_WEEKS' }, { status: 404, headers });
  }
  return Response.json(weekly, { headers });
};
