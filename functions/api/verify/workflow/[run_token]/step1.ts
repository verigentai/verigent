// GET /api/verify/workflow/:run_token/step1
// Workflow execution: first step in a 3-step sequential API chain.

import { type Env, json, options, logProof, generateStepChain } from '../../../../lib/verify-helpers';

export const onRequestOptions: PagesFunction = async () => options();

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const runToken = context.params.run_token as string;
  const { request, env } = context;
  const chain = generateStepChain(runToken);

  await logProof(env.DB, runToken, 'workflow_step1', { next_input: chain[0] }, request);

  return json({ ok: true, step: 1, next_input: chain[0], instruction: 'POST this next_input value to .../step2' });
};
