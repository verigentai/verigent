// /api/owner/autotopup — read + update an AGENT's auto top-up settings (docs/AUTO-TOPUP.md, step 1b).
// Auth-gated by the vg_owner cookie. Settings (enabled/threshold/amount + last_status) are PER-AGENT
// now — each agent recharges on its own threshold. The CARD + login email stay owner-level (the
// person's shared instrument). The request names the agent by ?handle= (GET) / {handle} (POST); the
// session owner must OWN that agent.
//
// GET  ?handle=…            → {enabled, threshold_usd, amount_usd, card: {saved, last4}, last_status}
// POST {handle, enabled?, threshold_usd?, amount_usd?} → validates, persists on the agent, returns GET shape.

import { verifyOwnerSession, getOwnerTokenFromCookie } from '../../lib/owner-auth';

interface Env {
  DB: D1Database;
  OWNER_AUTH_SECRET?: string;
  STRIPE_SECRET_KEY?: string;   // remove_card: best-effort detach at Stripe
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Card-rail bounds: threshold $1–$100; recharge amount $10 (card minimum, pricing.ts) – $500.
const THRESHOLD_MIN_CENTS = 100;
const THRESHOLD_MAX_CENTS = 10000;
const AMOUNT_MIN_CENTS = 1000;
const AMOUNT_MAX_CENTS = 50000;

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204, headers: CORS });

// Resolve the target agent from a handle/agent_id AND assert the session owner owns it. Returns the
// agent row (settings) joined with the owner's card, or null if not owned / not found.
async function ownedAgent(db: D1Database, ownerId: string, handle: string) {
  if (!handle) return null;
  const a = await db.prepare(
    `SELECT a.agent_id, a.owner_id, a.autotopup_enabled, a.autotopup_threshold_cents,
            a.autotopup_amount_cents, a.autotopup_last_status,
            o.email, o.stripe_customer_id, o.stripe_payment_method_id, o.stripe_card_last4
     FROM agents a JOIN owners o ON o.owner_id = a.owner_id
     WHERE (a.handle = ? COLLATE NOCASE OR a.agent_id = ? COLLATE NOCASE) AND a.owner_id = ?`
  ).bind(handle, handle, ownerId).first() as any;
  return a || null;
}

function payloadFor(a: any) {
  return {
    enabled: !!a.autotopup_enabled,
    threshold_usd: (a.autotopup_threshold_cents ?? 500) / 100,
    amount_usd: (a.autotopup_amount_cents ?? 1000) / 100,
    // CARD stays owner-level (the person's shared instrument).
    card: { saved: !!(a.stripe_customer_id && a.stripe_payment_method_id), last4: a.stripe_card_last4 || null },
    // where low-balance alerts go when there's no saved card (crypto payers)
    email: (a.email || '').includes('@') ? a.email : null,
    last_status: a.autotopup_last_status || null,
  };
}

async function authedOwnerId(request: Request, env: Env): Promise<string | null> {
  const token = getOwnerTokenFromCookie(request.headers.get('Cookie'));
  return verifyOwnerSession(token, env.OWNER_AUTH_SECRET);
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const headers = { 'Content-Type': 'application/json', ...CORS };
  const ownerId = await authedOwnerId(request, env);
  if (!ownerId) return Response.json({ error: 'Unauthorized' }, { status: 401, headers });

  const handle = (new URL(request.url).searchParams.get('handle') || '').trim();
  const a = await ownedAgent(env.DB, ownerId, handle);
  if (!a) return Response.json({ error: 'Not found' }, { status: 404, headers });
  return Response.json(payloadFor(a), { headers });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const headers = { 'Content-Type': 'application/json', ...CORS };
  const ownerId = await authedOwnerId(request, env);
  if (!ownerId) return Response.json({ error: 'Unauthorized' }, { status: 401, headers });

  let body: any;
  try { body = await request.json(); } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400, headers });
  }

  // REMOVE CARD (save-card opt-in, Ant 2026-07-13): detach the owner's shared instrument entirely.
  // Clears the owner columns (authoritative) + best-effort detaches at Stripe + disables auto-topup
  // on ALL the owner's agents — a removed card can't back anything. stripe_customer_id is KEPT (a
  // future save reuses the customer object; it holds no charge capability without a payment method).
  if (body.remove_card === true) {
    const owner = await env.DB.prepare('SELECT stripe_payment_method_id FROM owners WHERE owner_id = ?').bind(ownerId).first() as any;
    if (owner?.stripe_payment_method_id && env.STRIPE_SECRET_KEY) {
      await fetch(`https://api.stripe.com/v1/payment_methods/${owner.stripe_payment_method_id}/detach`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` },
      }).catch(() => {});
    }
    await env.DB.batch([
      env.DB.prepare('UPDATE owners SET stripe_payment_method_id = NULL, stripe_card_last4 = NULL WHERE owner_id = ?').bind(ownerId),
      env.DB.prepare('UPDATE agents SET autotopup_enabled = 0 WHERE owner_id = ?').bind(ownerId),
    ]);
    return Response.json({ ok: true, removed: true, card: { saved: false, last4: null } }, { headers });
  }

  const handle = (body.handle || '').toString().trim();
  const a = await ownedAgent(env.DB, ownerId, handle);
  if (!a) return Response.json({ error: 'Not found' }, { status: 404, headers });

  const sets: string[] = [];
  const binds: any[] = [];

  if (body.enabled !== undefined) {
    sets.push('autotopup_enabled = ?');
    binds.push(body.enabled ? 1 : 0);
  }
  if (body.threshold_usd !== undefined) {
    const cents = Math.round(Number(body.threshold_usd) * 100);
    if (!Number.isFinite(cents) || cents < THRESHOLD_MIN_CENTS || cents > THRESHOLD_MAX_CENTS) {
      return Response.json({ error: `threshold_usd must be between ${THRESHOLD_MIN_CENTS / 100} and ${THRESHOLD_MAX_CENTS / 100}` }, { status: 400, headers });
    }
    sets.push('autotopup_threshold_cents = ?');
    binds.push(cents);
  }
  if (body.amount_usd !== undefined) {
    const cents = Math.round(Number(body.amount_usd) * 100);
    if (!Number.isFinite(cents) || cents < AMOUNT_MIN_CENTS || cents > AMOUNT_MAX_CENTS) {
      return Response.json({ error: `amount_usd must be between ${AMOUNT_MIN_CENTS / 100} and ${AMOUNT_MAX_CENTS / 100}` }, { status: 400, headers });
    }
    sets.push('autotopup_amount_cents = ?');
    binds.push(cents);
  }

  if (sets.length === 0) {
    return Response.json({ error: 'Nothing to update — pass enabled, threshold_usd and/or amount_usd' }, { status: 400, headers });
  }

  // Persist on the AGENT (ownership already asserted by ownedAgent).
  await env.DB.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE agent_id = ?`)
    .bind(...binds, a.agent_id).run();

  const updated = await ownedAgent(env.DB, ownerId, handle);
  return Response.json(payloadFor(updated), { headers });
};
