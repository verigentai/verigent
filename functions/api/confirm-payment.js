// RETIRED (5k, 2026-07-02). Legacy one-off SKU endpoint: verified a Stripe PaymentIntent and
// minted verification keys. Idempotency was a LIKE-scan on prior coupons, racing to double-mint on
// concurrent calls. Verigent is on the prepaid-wallet model now; nothing live references this
// route. Returns 410 Gone.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const gone = () =>
  new Response(
    JSON.stringify({ error: 'gone', message: 'This endpoint is retired. Verigent bills via a prepaid wallet — see /agents.txt.' }),
    { status: 410, headers: { 'Content-Type': 'application/json', ...CORS } }
  );

export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS });
export const onRequestGet = gone;
export const onRequestPost = gone;
