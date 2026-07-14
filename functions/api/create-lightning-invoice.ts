// RETIRED 2026-07-10 (Codex launch-eve review) — POST /api/create-lightning-invoice.
//
// This was the one-shot "benchmark purchase" Lightning endpoint from the retired $199 single-cert
// model. It minted a CLN invoice DIRECTLY, bypassing the global payments master switch
// (PAYMENTS_ENABLED / settings.payments_enabled) and the shared min/max top-up bounds — so it broke
// the "all rails dark until launch" guarantee even though it had no wallet-credit path. All live
// Lightning now goes through /api/wallet/topup (switch-gated, bounded, ledger-credited via
// /api/wallet/check-payment). Retired to 410 like the other legacy payment endpoints.

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const GONE = {
  error: 'This endpoint has been retired. Use POST /api/wallet/topup with method:"lightning".',
  code: 'endpoint_retired',
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { status: 204, headers: CORS });

export const onRequest: PagesFunction = async () =>
  new Response(JSON.stringify(GONE), { status: 410, headers: { 'Content-Type': 'application/json', ...CORS } });
