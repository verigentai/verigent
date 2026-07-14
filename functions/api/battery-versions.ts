// GET /api/battery-versions — public commit-then-reveal battery transparency (Deserving Doctrine
// Stage 1). Lists every deployed battery version with its canonical hash and the full list of per-challenge
// commitment hashes (SHA-256(salt||probe_content)). Public-safe: hashes only — challenge content + salts are
// revealed later, on retirement, via /api/battery-reveal. Read-only; no auth (this is the whole point —
// anyone can audit test integrity without trusting us).
//
// ?version=<id> narrows to one version (with its commitment list). No param → all versions + counts.

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

  const vres = await env.DB.prepare(
    version
      ? 'SELECT version_id, battery_hash, commitments_root, probe_count, ots_status, active, created_at FROM battery_versions WHERE version_id = ?'
      : 'SELECT version_id, battery_hash, commitments_root, probe_count, ots_status, active, created_at FROM battery_versions ORDER BY created_at ASC'
  ).bind(...(version ? [version] : [])).all().catch(() => ({ results: [] }));

  const versions = (vres.results || []) as any[];
  if (version && versions.length === 0) return json({ ok: false, error: 'UNKNOWN_VERSION' }, 404);

  // For a single version (or all, bounded), attach the published per-challenge commitment hashes.
  const withCommitments = await Promise.all(versions.map(async (v) => {
    const cres = await env.DB.prepare(
      'SELECT commitment_hash FROM probe_commitments WHERE version_id = ? ORDER BY commitment_hash ASC'
    ).bind(v.version_id).all().catch(() => ({ results: [] }));
    const commitments = (cres.results || []).map((r: any) => r.commitment_hash);
    const revealed = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM probe_reveals WHERE version_id = ?'
    ).bind(v.version_id).first().catch(() => ({ n: 0 })) as any;
    return {
      version_id: v.version_id,
      battery_hash: v.battery_hash,
      commitments_root: v.commitments_root,
      probe_count: v.probe_count,
      ots_status: v.ots_status,
      active: !!v.active,
      created_at: v.created_at,
      probe_commitments: commitments,
      revealed_count: revealed?.n ?? 0,
    };
  }));

  return json({
    ok: true,
    description: 'Commit-then-reveal battery transparency. Each version pre-commits a salted hash of every challenge; retired challenges are later revealed (content + salt) so anyone can recompute and match the commitment. Verify with scripts/verify-commitment.mjs.',
    reveal_endpoint: '/api/battery-reveal',
    versions: withCommitments,
  });
};
