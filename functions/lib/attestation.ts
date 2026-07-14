// On-chain score attestation — moved to fire at run COMPLETION, after multi-turn eval folds into
// the composite (5d, Ant-ruled Option A 2026-07-02). Previously the VG-key attestation broadcast
// at eval_pending, so the on-chain cert carried the PRE-eval composite (dry run anchored V2/60.51
// while the completed row was V3/67.49). This helper is the single place the score cert is
// broadcast, called from:
//   • recalculateComposite (eval-turn) — the normal completed path (final post-eval composite)
//   • sweep-expired — abandoned runs (eval never finished): anchor the FINAL GRADED state at expiry
// The kickoff COMMITMENT anchor (task-battery seal) is untouched — that stays at run start.
//
// Idempotency (never zero, never two): an atomic claim flips attested 0→1 for exactly one caller
// before broadcasting; a broadcast failure rolls attested back to 0 (attestation_txid stays NULL)
// so retry-anchors — which gates on attested = 0 — can re-attempt. attestation_txid is the sole
// source of truth for "really anchored".

import { attestVGKey } from './anchor';
import { generateVGCode } from './vgcode';

export interface FinalizeAttestationResult {
  attested: boolean;
  txid?: string;
  reason: string;
}

interface AttestEnv {
  CLN_API_URL?: string;
  CLN_ANCHOR_RUNE?: string;
  [k: string]: any;
}

// Uses the FINAL scores already written to the runs row (post-eval at completion, or the graded
// state at expiry) — this helper never (re)computes a score, so it is freeze-safe.
export async function finalizeAttestation(
  db: D1Database, env: AttestEnv, runToken: string
): Promise<FinalizeAttestationResult> {
  const run = await db.prepare('SELECT * FROM runs WHERE run_token = ?').bind(runToken).first() as any;
  if (!run) return { attested: false, reason: 'run not found' };
  if (!run.includes_attestation) return { attested: false, reason: 'unpaid run — no attestation' };
  if (run.attested && run.attestation_txid) {
    return { attested: true, txid: run.attestation_txid, reason: 'already attested' };
  }
  if (!env.CLN_API_URL || !env.CLN_ANCHOR_RUNE) {
    return { attested: false, reason: 'anchor node not configured' };
  }

  // Atomic single-broadcast claim — only the first caller flips 0→1 and proceeds to broadcast.
  const claim = await db.prepare(
    "UPDATE runs SET attested = 1 WHERE run_token = ? AND includes_attestation = 1 AND attested = 0 AND attestation_txid IS NULL"
  ).bind(runToken).run();
  if (!claim.meta.changes) {
    const now = await db.prepare('SELECT attested, attestation_txid FROM runs WHERE run_token = ?').bind(runToken).first() as any;
    return { attested: !!(now?.attested && now?.attestation_txid), txid: now?.attestation_txid || undefined, reason: 'claimed by a concurrent finalize' };
  }

  // Everything from here to a CONFIRMED broadcast is wrapped (5f fix 5): any throw — DB error,
  // vgcode/handle failure, a narrative hang — must roll the claim back, or the run strands
  // attested=1 / attestation_txid NULL and neither the sweep nor retry-anchors would re-attempt.
  const rollback = async (note: string) => {
    await db.prepare(
      "UPDATE runs SET attested = 0, attestation_vg_code = ? WHERE run_token = ? AND attestation_txid IS NULL"
    ).bind(note.slice(0, 255), runToken).run();
  };

  try {
    const agent = await db.prepare('SELECT * FROM agents WHERE agent_id = ?').bind(run.agent_id).first() as any;

    // Ensure a handle exists (normally assigned by recalc before this runs; assign if missing).
    // mintHandleForAgent gives a NAMELESS agent a readable call-sign (UNIT-XXXX → unit-xxxx-0A)
    // instead of a machine-id-derived handle (Ant 2026-07-08).
    let handle: string = agent?.handle;
    if (!handle) {
      const { mintHandleForAgent } = await import('./suffix');
      ({ handle } = await mintHandleForAgent(db, run.agent_id, agent?.display_name));
    }

    let classScores: Record<string, number> = {};
    let dimensionScores: Record<string, number> = {};
    try { classScores = JSON.parse(run.class_scores || '{}'); } catch { /* empty */ }
    try { dimensionScores = JSON.parse(run.dimension_scores || '{}'); } catch { /* empty */ }

    // VG code built from the FINAL tier/class already on the run row. MODEL segment from the run's
    // declared model, falling back to the agent's certified model when the run carried none.
    let runModel = '';
    try { runModel = JSON.parse(run.run_conditions || '{}')?.model || ''; } catch {}
    const vgCode = generateVGCode(handle, run.tier, run.primary_class, classScores, runModel || agent?.certified_model || '');

    // Best-effort narrative for the listing (never blocks attestation; has its own 10s timeout).
    let narrative = '';
    try {
      const { generateNarrative } = await import('./narrative');
      narrative = await generateNarrative(
        agent?.display_name, run.tier, run.primary_class,
        classScores, dimensionScores, run.composite_score, env as any,
      );
    } catch { /* narrative optional */ }

    const attestResult = await attestVGKey(
      { apiUrl: env.CLN_API_URL, rune: env.CLN_ANCHOR_RUNE, mode: env.ANCHOR_MODE },
      vgCode,
      run.identity_pubkey || null,
    );

    if (!(attestResult.anchored && attestResult.txid)) {
      await rollback(`ERROR: ${attestResult.error || 'unknown'}`);
      return { attested: false, reason: attestResult.error || 'attestation broadcast failed' };
    }

    // Confirmed broadcast — record runs + stamp agent + list registry via the shared success block.
    await applyAttestationSuccess(db, runToken, { vgCode, txid: attestResult.txid, feeSat: attestResult.feeSat ?? null, narrative });
    return { attested: true, txid: attestResult.txid, reason: 'attested on-chain at completion' };
  } catch (err: any) {
    await rollback(`ERROR: ${err?.message || 'exception during attestation'}`);
    return { attested: false, reason: `attestation failed: ${err?.message || err}` };
  }
}

