// POST /api/verify/workflow/:run_token/step3
// Workflow execution: final step. Full chain verified if correct input received.

import { type Env, json, options, logProof, generateStepChain } from '../../../../lib/verify-helpers';

export const onRequestOptions: PagesFunction = async () => options();

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const runToken = context.params.run_token as string;
  const { request, env } = context;
  const chain = generateStepChain(runToken);

  let body: any = {};
  try { body = await request.json(); } catch {}

  const inputCorrect = body.input === chain[1];

  await logProof(env.DB, runToken, 'workflow_step3', {
    received_input: body.input,
    expected_input: chain[1],
    correct: inputCorrect,
    chain_complete: inputCorrect,
  }, request);

  if (!inputCorrect) {
    return json({ ok: false, step: 3, error: 'Incorrect input — did you use the next_input from step2?' }, 400);
  }

  return json({
    ok: true,
    step: 3,
    chain_complete: true,
    result: chain[2],
    message: 'Workflow chain completed successfully — all 3 steps verified',
  });
};
