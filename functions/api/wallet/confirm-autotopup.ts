// POST /api/wallet/confirm-autotopup — body { payment_intent_id }
//
// The ENABLE step of the save-card opt-in (Ant 2026-07-13). The payer just ticked "keep this card
// for automatic top-ups" and completed payment; the client calls this with the PaymentIntent id it
// paid. The PI id is the capability: unguessable, and we verify against Stripe that it (1) really
// succeeded, (2) was a wallet top-up, (3) carried the save-card opt-in. Only then does auto-topup
// flip ON for the topped-up agent. Enabling is therefore always downstream of an explicit tick +
// a completed payment — never silent (§2.7 copy-firewall adjacent: no dark-pattern auto-enrol).
//
// Also re-runs the card save itself (idempotent) so the enable never races the webhook: whichever
// of webhook/confirm lands first persists the instrument; the second is a no-op rewrite.

import { ownerIdForAgent } from '../../lib/wallet';
import { saveCardForAutotopup } from '../../lib/autotopup';

interface Env {
  DB: D1Database;
  STRIPE_SECRET_KEY?: string;
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const headers = { 'Content-Type': 'application/json', ...CORS };
  let body: any = {};
  try { body = await request.json(); } catch {}
  const piId = String(body?.payment_intent_id || '').trim();
  if (!/^pi_[A-Za-z0-9]+$/.test(piId)) {
    return Response.json({ error: 'payment_intent_id required' }, { status: 400, headers });
  }
  if (!env.STRIPE_SECRET_KEY) {
    return Response.json({ error: 'Stripe payments not configured' }, { status: 503, headers });
  }

  // Truth from Stripe, never the client: the PI must be succeeded + a wallet top-up + opted-in.
  const piRes = await fetch(`https://api.stripe.com/v1/payment_intents/${piId}`, {
    headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  if (!piRes.ok) return Response.json({ error: 'Payment not found' }, { status: 404, headers });
  const pi = await piRes.json() as any;
  const agentId = pi?.metadata?.agent_id;
  if (pi?.status !== 'succeeded' || pi?.metadata?.type !== 'wallet_topup' || pi?.metadata?.save_card !== '1' || !agentId) {
    return Response.json({ error: 'This payment did not carry the save-card opt-in' }, { status: 400, headers });
  }

  const db = env.DB;
  const ownerId = await ownerIdForAgent(db, agentId);
  if (!ownerId) return Response.json({ error: 'Owner not found' }, { status: 404, headers });

  // Persist the instrument (idempotent — the webhook may already have).
  const customerId = typeof pi.customer === 'string' ? pi.customer : pi.customer?.id;
  await saveCardForAutotopup(db, env, ownerId, { customerId, piId });

  // Flip auto-topup ON for THIS agent (per-agent dials, owner-level card — v34 model). Threshold and
  // amount keep their defaults/prior values; the owner tunes them from their controls.
  await db.prepare('UPDATE agents SET autotopup_enabled = 1 WHERE agent_id = ?').bind(agentId).run();

  const agent = await db.prepare(
    'SELECT handle, autotopup_threshold_cents, autotopup_amount_cents FROM agents WHERE agent_id = ?'
  ).bind(agentId).first() as any;
  const owner = await db.prepare('SELECT stripe_card_last4 FROM owners WHERE owner_id = ?').bind(ownerId).first() as any;

  return Response.json({
    ok: true,
    enabled: true,
    handle: agent?.handle || null,
    card_last4: owner?.stripe_card_last4 || null,
    threshold_cents: agent?.autotopup_threshold_cents ?? 500,
    amount_cents: agent?.autotopup_amount_cents ?? 1000,
  }, { headers });
};
