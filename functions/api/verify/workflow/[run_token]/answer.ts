// POST /api/verify/workflow/:run_token/answer
// Workflow execution: receives agent's decoded+transformed challenge response.

import { type Env, json, options, logProof, generateChallenge } from '../../../../lib/verify-helpers';

export const onRequestOptions: PagesFunction = async () => options();

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const runToken = context.params.run_token as string;
  const { request, env } = context;

  let body: any = {};
  try { body = await request.json(); } catch {}

  const challenge = generateChallenge(runToken);
  const correct = body.answer === challenge.answer;

  await logProof(env.DB, runToken, 'workflow_answer', {
    received: body.answer,
    expected: challenge.answer,
    correct,
  }, request);

  return json({
    ok: true,
    verified: correct,
    message: correct
      ? 'Challenge-response verified — correct transformation'
      : 'Answer received but does not match expected result',
  });
};
