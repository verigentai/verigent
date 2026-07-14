// POST /api/wallet/topup — Create a Stripe checkout session or Lightning invoice for wallet topup.
// No account needed — agent handle or agent_id is the identity.

import { ownerIdForAgent } from '../../lib/wallet';
import { fetchBtcUsdRate, usdToMsat, msatToSats, fetchSolUsdRate, usdToLamports, assertSaneBtcRate } from '../../lib/lightning';
import { PAYMENT_CONFIG } from '../../lib/sovereignty-tests';
import { getTopupPlan, minTopupUsd, MAX_TOPUP_USD, type PayRail } from '../../lib/pricing';
import { verifyOwnerSession, getOwnerTokenFromCookie } from '../../lib/owner-auth';
import { scrubUrls } from '../../lib/log-scrub';
// @ts-ignore — extensionless JS sibling (resolved by the Pages/Workers bundler at runtime)
import { paymentsEnabledDb } from '../../lib/payments-flag.js';

interface Env {
  DB: D1Database;
  STRIPE_SECRET_KEY?: string;
  CLN_API_URL?: string;
  CLN_RUNE?: string;
  PAYMENTS_ENABLED?: string;
  OWNER_AUTH_SECRET?: string;   // owner-session verify — gates whether we may read/prefill the owner email
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

  // MASTER SWITCH (Ant 2026-06-29): all billing rails stay dark until PAYMENTS_ENABLED=true, even
  // with live keys wired. Flip one env var to go live.
  if (!(await paymentsEnabledDb(env, env.DB))) {
    return Response.json({ error: 'Payments are not live yet', code: 'payments_disabled' }, { status: 503, headers });
  }

