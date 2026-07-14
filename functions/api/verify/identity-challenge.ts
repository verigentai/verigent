// POST /api/verify/identity-challenge — prove a VG-key holder controls the bound identity.
// Body: { handle, nonce, signature, algorithm? }
//   - The CALLER supplies its own fresh nonce (controls freshness — no server-issued token
//     to store), gets the target agent to sign it, and posts the signature here.
//   - Verigent verifies the signature against the pubkey bound to that agent at test time.
// Returns: { ok, valid, handle, algorithm }. Fully stateless. Anyone may call it.
//
// Counterparties who can do ed25519 locally don't even need this — fetch the pubkey from
// /api/verify/:handle and verify yourself. This is a convenience for those who can't.

import { verifyIdentityProof } from '../../lib/sovereignty-tests';

interface Env { DB: D1Database; }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204, headers: CORS });

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: any = {};
  try { body = await context.request.json(); } catch {}
  const handle = (body.handle || '').toString().toLowerCase();
  const nonce = (body.nonce || '').toString();
  const signature = (body.signature || '').toString();
  const algorithm = (body.algorithm || '').toString() || undefined;

  if (!handle || !nonce || !signature) {
    return json({ ok: false, error: 'handle, nonce and signature are required' }, 400);
  }

  const agent = await context.env.DB.prepare(
    'SELECT identity_pubkey, identity_algorithm FROM agents WHERE LOWER(handle) = ?'
  ).bind(handle).first() as any;

  if (!agent) return json({ ok: false, error: 'AGENT_NOT_FOUND' }, 404);
  if (!agent.identity_pubkey) {
    return json({ ok: true, valid: false, reason: 'NO_BOUND_IDENTITY', hint: 'This agent has no cryptographic identity bound to its VG key.' });
  }

  const result = await verifyIdentityProof(
    nonce,
    agent.identity_pubkey,
    signature,
    algorithm || agent.identity_algorithm || 'ed25519',
  );

  return json({
    ok: true,
    valid: !!result.verified,
    handle,
    algorithm: algorithm || agent.identity_algorithm || 'ed25519',
    reason: result.verified ? 'Signature matches the identity bound at verification time.' : (result.reason || 'Signature did not verify against the bound public key.'),
  });
};
