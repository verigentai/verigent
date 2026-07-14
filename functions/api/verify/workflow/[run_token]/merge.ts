// POST /api/verify/workflow/:run_token/merge
// Workflow execution: receives merged data from source-a + source-b. Verifies correctness.

import { type Env, json, options, logProof, generateSourceA, generateSourceB } from '../../../../lib/verify-helpers';

export const onRequestOptions: PagesFunction = async () => options();

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const runToken = context.params.run_token as string;
  const { request, env } = context;

  let submitted: any[] = [];
  try { submitted = await request.json() as any[]; } catch {}

  const sourceA = generateSourceA(runToken);
  const sourceB = generateSourceB(runToken);
  const expected = sourceA.map(a => {
    const b = sourceB.find(b => b.id === a.id);
    return { id: a.id, name: a.name, score: b?.score ?? null };
  });

  const correct = Array.isArray(submitted) &&
    submitted.length === expected.length &&
    expected.every(exp =>
      submitted.some((sub: any) => sub.id === exp.id && sub.name === exp.name && sub.score === exp.score)
    );

  await logProof(env.DB, runToken, 'workflow_merge', {
    submitted_count: Array.isArray(submitted) ? submitted.length : 0,
    correct,
  }, request);

  return json({
    ok: true,
    verified: correct,
    message: correct
      ? 'Merge verified — all items correctly joined by id'
      : 'Received but merged data does not match expected result',
  });
};
