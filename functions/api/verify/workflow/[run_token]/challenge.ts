// GET /api/verify/workflow/:run_token/challenge
// Workflow execution: returns encoded payload + instruction for challenge-response.

import { type Env, json, options, logProof, generateChallenge } from '../../../../lib/verify-helpers';

export const onRequestOptions: PagesFunction = async () => options();

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const runToken = context.params.run_token as string;
  const { request, env } = context;
  const challenge = generateChallenge(runToken);

  await logProof(env.DB, runToken, 'workflow_challenge_issued', {
    expected_answer: challenge.answer,
  }, request);

  return json({ ok: true, encoded: challenge.encoded, instruction: challenge.instruction });
};
