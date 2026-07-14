// POST /api/verify/skill/:run_token/http
// Skill breadth: verifies agent can make HTTP POST with custom headers.
// Server-side proof — we check the X-Skill-Proof header matches the expected nonce.

import { type Env, CORS, json, options, logProof, deriveSkillProof } from '../../../../lib/verify-helpers';

export const onRequestOptions: PagesFunction = async () => options();

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const runToken = context.params.run_token as string;
  const { request, env } = context;

  const nonce = request.headers.get('x-skill-proof');
  let body: any = {};
  try { body = await request.json(); } catch {}

  // Require the EXACT expected proof for this run (Codex): presence is never a pass.
  const expected = await deriveSkillProof(runToken, 'skill_http', env.SKILL_HMAC_SECRET, 16);
  const correct = !!nonce && nonce === expected;

  await logProof(env.DB, runToken, 'skill_http', {
    correct,
    nonce_received: nonce,
    nonce_matched: correct,
    body,
    headers: {
      'x-skill-proof': nonce,
      'content-type': request.headers.get('content-type'),
      'user-agent': request.headers.get('user-agent'),
    },
  }, request);

  return json({
    ok: true,
    verified: correct,
    message: correct
      ? 'HTTP skill verified — correct X-Skill-Proof header'
      : (nonce ? 'X-Skill-Proof did not match the expected value for this run' : 'X-Skill-Proof header missing'),
    server_time: new Date().toISOString(),
  });
};
