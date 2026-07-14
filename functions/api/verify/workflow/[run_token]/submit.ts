// POST /api/verify/workflow/:run_token/submit
// Workflow execution: receives filtered+sorted data from the agent. Verifies correctness.

import { type Env, json, options, logProof, generateWorkflowData } from '../../../../lib/verify-helpers';

export const onRequestOptions: PagesFunction = async () => options();

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const runToken = context.params.run_token as string;
  const { request, env } = context;

  let submitted: any[] = [];
  try { submitted = await request.json() as any[]; } catch {}

  const sourceData = generateWorkflowData(runToken);
  const expected = sourceData
    .filter(item => item.status === 'active')
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 3);

  const correct = Array.isArray(submitted) &&
    submitted.length === 3 &&
    submitted.every((item, i) => item.id === expected[i].id);

  await logProof(env.DB, runToken, 'workflow_submit', {
    submitted_count: Array.isArray(submitted) ? submitted.length : 0,
    expected_ids: expected.map(e => e.id),
    submitted_ids: Array.isArray(submitted) ? submitted.map((s: any) => s.id) : [],
    correct,
  }, request);

  return json({
    ok: true,
    verified: correct,
    message: correct
      ? 'Correct — filtered, sorted, and submitted the right items'
      : 'Received but data does not match expected filter/sort result',
  });
};
