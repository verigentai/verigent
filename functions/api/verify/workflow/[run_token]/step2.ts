// POST /api/verify/workflow/:run_token/step2
// Workflow execution: second step. Verifies agent sent step1's output as input.

import { type Env, json, options, logProof, generateStepChain } from '../../../../lib/verify-helpers';

export const onRequestOptions: PagesFunction = async () => options();

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const runToken = context.params.run_token as string;
  const { request, env } = context;
  const chain = generateStepChain(runToken);

  let body: any = {};
  try { body = await request.json(); } catch {}

  const inputCorrect = body.input === chain[0];

  await logProof(env.DB, runToken, 'workflow_step2', {
    received_input: body.input,
    expected_input: chain[0],
    correct: inputCorrect,
  }, request);

  if (!inputCorrect) {
    return json({ ok: false, step: 2, error: 'Incorrect input — did you use the next_input from step1?' }, 400);
  }

  return json({ ok: true, step: 2, next_input: chain[1], instruction: 'POST this next_input value to .../step3' });
};
