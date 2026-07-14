// GET /api/check-lightning-payment?label=verigent-xxx
// Polls CLN for invoice payment status. Frontend calls this on an interval.

import { checkInvoiceStatus } from '../lib/lightning';
import { scrubUrls } from '../lib/log-scrub';

interface Env {
  DB: D1Database;
  CLN_API_URL: string;
  CLN_RUNE: string;
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, { status: 204, headers: CORS });
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const headers = { 'Content-Type': 'application/json', ...CORS };
  const url = new URL(request.url);
  const label = url.searchParams.get('label');

  if (!label || !label.startsWith('verigent-')) {
    return new Response(JSON.stringify({ error: 'Valid label required' }), { status: 400, headers });
  }

  if (!env.CLN_API_URL || !env.CLN_RUNE) {
    return new Response(JSON.stringify({ error: 'Lightning unavailable' }), { status: 503, headers });
  }

  const config = { apiUrl: env.CLN_API_URL, rune: env.CLN_RUNE };

  try {
    const status = await checkInvoiceStatus(config, label);

    if (status.status === 'paid') {
      // Update local record
      try {
        await env.DB.prepare(
          "UPDATE lightning_invoices SET status = 'paid', paid_at = datetime('now') WHERE label = ?"
        ).bind(label).run();
      } catch {}
    } else if (status.status === 'expired') {
      try {
        await env.DB.prepare(
          "UPDATE lightning_invoices SET status = 'expired' WHERE label = ?"
        ).bind(label).run();
      } catch {}
    }

    return new Response(JSON.stringify({
      ok: true,
      label: status.label,
      status: status.status,
      payment_hash: status.payment_hash,
      paid_at: status.paid_at,
    }), { status: 200, headers });
  } catch (err: any) {
    // Don't leak internal node detail to an unauthenticated caller (Codex LOW, same scrub as the
    // wallet rails).
    console.error('check-lightning-payment failed:', scrubUrls(err));
    return new Response(JSON.stringify({
      error: 'Could not check payment status',
    }), { status: 500, headers });
  }
};
