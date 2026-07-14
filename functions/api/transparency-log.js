// GET /api/transparency-log — returns the append-only transparency log.
// Each entry records a window commitment, grader version, data covenant,
// and a link to the Sigstore/Rekor entry for independent verification.
// The log is also served statically at /transparency-log.json.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
function json(b, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...CORS } });
}
export function onRequestOptions() { return new Response(null, { status: 204, headers: CORS }); }

export async function onRequestGet(context) {
  const { env } = context;

  // Fetch all windows (open and closed) as log entries
  const { results: windows } = await env.DB.prepare(
    "SELECT id, content_commitment, task_merkle_root, server_seed_commitment, grader_measurement, source_commit, taskpool_hash, grader_hash, status, created_at, closes_at, revealed_at FROM windows ORDER BY created_at ASC"
  ).all();

  const entries = windows.map((w, i) => ({
    index: i,
    window_id: w.id,
    content_commitment: w.content_commitment,
    task_merkle_root: w.task_merkle_root,
    source_commit: w.source_commit,
    grader_hash: w.grader_hash,
    status: w.status,
    created_at: w.created_at,
    closes_at: w.closes_at,
    revealed_at: w.revealed_at,
    data_covenant: {
      submissions_used_for: ["scoring", "registry"],
      resold: false,
      used_for_training: false,
      pseudonymous: true,
      deletable_on_request: true,
    },
  }));

  // Battery-version commitments (Deserving Doctrine Stage 1): each deployed battery version's canonical
  // hash + the count of per-probe commitments published for it. Public-safe (hashes only; probe content
  // + salts are revealed later, on retirement, via /api/battery-reveal). Additive — the `entries` shape
  // above is unchanged. Table may be empty until the Professor's commitment emitter lands.
  let batteryVersions = [];
  try {
    const { results } = await env.DB.prepare(
      "SELECT version_id, battery_hash, commitments_root, probe_count, ots_status, active, created_at FROM battery_versions ORDER BY created_at ASC"
    ).all();
    batteryVersions = (results || []).map((v) => ({
      version_id: v.version_id,
      battery_hash: v.battery_hash,
      commitments_root: v.commitments_root,
      probe_count: v.probe_count,
      ots_status: v.ots_status,           // 'none' until the OTS anchor fast-follow lands
      active: !!v.active,
      created_at: v.created_at,
    }));
  } catch { /* table not migrated yet — omit the section rather than 500 */ }

  return json({
    ok: true,
    service: "ratemyagent.app",
    description: "Append-only transparency log. Each entry is also published to Sigstore/Rekor.",
    rekor_server: "https://rekor.sigstore.dev",
    entry_count: entries.length,
    entries,
    // commit-then-reveal battery transparency: verify test integrity without trusting us.
    battery_versions: batteryVersions,
  });
}
