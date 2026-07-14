// POST /api/owner/verify-code — { email, handle, code } → mint the owner session on a correct code.
// Single-use (atomic consume), attempt-capped, constant-time compare, fail-closed. On success sets the
// vg_owner cookie using the same realm + mint as /api/owner/verify-link, so the report's is_owner
// detection lights up in place. Realm isolation from admin is inherited from owner-auth.

import { mintOwnerSession, ownerSessionCookie } from '../../lib/owner-auth';
import { hashCode, normaliseCode, verifyCodeDecision, MAX_CODE_ATTEMPTS } from '../../lib/owner-code';

interface Env { DB: D1Database; OWNER_AUTH_SECRET?: string; }

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body: unknown, status: number, cookie?: string): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...CORS };
  if (cookie) headers['Set-Cookie'] = cookie;
  return new Response(JSON.stringify(body), { status, headers });
}

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204, headers: CORS });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Fail closed — no session secret means mint nothing; verify can never succeed.
  if (!env.OWNER_AUTH_SECRET) return json({ ok: false, error: 'unavailable' }, 503);

  let email = '', handle = '', codeInput = '';
  try {
    const b = (await request.json()) as { email?: string; handle?: string; code?: string };
    email = (b?.email || '').toString().trim().toLowerCase();
    handle = (b?.handle || '').toString().trim();
    codeInput = normaliseCode((b?.code || '').toString());
  } catch { return json({ ok: false, error: 'bad_request' }, 400); }
  // handle is OPTIONAL (spec §3): present → AGENT-scoped verify; absent → OWNER-scoped (email-only).
  if (!email || !codeInput) return json({ ok: false, error: 'bad_request' }, 400);

  // STAGING FIXED CODE (Ant 2026-07-13) — VERIFY-SIDE fallback, the edge-proof half of the pair in
  // request-code.ts. Staging email is log-only (real codes are unreadable) AND Pages alias flips
  // propagate per-edge, so a code row minted by a stale edge can hold a random code the payer can
  // never know. When the fixed code is typed and the double gate passes (var set ONLY in
  // wrangler.staging.jsonc + the sim_env sentinel proves the staging DB — same locks as the sim
  // clock; Cloudflare Access fronts it all), mint the session for the email's owner directly,
  // independent of any stored row. Prod: var absent AND sentinel unplantable → dead code.
  if ((env as any).STAGING_FIXED_LOGIN_CODE && codeInput === normaliseCode(String((env as any).STAGING_FIXED_LOGIN_CODE))) {
    try {
      const { assertStagingDb } = await import('../../lib/sim-clock');
      await assertStagingDb(env.DB);
      const owner = await env.DB.prepare('SELECT owner_id FROM owners WHERE email = ?').bind(email).first<{ owner_id: string }>();
      if (owner?.owner_id) {
        const token = await mintOwnerSession(owner.owner_id, env.OWNER_AUTH_SECRET);
        if (token) return json({ ok: true }, 200, ownerSessionCookie(token));
      }
    } catch { /* not provably staging → fall through to the real row-matched path */ }
  }

  // Resolve the target row. AGENT-scoped: the latest un-consumed code for this email + THAT agent.
  // OWNER-scoped: the latest un-consumed code for this email with NO agent (agent_id IS NULL). Decoy
  // rows (empty owner_id/code_hash) never verify. Both mint the same vg_owner session from row.owner_id.
  let row: { id: number; owner_id: string; code_hash: string; attempts: number; expires_at: string } | null;
  if (handle) {
    const agent = await env.DB.prepare(
      'SELECT agent_id FROM agents WHERE handle = ? COLLATE NOCASE OR agent_id = ? COLLATE NOCASE',
    ).bind(handle, handle).first<{ agent_id: string }>();
    if (!agent) return json({ ok: false, error: 'invalid_code' }, 401);
    row = await env.DB.prepare(
      'SELECT id, owner_id, code_hash, attempts, expires_at FROM owner_login_codes WHERE email = ? AND agent_id = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1',
    ).bind(email, agent.agent_id).first<{ id: number; owner_id: string; code_hash: string; attempts: number; expires_at: string }>();
  } else {
    row = await env.DB.prepare(
      'SELECT id, owner_id, code_hash, attempts, expires_at FROM owner_login_codes WHERE email = ? AND agent_id IS NULL AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1',
    ).bind(email).first<{ id: number; owner_id: string; code_hash: string; attempts: number; expires_at: string }>();
  }
  if (!row) return json({ ok: false, error: 'invalid_code' }, 401);

  const inputHash = await hashCode(codeInput);
  const verdict = verifyCodeDecision(row, inputHash, Date.now());

  if (verdict === 'invalid') return json({ ok: false, error: 'invalid_code' }, 401);
  if (verdict === 'expired') {
    await env.DB.prepare("UPDATE owner_login_codes SET consumed_at = datetime('now') WHERE id = ?").bind(row.id).run();
    return json({ ok: false, error: 'expired' }, 401);
  }
  if (verdict === 'capped') {
    await env.DB.prepare("UPDATE owner_login_codes SET consumed_at = datetime('now') WHERE id = ?").bind(row.id).run();
    return json({ ok: false, error: 'too_many_attempts' }, 429);
  }
  if (verdict === 'wrong') {
    // Wrong guess — count it; invalidate the code once the cap is reached.
    await env.DB.prepare(
      "UPDATE owner_login_codes SET attempts = attempts + 1, consumed_at = CASE WHEN attempts + 1 >= ? THEN datetime('now') ELSE consumed_at END WHERE id = ?",
    ).bind(MAX_CODE_ATTEMPTS, row.id).run();
    return json({ ok: false, error: 'invalid_code' }, 401);
  }

  // verdict === 'ok' → atomic single-use consume (only the call that flips consumed_at NULL→now), then
  // mint the owner session for the owner-of-record this code was bound to.
  const claim = await env.DB.prepare(
    "UPDATE owner_login_codes SET consumed_at = datetime('now') WHERE id = ? AND consumed_at IS NULL",
  ).bind(row.id).run();
  if (!claim?.meta?.changes) return json({ ok: false, error: 'invalid_code' }, 401); // raced / already used

  const session = await mintOwnerSession(row.owner_id, env.OWNER_AUTH_SECRET);
  if (!session) return json({ ok: false, error: 'unavailable' }, 503); // fail closed
  return json({ ok: true }, 200, ownerSessionCookie(session));
};
