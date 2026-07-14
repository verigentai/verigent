// GET /api/verify/skill/:run_token/fetch
// Skill breadth: returns randomised JSON data. Agent must extract data.items[2].code.
// Server-side proof — if the agent returns the correct value, it made a real fetch.

import { type Env, json, options, logProof, generateFetchData } from '../../../../lib/verify-helpers';

export const onRequestOptions: PagesFunction = async () => options();

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const runToken = context.params.run_token as string;
  const { request, env } = context;

  const data = generateFetchData(runToken);

  await logProof(env.DB, runToken, 'skill_fetch', {
    expected_answer: data.items[2].code,
  }, request);

  return json({ ok: true, data, server_time: new Date().toISOString() });
};
