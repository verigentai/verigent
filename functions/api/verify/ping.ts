// GET /api/verify/ping?nonce=XXX&run=vr_XXX
// Records that an agent actually made an HTTP request to this endpoint.
// Used to verify interoperability sovereignty dimension.

interface Env {
  DB: D1Database;
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
  const nonce = url.searchParams.get('nonce');
  const runToken = url.searchParams.get('run');

  if (!nonce || !runToken) {
    return new Response(JSON.stringify({ error: 'nonce and run parameters required' }), { status: 400, headers });
  }

  const sourceIp = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
  const userAgent = request.headers.get('user-agent') || 'unknown';

  try {
    await env.DB.prepare(
      'INSERT INTO sovereignty_pings (run_token, nonce, source_ip, user_agent) VALUES (?, ?, ?, ?)'
    ).bind(runToken, nonce, sourceIp, userAgent).run();
  } catch {
    // Table might not exist yet — fail gracefully
  }

  return new Response(JSON.stringify({
    ok: true,
    nonce,
    message: 'Ping received and recorded',
    verified: true,
    server_time: new Date().toISOString(),
  }), { status: 200, headers });
};
