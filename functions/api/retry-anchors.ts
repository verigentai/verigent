// GET /api/retry-anchors?secret=SWEEP_SECRET — re-attempt failed on-chain anchors.
//
// Why: each completed run writes two OP_RETURNs (commitment + VG-key attestation).
// A transient node-side failure (e.g. UTXO starvation while change confirms) leaves
// anchor_txid / attestation_txid NULL even though the run is graded. This endpoint
// finds those runs and retries the broadcast out-of-band, so the chain catches up
// without re-running the test. Idempotent and bounded; safe to call on a cron.
//
// Hit by scripts/verigent-anchor-retry.sh on a schedule (Pages Functions can't self-schedule).

import { anchorCommitment, attestVGKey } from '../lib/anchor';
import { applyAttestationSuccess } from '../lib/attestation';

interface Env {
  DB: D1Database;
  CLN_API_URL?: string;
  CLN_ANCHOR_RUNE?: string;
  ANCHOR_MODE?: string;
  SWEEP_SECRET?: string;
}

const HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

// Don't drain the anchor wallet in one pass — each anchor is one OP_RETURN (one UTXO + ~1k sat fee).
const MAX_BROADCASTS_PER_CALL = 6;
// Only chase recent runs; older unbroadcast ones are left alone (avoid churning permanent failures).
const LOOKBACK = "-7 days";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  // FAIL CLOSED (Codex 2026-07-09 HIGH): this broadcasts up to 6 OP_RETURNs (real sats), so an unset
  // SWEEP_SECRET must DENY — the old `env.SWEEP_SECRET && …` ran wide-open when the binding was missing.
  // Secret via HEADER (not a URL query param that leaks into logs), matching the sweep endpoints.
  if (!env.SWEEP_SECRET || request.headers.get('X-Sweep-Secret') !== env.SWEEP_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: HEADERS });
  }
  if (!env.CLN_API_URL || !env.CLN_ANCHOR_RUNE) {
    return new Response(JSON.stringify({ error: 'Anchor service not configured (CLN_API_URL / CLN_ANCHOR_RUNE)' }), { status: 503, headers: HEADERS });
  }

  const db = env.DB;
  await (await import('../lib/cron-heartbeat')).stampCronHeartbeat(db, 'retry-anchors'); // 5v-a heartbeat
  const config = { apiUrl: env.CLN_API_URL, rune: env.CLN_ANCHOR_RUNE, mode: env.ANCHOR_MODE };

  // Completed runs still missing their commitment anchor and/or their attestation.
  const pending = await db.prepare(`
    SELECT r.run_token, r.commitment, r.anchor_txid, r.includes_attestation,
           r.attested, r.attestation_txid, r.identity_pubkey, a.vg_code
    FROM runs r
    JOIN agents a ON r.agent_id = a.agent_id
    WHERE r.status = 'completed'
      AND r.completed_at > datetime('now', ?)
      AND (
        (r.commitment IS NOT NULL AND r.anchor_txid IS NULL)
        OR (r.includes_attestation = 1 AND r.attestation_txid IS NULL)
      )
    ORDER BY r.completed_at DESC
    LIMIT 25
  `).bind(LOOKBACK).all();

  const runs = (pending.results || []) as any[];
  let broadcasts = 0;
  const anchored: string[] = [];
  const attested: string[] = [];
  const failed: { run: string; what: string; error: string }[] = [];

  for (const run of runs) {
    if (broadcasts >= MAX_BROADCASTS_PER_CALL) break;

    // Retry commitment anchor.
    if (run.commitment && !run.anchor_txid && broadcasts < MAX_BROADCASTS_PER_CALL) {
      broadcasts++;
      const res = await anchorCommitment(config, run.commitment);
      if (res.anchored && res.txid) {
        await db.prepare(
          "UPDATE runs SET anchor_txid = ?, anchor_status = 'broadcast', anchored_at = datetime('now'), anchor_fee_sat = ? WHERE run_token = ?"
        ).bind(res.txid, res.feeSat ?? null, run.run_token).run();
        anchored.push(run.run_token);
      } else {
        await db.prepare("UPDATE runs SET anchor_status = ? WHERE run_token = ?")
          .bind(`retry-error: ${res.error || 'unknown'}`.slice(0, 255), run.run_token).run();
        failed.push({ run: run.run_token, what: 'anchor', error: res.error || 'unknown' });
      }
    }

    // Retry VG-key attestation. Gate on attestation_txid IS NULL (not attested=0) so this ALSO
    // recovers a run where finalizeAttestation claimed (attested=1) but stranded before writing a
    // txid (5f fix 5 backstop). On success, the shared block records runs + stamps the agent +
    // lists the registry — the success path used to skip listing/stamping entirely (5f fix 8).
    if (run.includes_attestation && !run.attestation_txid && run.vg_code && broadcasts < MAX_BROADCASTS_PER_CALL) {
      broadcasts++;
      const res = await attestVGKey(config, run.vg_code, run.identity_pubkey || null);
      if (res.anchored && res.txid) {
        await applyAttestationSuccess(db, run.run_token, { vgCode: run.vg_code, txid: res.txid, feeSat: res.feeSat ?? null });
        attested.push(run.run_token);
      } else {
        await db.prepare("UPDATE runs SET attestation_vg_code = ? WHERE run_token = ?")
          .bind(`RETRY-ERROR: ${res.error || 'unknown'}`.slice(0, 255), run.run_token).run();
        failed.push({ run: run.run_token, what: 'attestation', error: res.error || 'unknown' });
      }
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    candidates: runs.length,
    broadcasts,
    anchored,
    attested,
    failed,
    note: broadcasts >= MAX_BROADCASTS_PER_CALL ? 'Hit per-call broadcast cap; remaining will retry next pass.' : undefined,
  }), { status: 200, headers: HEADERS });
};
