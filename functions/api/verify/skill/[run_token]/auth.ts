// GET /api/verify/skill/:run_token/auth
// Skill breadth: requires Bearer token auth. Verifies agent can send Authorization headers.
// Server-side proof — we log whether the correct token arrived.

import { type Env, json, options, logProof, deriveSkillProof } from '../../../../lib/verify-helpers';

export const onRequestOptions: PagesFunction = async () => options();

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const runToken = context.params.run_token as string;
  const { request, env } = context;

  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const hasAuth = authHeader.toLowerCase().startsWith('bearer ') && token.length > 0;

  // Require the EXACT expected token for this run (Codex): any Bearer token is not a pass.
  const expected = await deriveSkillProof(runToken, 'skill_auth', env.SKILL_HMAC_SECRET, 24);
  const correct = hasAuth && token === expected;

  await logProof(env.DB, runToken, 'skill_auth', {
    correct,
    auth_header_present: hasAuth,
    token_matched: correct,
    token_received: token || null,
  }, request);

  if (!correct) {
    return json({ ok: false, error: hasAuth
      ? 'Bearer token did not match the expected value for this run.'
      : 'Authorization required. Send the Bearer token from the task prompt.' }, 401);
  }

  return json({
    ok: true,
    verified: true,
    message: 'Authenticated request verified',
    server_time: new Date().toISOString(),
  });
};
