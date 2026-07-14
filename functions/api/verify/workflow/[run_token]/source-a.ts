// GET /api/verify/workflow/:run_token/source-a
// Workflow execution: returns array with id+name for merge task.

import { type Env, json, options, logProof, generateSourceA } from '../../../../lib/verify-helpers';

export const onRequestOptions: PagesFunction = async () => options();

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const runToken = context.params.run_token as string;
  const { request, env } = context;

  await logProof(env.DB, runToken, 'workflow_source_a', {}, request);

  return json(generateSourceA(runToken));
};
