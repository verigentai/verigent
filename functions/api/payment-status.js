// RETIRED (5k, 2026-07-02). Legacy one-off SKU endpoint: polled coupon status by agent for the
// old /start redirect. Unauthenticated coupon disclosure (and queried by `id`, not `agent_id`).
// Verigent is on the prepaid-wallet model now; nothing live references this route. Returns 410 Gone.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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
