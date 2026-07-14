// /api/owner/contributions — community contribution intake + the submitter's own status list
// (docs/CONTRIBUTE-SPEC.md, Ant 2026-07-06). Owner-session gated: contributing is for logged-in owners
// who have an agent on the system (Ant ruling — no public contributions; the PUBLIC per-agent
// identity/flag challenge stays on the report card as a separate system).
//
// GET                        → { contributions: [...] }  the caller's own submissions (My Contributions)
// POST {type, ...fields}     → { ok, id }                validates + stores; emails verify@ inbound
//
// Rewards are NOT set here — the admin accept path derives credit from doctrine.ts and credits the
// wallet. This endpoint only records the submission (status 'pending').

import { verifyOwnerSession, getOwnerTokenFromCookie } from '../../lib/owner-auth';
import { mailerFromEnv } from '../../lib/email-send';
import { sendAdminNotificationEmail } from '../../lib/email';

interface Env {
  DB: D1Database;
  OWNER_AUTH_SECRET?: string;
  RESEND_API_KEY?: string;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204, headers: CORS });

const TYPES = new Set(['question', 'dimension', 'bug']);
const SEVERITIES = new Set(['site', 'minor', 'major', 'critical']);
const MAX_PER_DAY = 10;   // per owner — generous; blocks runaway/scripted spam without hurting real use
const F = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

