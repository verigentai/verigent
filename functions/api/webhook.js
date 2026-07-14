// RETIRED (5k, 2026-07-02). Legacy Stripe webhook for the one-off SKU model: it minted a paid
// coupon on checkout.session.completed. It verified the Stripe signature only when the secret was
// set (forgeable if unset), used a non-constant-time compare, and had no event.id replay dedup —
// a forged event could mint a real paid coupon. Verigent is on the prepaid-wallet model now
// (stripe-webhook.ts handles wallet top-ups); nothing live references this route. Returns 410 Gone.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, stripe-signature',
};

const gone = () =>
  new Response(
    JSON.stringify({ error: 'gone', message: 'This endpoint is retired. Verigent bills via a prepaid wallet — see /agents.txt.' }),
    { status: 410, headers: { 'Content-Type': 'application/json', ...CORS } }
  );

export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS });
export const onRequestGet = gone;
export const onRequestPost = gone;
