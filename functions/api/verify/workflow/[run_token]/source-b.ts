// GET /api/verify/workflow/:run_token/source-b
// Workflow execution: returns array with id+score for merge task.

import { type Env, json, options, logProof, generateSourceB } from '../../../../lib/verify-helpers';

export const onRequestOptions: PagesFunction = async () => options();

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const runToken = context.params.run_token as string;
  const { request, env } = context;

  await logProof(env.DB, runToken, 'workflow_source_b', {}, request);

  return json(generateSourceB(runToken));
};
