// GET /api/updates — the public test-updates ledger (POST-LAUNCH #12). Dated, boundary-safe
// one-liners confirming what changed in the test and when — the human-readable companion to the
// commit-reveal / rubric-history records. Read-only and public by design; writes happen only
// through the Professor pipeline's outbox push (local, wrangler-authed) — there is no write
// endpoint to attack.

interface Env {
  DB: D1Database;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204, headers: CORS });

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const rows = await env.DB.prepare(
      'SELECT entry_date, title, detail FROM test_updates ORDER BY entry_date DESC, id DESC LIMIT 200'
    ).all();
    return Response.json({ ok: true, updates: rows.results || [] }, {
      headers: { ...CORS, 'Cache-Control': 'public, max-age=300' },
    });
  } catch {
    // Table not migrated yet — an empty ledger, not an error page.
    return Response.json({ ok: true, updates: [] }, { headers: { ...CORS, 'Cache-Control': 'public, max-age=60' } });
  }
};