  let body: any;
  try { body = await request.json(); } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400, headers });
  }

  const { handle, agent_id, amount_usd, amount_sats, method, plan } = body;
  if (!handle && !agent_id) {
    return Response.json({ error: 'handle or agent_id required' }, { status: 400, headers });
  }

  const payMethod = method || 'stripe';
  const rail: PayRail = payMethod === 'lightning' ? 'lightning' : payMethod === 'sol' ? 'sol' : 'fiat';

  // Resolve the amount: a named plan (monthly|sixmonth|annual) fixes the price; otherwise it's a
  // custom amount with a per-rail minimum (crypto rails have no fixed fee, so they go smaller).
  // UNIT OF ACCOUNT (Ant 2026-07-10): a Lightning payer thinks in sats, so amount_sats is accepted
  // natively — the invoice mints for EXACTLY the sats they typed, and the USD billing value derives
  // from the live rate here (never client-supplied).
  let payCents: number;
  let planKey: string;
  let requestedSats: number | null = null;
  // AMOUNTLESS Lightning (Ant 2026-07-10): no amount from our side at all — the invoice is minted
  // open-amount (CLN 'any') and the payer chooses in THEIR wallet, exactly like the Sol memo flow.
  // The credit is computed from what actually arrives (check-payment reads amount_received_msat).
  const amountless = payMethod === 'lightning' && amount_usd == null && amount_sats == null && !plan;
  const planDef = plan ? getTopupPlan(plan) : null;
  if (amountless) {
    payCents = 0;
    planKey = 'custom';
  } else if (planDef) {
    payCents = planDef.payCents;
    planKey = planDef.key;
  } else if (payMethod === 'lightning' && amount_sats != null) {
    const sats = Math.round(Number(amount_sats));
    if (!Number.isFinite(sats) || sats <= 0) {
      return Response.json({ error: 'amount_sats must be a positive number' }, { status: 400, headers });
    }
    const rate = assertSaneBtcRate(await fetchBtcUsdRate());
    const usd = (sats / 100_000_000) * rate;
    const minUsd = minTopupUsd(rail);
    if (usd < minUsd || usd > MAX_TOPUP_USD) {
      return Response.json({ error: `amount must be worth between $${minUsd} and $${MAX_TOPUP_USD} (yours ≈ $${usd.toFixed(2)})` }, { status: 400, headers });
    }
    requestedSats = sats;
    payCents = Math.round(usd * 100);
    planKey = 'custom';
  } else {
    const minUsd = minTopupUsd(rail);
    const amt = typeof amount_usd === 'number' ? amount_usd : Number(amount_usd);
    if (!Number.isFinite(amt) || amt < minUsd || amt > MAX_TOPUP_USD) {
      return Response.json({ error: `amount_usd must be a number between ${minUsd} and ${MAX_TOPUP_USD} for this method` }, { status: 400, headers });
    }
    payCents = Math.round(amt * 100);
    planKey = 'custom';
  }
  const amountUsd = payCents / 100;

  const db = env.DB;
  const agent = handle
    ? await db.prepare('SELECT agent_id, handle, display_name FROM agents WHERE LOWER(handle) = LOWER(?)').bind(handle).first() as any
    : await db.prepare('SELECT agent_id, handle, display_name FROM agents WHERE agent_id = ?').bind(agent_id).first() as any;

  if (!agent) {
    return Response.json({ error: 'Agent not found. Take the free test first.' }, { status: 404, headers });
  }

  // Resolve the owner now so the topup session carries owner_id (the pool that gets credited on
  // payment confirmation). One wallet funds all of this owner's agents.
  const ownerId = await ownerIdForAgent(db, agent.agent_id);

  if (payMethod === 'lightning') {
    if (!env.CLN_API_URL || !env.CLN_RUNE) {
      return Response.json({ error: 'Lightning payments temporarily unavailable', fallback: 'stripe' }, { status: 503, headers });
    }

    try {
      const btcUsdRate = await fetchBtcUsdRate();
      // sats-native request → the invoice is for EXACTLY what the payer typed; USD is derived.
      // amountless → CLN 'any': the payer's wallet sets the amount.
      const amountMsat: number | string = amountless ? 'any'
        : requestedSats != null ? requestedSats * 1000 : usdToMsat(amountUsd, btcUsdRate);
      const label = `verigent-topup-${agent.agent_id.slice(0, 12)}-${Date.now()}`;

      const clnConfig = { apiUrl: env.CLN_API_URL, rune: env.CLN_RUNE };
      const r = await fetch(`${clnConfig.apiUrl}/v1/invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${clnConfig.rune}` },
        body: JSON.stringify({
          amount_msat: amountMsat,
          label,
          // ASCII only — clnrest 400s on non-ASCII in the description ("should be a string (without
          // \u)"): the em dash here broke EVERY Lightning top-up (Ant hit it live, 2026-07-10).
          description: `Verigent wallet topup - ${agent.handle || agent.agent_id}`,
          expiry: 600,
        }),
      });

      if (!r.ok) throw new Error(`CLN returned ${r.status}`);
      const inv = await r.json() as any;

      await db.prepare(
        `INSERT INTO wallet_topup_sessions (id, agent_id, owner_id, amount_cents, plan, status)
         VALUES (?, ?, ?, ?, ?, 'pending')`
      ).bind(label, agent.agent_id, ownerId, payCents, planKey).run();

      await db.prepare(
        `INSERT INTO lightning_invoices (label, agent_id, bolt11, payment_hash, amount_msat, amount_usd, btc_usd_rate, product, status, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'wallet_topup', 'unpaid', datetime('now', '+10 minutes'), datetime('now'))`
      ).bind(label, agent.agent_id, inv.bolt11, inv.payment_hash, amountless ? 0 : amountMsat, amountUsd, btcUsdRate).run();

      return Response.json({
        ok: true,
        method: 'lightning',
        bolt11: inv.bolt11,
        payment_hash: inv.payment_hash,
        label,
        amount_sats: amountless ? null : msatToSats(amountMsat as number),
        amount_usd: amountless ? null : amountUsd,
        amountless,
        plan: planKey,
        btc_usd_rate: Math.round(btcUsdRate * 100) / 100,
        expires_in_seconds: 600,
        poll_url: `/api/wallet/check-payment?label=${encodeURIComponent(label)}`,
      }, { headers });
    } catch (err: any) {
      // Don't leak internal node/RPC detail to an unauthenticated caller (Codex LOW) — log it, return
      // a generic message. The fallback hint is safe and useful. URLs scrubbed from the log too:
      // a fetch failure embeds the keyed RPC endpoint in err.message (Codex LOW #2, 2026-07-10).
      console.error('lightning topup failed:', scrubUrls(err));
      return Response.json({ error: 'Lightning temporarily unavailable', fallback: 'stripe' }, { status: 503, headers });
    }
  }

  if (payMethod === 'sol') {
    try {
      const solUsdRate = await fetchSolUsdRate();
      const amountLamports = usdToLamports(amountUsd, solUsdRate);
      const label = `vgsol-${agent.agent_id.slice(0, 12)}-${Date.now()}`;
      // The memo BINDS this on-chain payment to this quote (reconciliation). It is handle + label ONLY —
      // NEVER the owner email: a Solana memo is permanently PUBLIC on-chain, so the email stays server-
      // side (sol_topups.owner_id → owners.email) for our reconciliation. The handle is already public.
      const memo = `vg:${agent.handle || agent.agent_id}:${label}`;
      const address = PAYMENT_CONFIG.sol.receivingAddress;
      const amountSol = amountLamports / 1e9;

      await db.prepare(
        `INSERT INTO sol_topups (label, agent_id, owner_id, amount_cents, amount_lamports, memo, sol_usd_rate, status, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'unpaid', datetime('now', '+30 minutes'), datetime('now'))`
      ).bind(label, agent.agent_id, ownerId, payCents, amountLamports, memo, solUsdRate).run();

      // Solana Pay URI — supporting wallets pre-fill the destination, amount and memo in one scan/click.
      const solanaPayUri = `solana:${address}?amount=${amountSol}&memo=${encodeURIComponent(memo)}&label=${encodeURIComponent('Verigent wallet top-up')}`;

      return Response.json({
        ok: true,
        method: 'sol',
        address,
        memo,
        amount_sol: amountSol,
        amount_lamports: amountLamports,
        amount_usd: amountUsd,
        plan: planKey,
        sol_usd_rate: Math.round(solUsdRate * 100) / 100,
        solana_pay_uri: solanaPayUri,
        expires_in_seconds: 1800,
        submit_url: '/api/wallet/check-sol-payment',
        label,
      }, { headers });
    } catch (err: any) {
      // Don't leak internal detail to an unauthenticated caller (Codex LOW, same scrub as Lightning).
      console.error('sol topup quote failed:', scrubUrls(err));
      return Response.json({ error: 'Solana pricing temporarily unavailable', fallback: 'stripe' }, { status: 503, headers });
    }
  }

  // Stripe checkout
  if (!env.STRIPE_SECRET_KEY) {
    return Response.json({ error: 'Stripe payments not configured' }, { status: 503, headers });
  }

  try {
    const sessionParams = new URLSearchParams();
    sessionParams.set('mode', 'payment');
    sessionParams.set('payment_method_types[0]', 'card');
    // MINIMAL card-only form (Ant 2026-07-04, "strip it back as far as possible"): NO card-save.
    // Dropping setup_future_usage + the customer/customer_creation plumbing removes BOTH the saved-card
    // capture AND the "…you allow VERIGENT to charge you for future payments…" mandate paragraph.
    // Auto-topup is DORMANT (no card saved to charge) until a proper opt-in UX is built. Credit is
    // unaffected: the webhook credits on checkout.session.completed via metadata, and saveCardForAutotopup
    // no-ops here (session.customer is null → early return, and it's try/catch best-effort anyway).
    // Owner email prefills the payer's email — but this endpoint is unauthenticated (any handle), so it
    // must NOT expose an owner's address to a stranger who opens the embedded checkout (Codex H3). Only
    // fetch/prefill when the caller is the AUTHENTICATED owner of this owner_id.
    const authedOwnerId = await verifyOwnerSession(getOwnerTokenFromCookie(request.headers.get('Cookie')), env.OWNER_AUTH_SECRET);
    const ownerRow = ownerId && authedOwnerId === ownerId
      ? await db.prepare('SELECT email FROM owners WHERE owner_id = ?').bind(ownerId).first() as any
      : null;
    // EMBEDDED Checkout (Ant 2026-07-04): render the card form INLINE on our page — no bounce to
    // checkout.stripe.com, email pre-filled. Reuses the SAME session + metadata + webhook credit path;
    // only the UI mode changes. redirect_on_completion=never keeps us on-page (client fires onComplete).
    // customer_email pre-fills. success_url/cancel_url are OMITTED (incompatible with embedded).
    // ui_mode=embedded_page — this account's Stripe API version renamed the old 'embedded' value to
    // 'embedded_page' (the full inline Checkout that pairs with client-side initEmbeddedCheckout). The
    // live e2e caught the 400 'ui_mode `embedded` is no longer supported. Use `embedded_page`'.
    sessionParams.set('ui_mode', 'embedded_page');
    sessionParams.set('redirect_on_completion', 'never');
    // Pre-fill the payer's email (no customer object now, so this always applies).
    if (ownerRow?.email) sessionParams.set('customer_email', ownerRow.email);
    sessionParams.set('line_items[0][price_data][currency]', 'usd');
    sessionParams.set('line_items[0][price_data][unit_amount]', payCents.toString());
    // SMALLER order-summary heading (Ant 2026-07-04): embedded_page gives no control over the summary's
    // font size or visibility, so we shrink its FOOTPRINT via the text — a short name and NO description
    // (was "Verigent wallet topup" + "Top up verification balance for <agent>", a dominant 3-line block).
    // "Wallet top-up · $X" is a subtle 2-line heading. Display-only: metadata still carries the agent.
    sessionParams.set('line_items[0][price_data][product_data][name]', `Wallet top-up`);
    sessionParams.set('line_items[0][quantity]', '1');
    sessionParams.set('metadata[agent_id]', agent.agent_id);
    if (ownerId) sessionParams.set('metadata[owner_id]', ownerId);
    sessionParams.set('metadata[type]', 'wallet_topup');
    sessionParams.set('metadata[amount_cents]', payCents.toString());
    sessionParams.set('metadata[plan]', planKey);
    // MATCH the embedded form to the WHITE billing mode (Ant 2026-07-04). Stripe forces its card fields
    // onto a white surface no matter what (dark is impossible — confirmed), so the drawer goes WHITE
    // around it; the form's own iframe background MUST also be white or you get an ugly dark box with a
    // white card floating in it. Session-level branding_settings override the Dashboard branding and reach
    // INSIDE the Checkout iframe where our CSS can't. background=#fff (matches the white surface),
    // button=#5a4db3 (mid-purple CTA, visible on white). font_family is a fixed Stripe enum (verified
    // against this account's API version) — 'inter' is the closest clean neo-grotesk to our Geist Sans.
    // Appearance only: no line item, price, metadata, or credit logic changes.
    sessionParams.set('branding_settings[background_color]', '#ffffff');
    sessionParams.set('branding_settings[button_color]', '#5a4db3');
    sessionParams.set('branding_settings[border_style]', 'rounded');
    sessionParams.set('branding_settings[font_family]', 'inter');
    // NO success_url/cancel_url — embedded mode is incompatible with them (redirect_on_completion=never
    // handles staying on-page; the client's onComplete fires when payment finishes).

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: sessionParams.toString(),
    });

    if (!stripeRes.ok) {
      const errBody = await stripeRes.text();
      throw new Error(`Stripe returned ${stripeRes.status}: ${errBody}`);
    }

    const session = await stripeRes.json() as any;

    await db.prepare(
      `INSERT INTO wallet_topup_sessions (id, agent_id, owner_id, amount_cents, plan, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`
    ).bind(session.id, agent.agent_id, ownerId, payCents, planKey).run();

    return Response.json({
      ok: true,
      method: 'stripe',
      client_secret: session.client_secret, // embedded Checkout mounts on this (was checkout_url)
      session_id: session.id,
      amount_usd: amountUsd,
      plan: planKey,
    }, { headers });
  } catch (err: any) {
    // Don't leak internal/Stripe error detail to an unauthenticated caller (Codex LOW, same scrub
    // as Lightning) — the Stripe error body can echo request internals.
    console.error('stripe topup setup failed:', scrubUrls(err));
    return Response.json({ error: 'Payment setup failed' }, { status: 500, headers });
  }
};