async function ownerContext(request: Request, env: Env): Promise<{ ownerId: string; email: string } | null> {
  const ownerId = await verifyOwnerSession(getOwnerTokenFromCookie(request.headers.get('Cookie')), env.OWNER_AUTH_SECRET);
  if (!ownerId) return null;
  const row = await env.DB.prepare('SELECT email FROM owners WHERE owner_id = ?').bind(ownerId).first<{ email: string }>();
  if (!row?.email) return null;
  return { ownerId, email: row.email };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const headers = { 'Content-Type': 'application/json', ...CORS };
  const ctx = await ownerContext(request, env);
  if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401, headers });

  const rows = await env.DB.prepare(
    `SELECT id, created_at, type, severity, status, credit_days, credited_at, decline_reason, payload
       FROM contributions WHERE owner_email = ? ORDER BY created_at DESC LIMIT 100`
  ).bind(ctx.email).all();

  // Surface a short human title per row without leaking the whole payload back verbatim.
  const contributions = (rows.results || []).map((r: any) => {
    let title = '';
    try {
      const p = JSON.parse(r.payload || '{}');
      title = p.title || p.name || p.question || p.description || '';
    } catch { /* payload unreadable — leave title blank */ }
    return {
      id: r.id, created_at: r.created_at, type: r.type, severity: r.severity, status: r.status,
      credit_days: r.credit_days, credited_at: r.credited_at, decline_reason: r.decline_reason,
      title: String(title).slice(0, 140),
    };
  });
  return Response.json({ contributions }, { headers });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const headers = { 'Content-Type': 'application/json', ...CORS };
  const ctx = await ownerContext(request, env);
  if (!ctx) return Response.json({ error: 'Unauthorized', reason: 'signin' }, { status: 401, headers });

  // GATE: contributing requires an agent on the system (Ant ruling). The reward is wallet credit, which
  // needs an agent to land on — and it keeps contributions to real participants.
  const agent = await env.DB.prepare('SELECT agent_id FROM agents WHERE owner_id = ? LIMIT 1')
    .bind(ctx.ownerId).first<{ agent_id: string }>();
  if (!agent) return Response.json({ error: 'You need an agent on Verigent to contribute.', reason: 'no_agent' }, { status: 403, headers });

  let body: any;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400, headers }); }

  const type = F(body.type, 20);
  if (!TYPES.has(type)) return Response.json({ error: 'Unknown contribution type.' }, { status: 400, headers });

  // Rolling-day rate limit per owner (anti-spam; real contributors never hit 10/day).
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM contributions WHERE owner_email = ? AND created_at > strftime('%s','now') - 86400"
  ).bind(ctx.email).first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_PER_DAY) {
    return Response.json({ error: 'Daily submission limit reached — come back tomorrow.' }, { status: 429, headers });
  }

  // Per-type field validation → a clean payload blob. Bounds keep the DB and review UI sane.
  let payload: Record<string, string>;
  let severity: string | null = null;
  if (type === 'question') {
    const dimension = F(body.dimension, 64), question = F(body.question, 2000), good = F(body.good, 2000), bad = F(body.bad, 2000);
    if (!dimension) return Response.json({ error: 'Pick a dimension.' }, { status: 400, headers });
    if (question.length < 20) return Response.json({ error: 'Describe the question/scenario (20+ characters).' }, { status: 400, headers });
    if (!good || !bad) return Response.json({ error: 'Describe what good and bad look like.' }, { status: 400, headers });
    payload = { dimension, question, good, bad, context: F(body.context, 1000) };
  } else if (type === 'dimension') {
    const name = F(body.name, 120), description = F(body.description, 2000), pillar = F(body.pillar, 20),
      scenarios = F(body.scenarios, 2500), discriminates = F(body.discriminates, 2000);
    if (name.length < 3) return Response.json({ error: 'Give the dimension a name.' }, { status: 400, headers });
    if (description.length < 20) return Response.json({ error: 'Describe what it tests and why it matters (20+ characters).' }, { status: 400, headers });
    if (!['model', 'backbone', 'agent', 'sovereignty'].includes(pillar)) return Response.json({ error: 'Pick a pillar.' }, { status: 400, headers });
    if (!scenarios || !discriminates) return Response.json({ error: 'Add seed scenarios and what discriminates a capable agent.' }, { status: 400, headers });
    payload = { name, description, pillar, scenarios, discriminates };
  } else { // bug
    severity = F(body.severity, 20);
    if (!SEVERITIES.has(severity)) return Response.json({ error: 'Pick a severity.' }, { status: 400, headers });
    const title = F(body.title, 200), steps = F(body.steps, 3000), happened = F(body.happened, 2000), expected = F(body.expected, 2000);
    if (title.length < 5) return Response.json({ error: 'Give the bug a one-line title.' }, { status: 400, headers });
    if (!steps || !happened || !expected) return Response.json({ error: 'Add steps to reproduce, what happened, and what you expected.' }, { status: 400, headers });
    payload = { title, steps, happened, expected, evidence: F(body.evidence, 1000) };
  }

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  // ATOMIC cap enforcement (audit find 2026-07-08): the COUNT check above is advisory only — two
  // concurrent submissions could both pass it (TOCTOU). The INSERT itself re-checks the cap in the
  // same statement, so a burst can never exceed MAX_PER_DAY; zero changes ⇒ the cap won the race.
  const ins = await env.DB.prepare(
    `INSERT INTO contributions (id, created_at, owner_email, agent_id, type, severity, payload, status)
     SELECT ?, ?, ?, ?, ?, ?, ?, 'pending'
     WHERE (SELECT COUNT(*) FROM contributions WHERE owner_email = ? AND created_at > strftime('%s','now') - 86400) < ?`
  ).bind(id, now, ctx.email, agent.agent_id, type, severity, JSON.stringify(payload), ctx.email, MAX_PER_DAY).run();
  if (((ins.meta as any)?.changes ?? 0) === 0) {
    return Response.json({ error: 'Daily submission limit reached — come back tomorrow.' }, { status: 429, headers });
  }

  // Inbound notification to verify@ (best-effort; never blocks the submission).
  if (env.RESEND_API_KEY) {
    const fields = Object.entries(payload).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n');
    sendAdminNotificationEmail({
      subject: `[Contribute] ${type}${severity ? ` (${severity})` : ''} from ${ctx.email}`,
      body: `Type: ${type}${severity ? `\nSeverity: ${severity}` : ''}\nFrom: ${ctx.email}\nAgent: ${agent.agent_id}\n\n${fields}\n\nReview: https://verigent.ai/admin (Contributions tab)`,
    }, mailerFromEnv(env)).catch(() => {});
  }

  return Response.json({ ok: true, id }, { headers });
};
