// GET /api/verify/workflow/:run_token/data
// Workflow execution: returns array for filter-sort-submit task.

import { type Env, json, options, logProof, generateWorkflowData } from '../../../../lib/verify-helpers';

export const onRequestOptions: PagesFunction = async () => options();

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const runToken = context.params.run_token as string;
  const { request, env } = context;
  const data = generateWorkflowData(runToken);

  await logProof(env.DB, runToken, 'workflow_data_fetch', { item_count: data.length }, request);

  return json(data);
};
