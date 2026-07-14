// GET /api/wallet/rates — live BTC/SOL USD rates for the top-up pickers.
//
// Unit-of-account display (Ant 2026-07-10): the crypto pickers show amounts in the payer's OWN unit
// (sats / SOL), not USD — this feeds them the live rate before any invoice/quote exists. Rates are
// the same 30s-cached lib fetchers the billing paths use, so the picker's numbers agree with what a
// generated invoice will actually charge. Read-only, no auth, no DB.

import { fetchBtcUsdRate, fetchSolUsdRate } from '../../lib/lightning';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export const onRequestGet: PagesFunction = async () => {
  const headers = { 'Content-Type': 'application/json', ...CORS };
  const [btc, sol] = await Promise.all([
    fetchBtcUsdRate().catch(() => null),
    fetchSolUsdRate().catch(() => null),
  ]);
  return Response.json({
    btc_usd: btc ? Math.round(btc * 100) / 100 : null,
    sol_usd: sol ? Math.round(sol * 100) / 100 : null,
  }, { headers });
};
