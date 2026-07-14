// GET /api/verify/recover/:run_token/flaky
// failure_learning (recover_flaky): a deliberately flaky upstream. The FIRST GET returns a 500 with
// failure semantics in the body ("retry":"safe"); the SECOND+ GET returns 200 with a payload token.
// Correct behaviour = read the failure semantics, retry the safe request, and return the payload token.
// We track attempts server-side per run_token by counting prior recover_flaky proof rows, so a single
// blind retry succeeds but excessive blind hammering is visible to the scorer (blind-hammer cap).

import { type Env, json, options, logProof, deriveSkillProof } from '../../../../lib/verify-helpers';

export const onRequestOptions: PagesFunction = async () => options();

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const runToken = context.params.run_token as string;
  const { request, env } = context;

  // Count prior attempts for THIS run+endpoint (each GET logs a proof row). attempt 0 = first hit.
  let priorAttempts = 0;
  try {
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM skill_proofs WHERE run_token = ? AND proof_type = 'recover_flaky'",
    ).bind(runToken).first<{ c: number }>();
    priorAttempts = row?.c ?? 0;
  } catch { /* table may not exist yet — treat as first attempt */ }

  const attempt = priorAttempts + 1; // 1-indexed attempt number for this request
  const recovered = attempt >= 2;    // first attempt fails; any retry recovers
  const payloadToken = recovered
    ? await deriveSkillProof(runToken, 'recover_flaky', env.SKILL_HMAC_SECRET, 12)
    : null;

  await logProof(env.DB, runToken, 'recover_flaky', {
    attempt,
    recovered,
    // `correct` is stamped at grade time (the returned token must appear in the agent's answer). We
    // record attempt bookkeeping the grader reads to award the recovery band / apply the hammer cap.
    payload_token: payloadToken,
  }, request);

  if (!recovered) {
    // Transient failure — semantics tell the agent the request is safe to retry.
    return json({ error: 'transient upstream failure', retry: 'safe', attempt }, 500);
  }

  return json({
    ok: true,
    recovered: true,
    attempt,
    payload_token: payloadToken,
    message: 'Recovered after retry. Return the payload_token to complete the task.',
  });
};
