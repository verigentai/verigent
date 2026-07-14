// GET /api/verify/recover/:run_token/auth-shift
// failure_learning (recover_auth_shift): an auth-scheme shift. The endpoint is described (in the task
// prompt) as Bearer-authenticated, but a Bearer request is REJECTED with 401 + a WWW-Authenticate hint
// that the real scheme is the "X-Api-Key" header. Correct recovery = read the hint and re-request with
// the SAME token in an X-Api-Key header. The expected token is HMAC-derived from the run token and is
// substituted into the prompt in run.ts ({RECOVER_AUTH_TOKEN}), so only the assigned agent sees it.

import { type Env, CORS, json, options, logProof, deriveSkillProof } from '../../../../lib/verify-helpers';

export const onRequestOptions: PagesFunction = async () => options();

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const runToken = context.params.run_token as string;
  const { request, env } = context;

  const expected = await deriveSkillProof(runToken, 'recover_auth_shift', env.SKILL_HMAC_SECRET, 24);

  const apiKey = request.headers.get('x-api-key') || '';
  const authHeader = request.headers.get('authorization') || '';
  const bearer = authHeader.replace(/^Bearer\s+/i, '');
  const usedBearer = authHeader.toLowerCase().startsWith('bearer ');

  // Correct recovery: the token arrived in the X-Api-Key header AND matches the expected value.
  const corrected = apiKey.length > 0 && apiKey === expected;

  await logProof(env.DB, runToken, 'recover_auth_shift', {
    corrected,
    used_bearer: usedBearer,
    used_api_key_header: apiKey.length > 0,
    api_key_matched: corrected,
    // `correct` stamped at grade time (the completion token must appear in the agent's answer).
  }, request);

  if (!corrected) {
    // Reject Bearer (or missing/wrong key) and hint the correct scheme via a real WWW-Authenticate
    // header (the machine-readable recovery signal) plus a human-readable body detail.
    return new Response(
      JSON.stringify({
        error: 'unauthorized',
        detail: usedBearer
          ? 'This endpoint does not accept Bearer auth. Re-request with the X-Api-Key header (same token value).'
          : 'Missing or incorrect credentials. Send the token in an X-Api-Key header.',
        hint: 'scheme=X-Api-Key',
      }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': 'X-Api-Key realm="verigent-recover", error="use the X-Api-Key header"',
          ...CORS,
        },
      },
    );
  }

  const completionToken = await deriveSkillProof(runToken, 'recover_auth_shift_done', env.SKILL_HMAC_SECRET, 12);
  return json({
    ok: true,
    corrected: true,
    completion_token: completionToken,
    message: 'Auth scheme corrected. Return the completion_token to complete the task.',
  });
};
