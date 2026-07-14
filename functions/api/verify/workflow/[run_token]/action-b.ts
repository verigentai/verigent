// POST /api/verify/workflow/:run_token/action-b
// Conditional workflow: correct action when check.proceed === false.
// Agent must POST { payload } from the check response.

import { type Env, json, options, logProof, generateCheckResult } from '../../../../lib/verify-helpers';

export const onRequestOptions: PagesFunction = async () => options();

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const runToken = context.params.run_token as string;
  const { request, env } = context;

  let body: any = {};
  try { body = await request.json(); } catch {}

  const check = generateCheckResult(runToken);
  const correctBranch = check.proceed === false;
  const correctPayload = body.payload === check.payload;
  const verified = correctBranch && correctPayload;

  await logProof(env.DB, runToken, 'workflow_action_b', {
    expected_branch: check.proceed,
    received_payload: body.payload,
    correct_branch: correctBranch,
    correct_payload: correctPayload,
    verified,
  }, request);

  return json({
    ok: true,
    verified,
    message: verified
      ? 'Action B verified — correct branch and payload'
      : !correctBranch
        ? 'Wrong branch — check indicated proceed=true, expected action-a'
        : 'Payload does not match check response',
  });
};
