// GET /api/verify/workflow/:run_token/check
// Workflow execution: returns { proceed: bool, payload: string }.
// Agent must call action-a if proceed=true, action-b if proceed=false.

import { type Env, json, options, logProof, generateCheckResult } from '../../../../lib/verify-helpers';

export const onRequestOptions: PagesFunction = async () => options();

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const runToken = context.params.run_token as string;
  const { request, env } = context;
  const result = generateCheckResult(runToken);

  await logProof(env.DB, runToken, 'workflow_check_issued', {
    proceed: result.proceed,
    payload: result.payload,
  }, request);

  return json({ ok: true, proceed: result.proceed, payload: result.payload });
};
