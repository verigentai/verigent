// POST /api/verify/webhook/:run_token
// Receives webhook proof callbacks from agents proving infrastructure independence.
// The proof must be HMAC-SHA256(per-run webhook secret, fresh grade-time challenge) — same
// prior-secret-possession bar as the direct response path (ruling 2026-07-02). A bare echo of
// the challenge is worthless here too.

import { computeWebhookProof, evaluateWebhookResponse } from '../../../lib/sovereignty-tests';

interface Env {
  DB: D1Database;
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, { status: 204, headers: CORS });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;
  const headers = { 'Content-Type': 'application/json', ...CORS };
  const runToken = params.run_token as string;

  if (!runToken) {
    return new Response(JSON.stringify({ error: 'run_token required' }), { status: 400, headers });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers });
  }

  const proof = body.proof;
  if (!proof) {
    return new Response(JSON.stringify({ error: 'proof field required' }), { status: 400, headers });
  }

  try {
    // Match the NEWEST pending challenge for this run (5f fix 3b): grade-batch can re-enter and
    // issue a fresh challenge, so an ORDER-less SELECT could grab a stale row and verify the wrong
    // challenge. Newest pending row = the challenge currently in flight.
    const webhook = await env.DB.prepare(
      'SELECT * FROM sovereignty_webhooks WHERE run_token = ? AND response_received = 0 ORDER BY id DESC LIMIT 1'
    ).bind(runToken).first() as any;

    if (!webhook) {
      return new Response(JSON.stringify({ error: 'No pending webhook challenge for this run' }), { status: 404, headers });
    }

    // The bar is the HMAC of the stored fresh challenge under the run's webhook secret.
    const run = await env.DB.prepare(
      'SELECT sovereignty_challenges FROM runs WHERE run_token = ?'
    ).bind(runToken).first() as any;
    const webhookSecret = run?.sovereignty_challenges
      ? JSON.parse(run.sovereignty_challenges)?.infrastructure?.webhookSecret
      : null;

    let matches = false;
    if (webhookSecret) {
      const expectedProof = await computeWebhookProof(webhookSecret, webhook.challenge_payload);
      matches = evaluateWebhookResponse(proof, webhook.challenge_payload, expectedProof).verified;
    }

    // Consume the row (response_received = 1) ONLY when the proof VERIFIES (5f fix 3a). A wrong/junk
    // POST used to consume the pending row, so a correct retry within the window then 404'd. We still
    // STORE the latest proof either way, so grade-batch and the eval-completion re-check can evaluate
    // an async callback that lands after the sync window (5f fix 2).
    if (matches) {
      await env.DB.prepare(
        "UPDATE sovereignty_webhooks SET response_received = 1, response_proof = ?, response_at = datetime('now') WHERE id = ?"
      ).bind(proof, webhook.id).run();
    } else {
      await env.DB.prepare(
        "UPDATE sovereignty_webhooks SET response_proof = ?, response_at = datetime('now') WHERE id = ?"
      ).bind(proof, webhook.id).run();
    }

    return new Response(JSON.stringify({
      ok: true,
      verified: matches,
      message: matches
        ? 'Webhook proof verified — valid HMAC of the fresh challenge'
        : 'Proof received but it is not the required HMAC(secret, challenge). You may re-POST the correct proof.',
    }), { status: 200, headers });
  } catch {
    return new Response(JSON.stringify({ error: 'Webhook verification failed' }), { status: 500, headers });
  }
};
