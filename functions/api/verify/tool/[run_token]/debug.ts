// GET /api/verify/tool/:run_token/debug
// tools (tool_debug): a finicky tool endpoint the agent must DEBUG. A naive request is REJECTED with a
// 422 whose body states the exact corrections required — an Accept header of
// "application/vnd.verigent.tool+json" AND a "?mode=strict" query param. Correct tool use = read the
// error, apply BOTH corrections, and re-request. On success the response carries a completion_token.
// Proof-or-zero (§2.1): a described "I'd use curl / the SDK" answer produces NO proof row, so the
// scorer floors tools at the no-proof cap — a narrated tool answer can no longer beat a real one.
// Mirrors the recover/auth-shift "read-the-error-and-adapt" pattern; first-party, same-deployment.

import { type Env, CORS, json, options, logProof, deriveSkillProof } from '../../../../lib/verify-helpers';

export const onRequestOptions: PagesFunction = async () => options();

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const runToken = context.params.run_token as string;
  const { request, env } = context;
  const url = new URL(request.url);

  const accept = request.headers.get('accept') || '';
  const hasAccept = accept.includes('application/vnd.verigent.tool+json');
  const hasMode = url.searchParams.get('mode') === 'strict';
  const correct = hasAccept && hasMode;

  // Every hit logs a proof row (mirrors the recover endpoints), so `null` at grade time means the
  // agent never called the endpoint — a described-only answer.
  await logProof(env.DB, runToken, 'tool_debug', {
    correct,
    had_accept: hasAccept,
    had_mode: hasMode,
  }, request);

  if (!correct) {
    return new Response(
      JSON.stringify({
        error: 'tool_misconfigured',
        detail: 'This tool endpoint rejected your request. Apply the required corrections and re-request.',
        required: {
          accept_header: 'application/vnd.verigent.tool+json',
          query_param: 'mode=strict',
        },
        got: { accept: accept || null, mode: url.searchParams.get('mode') || null },
      }),
      { status: 422, headers: { 'Content-Type': 'application/json', ...CORS } },
    );
  }

  const completionToken = await deriveSkillProof(runToken, 'tool_debug_done', env.SKILL_HMAC_SECRET, 12);
  return json({
    ok: true,
    debugged: true,
    completion_token: completionToken,
    message: 'Tool call corrected. Return the completion_token to complete the task.',
  });
};
