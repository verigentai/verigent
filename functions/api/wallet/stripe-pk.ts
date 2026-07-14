// GET /api/wallet/stripe-pk — the Stripe PUBLISHABLE key for the embedded Checkout on our page.
// Served from an endpoint (not a build-baked NEXT_PUBLIC_) so a go-live test→live key swap needs no
// rebuild — just an env change on the Pages project. Publishable keys are safe to expose client-side.

interface Env { STRIPE_PUBLISHABLE_KEY?: string }

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function onRequestOptions() { return new Response(null, { status: 204, headers: CORS }); }

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const pk = env.STRIPE_PUBLISHABLE_KEY || '';
  return new Response(JSON.stringify({ ok: !!pk, publishable_key: pk }), {
    status: pk ? 200 : 503,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
};
