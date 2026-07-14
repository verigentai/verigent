// GET /api/battery-reveal — public reveal of RETIRED challenges (Deserving Doctrine Stage 1). Once a challenge
// is fully rotated out + past the reveal lag, the Professor publishes its (content, salt); this serves
// those so anyone can recompute SHA-256(salt||probe_content) and match it to the pre-committed hash on
// /api/battery-versions. Read-only, no auth. LIVE challenges are NEVER here — only revealed retired ones.
//
// Neutrality (hard rule): this shows WHAT was tested, never how to score higher. Content only.
// ?version=<id> narrows to one battery version.

interface Env { DB: D1Database }

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });
}
export function onRequestOptions() { return new Response(null, { status: 204, headers: CORS }); }

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const version = url.searchParams.get('version');

  const res = await env.DB.prepare(
    version
      ? 'SELECT version_id, commitment_hash, probe_content, salt, revealed_at FROM probe_reveals WHERE version_id = ? ORDER BY revealed_at ASC'
      : 'SELECT version_id, commitment_hash, probe_content, salt, revealed_at FROM probe_reveals ORDER BY revealed_at ASC'
  ).bind(...(version ? [version] : [])).all().catch(() => ({ results: [] }));

  const reveals = ((res.results || []) as any[]).map((r) => ({
    version_id: r.version_id,
    commitment_hash: r.commitment_hash,   // matches a hash in /api/battery-versions
    probe_content: r.probe_content,
    salt: r.salt,
    revealed_at: r.revealed_at,
  }));

  return json({
    ok: true,
    description: 'Revealed retired challenges. Recompute SHA-256(salt || probe_content) and match commitment_hash against the pre-committed list on /api/battery-versions. Script: scripts/verify-commitment.mjs.',
    count: reveals.length,
    reveals,
  });
};