// Shared post-broadcast success block (5f fix 8) — records the anchored attestation on the run,
// stamps the cert on the agent (5f fix 9: only AFTER a confirmed broadcast, never speculatively),
// and lists the agent in the registry with the FINAL scores. Called by BOTH finalizeAttestation
// and retry-anchors so a successful broadcast is always fully applied. Idempotent.
export async function applyAttestationSuccess(
  db: D1Database,
  runToken: string,
  opts: { vgCode: string; txid: string; feeSat?: number | null; narrative?: string | null },
): Promise<void> {
  const run = await db.prepare('SELECT * FROM runs WHERE run_token = ?').bind(runToken).first() as any;
  if (!run) return;
  const agent = await db.prepare('SELECT * FROM agents WHERE agent_id = ?').bind(run.agent_id).first() as any;

  let classScores: Record<string, number> = {};
  let dimensionScores: Record<string, number> = {};
  try { classScores = JSON.parse(run.class_scores || '{}'); } catch { /* empty */ }
  try { dimensionScores = JSON.parse(run.dimension_scores || '{}'); } catch { /* empty */ }

  await db.prepare(
    "UPDATE runs SET attested = 1, attestation_txid = ?, attestation_vg_code = ?, attested_at = datetime('now'), attestation_fee_sat = ? WHERE run_token = ?"
  ).bind(opts.txid, opts.vgCode, opts.feeSat ?? null, runToken).run();

  await db.prepare(
    "UPDATE agents SET vg_code = ?, last_certified_at = datetime('now') WHERE agent_id = ?"
  ).bind(opts.vgCode, run.agent_id).run();

  // Registry upsert. COALESCE narrative so a retry (no narrative supplied) never wipes an existing one.
  const existing = await db.prepare('SELECT agent_id FROM registry WHERE agent_id = ?').bind(run.agent_id).first();
  if (existing) {
    await db.prepare(`
      UPDATE registry SET composite_score = ?, tier = ?, primary_class = ?, class_scores = ?,
        dimension_scores = ?, last_tested_at = datetime('now'), narrative = COALESCE(?, narrative), vg_code = ?, attestation_txid = ?
      WHERE agent_id = ?
    `).bind(
      run.composite_score, run.tier, run.primary_class, JSON.stringify(classScores),
      JSON.stringify(dimensionScores), opts.narrative || null, opts.vgCode, opts.txid, run.agent_id
    ).run();
  } else {
    await db.prepare(`
      INSERT INTO registry (agent_id, handle, display_name, composite_score, tier, primary_class, class_scores, dimension_scores, tests_completed, last_tested_at, listed, narrative, vg_code, attestation_txid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 1, ?, ?, ?)
    `).bind(
      run.agent_id, agent?.handle, agent?.display_name,
      run.composite_score, run.tier, run.primary_class, JSON.stringify(classScores),
      JSON.stringify(dimensionScores), agent?.total_tests ?? 1, opts.narrative || null, opts.vgCode, opts.txid
    ).run();
  }
}
