// GET /api/verify/:handle — Verify an agent's VG code
// Returns the canonical VG code + full profile for verification
// Other agents and humans use this to check a VG code is legit

import { parseVGCode } from '../../lib/vgcode';
import { computeFreshness } from '../../lib/freshness';
import { credentialSemantics } from '../../lib/credential-semantics';

interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const handle = context.params.handle as string;
  if (!handle) {
    return Response.json({ error: 'handle is required' }, { status: 400 });
  }

  const db = context.env.DB;

  const agent = await db.prepare(
    'SELECT agent_id, handle, display_name, current_tier, primary_class, composite_score, vg_code, total_tests, updated_at, last_certified_at, identity_pubkey, identity_algorithm, verification_status, dispute_count, revoked_at, revoked_reason, public_read_count, is_public_baseline, reverifying_until FROM agents WHERE handle = ?'
  ).bind(handle).first() as any;

  if (!agent) {
    return Response.json({ verified: false, error: 'AGENT_NOT_FOUND' }, { status: 404 });
  }

  if (!agent.vg_code) {
    return Response.json({
      verified: false,
      handle: agent.handle,
      reason: 'NO_VERIFICATION',
      hint: 'This agent has not completed a Verigent verification test.',
    });
  }

  // Get tested model from most recent completed run
  let testedModel: string | null = null;
  const latestRun = await db.prepare(
    "SELECT run_conditions FROM runs WHERE agent_id = ? AND status = 'completed' ORDER BY completed_at DESC LIMIT 1"
  ).bind(agent.agent_id).first() as any;
  if (latestRun?.run_conditions) {
    try {
      const rc = JSON.parse(latestRun.run_conditions);
      testedModel = rc.model || rc.model_version || null;
    } catch {}
  }

  // Latest on-chain attestation (Bitcoin OP_RETURN) for this agent — the anchor a BASIC provenance
  // check surfaces ("is this a real, on-chain-anchored tested agent?"). Per-run: the most recent
  // completed run that actually attested. Null if nothing is anchored yet.
  let anchor: { txid: string; chain: 'bitcoin' } | null = null;
  const attestedRun = await db.prepare(
    "SELECT attestation_txid FROM runs WHERE agent_id = ? AND status = 'completed' AND attested = 1 AND attestation_txid IS NOT NULL ORDER BY completed_at DESC LIMIT 1"
  ).bind(agent.agent_id).first() as any;
  if (attestedRun?.attestation_txid) anchor = { txid: attestedRun.attestation_txid, chain: 'bitcoin' };

  const url = new URL(context.request.url);
  const claimedCode = url.searchParams.get('code');

  // Quarter staleness: derive benchmark quarter from test date
  function getBenchmarkQuarter(dateStr: string): string {
    const d = new Date(dateStr);
    const q = Math.ceil((d.getUTCMonth() + 1) / 3);
    const y = d.getUTCFullYear().toString().slice(-2);
    return `Q${q}-${y}`;
  }

  function getCurrentQuarter(): string {
    const now = new Date();
    const q = Math.ceil((now.getUTCMonth() + 1) / 3);
    const y = now.getUTCFullYear().toString().slice(-2);
    return `Q${q}-${y}`;
  }

  const testedQuarter = agent.updated_at ? getBenchmarkQuarter(agent.updated_at) : null;
  const currentQuarter = getCurrentQuarter();

  // Soft-expiry freshness — age-based decay, never a hard void. Counterparties always see
  // the cert plus how fresh it is. Dedicated last_certified_at, falling back to updated_at
  // for certs issued before that column existed.
  const certifiedAt = agent.last_certified_at || agent.updated_at || null;
  const freshness = computeFreshness(certifiedAt, { certifiedModel: testedModel, reverifyingUntil: agent.reverifying_until });
  const isStale = freshness.state === 'stale';

  const response: any = {
    verified: true,
    handle: agent.handle,
    display_name: agent.display_name,
    vg_code: agent.vg_code,
    // Non-bearer semantics (agents.txt §10k): the key asserts a measurement, confers no trust.
    credential_semantics: credentialSemantics(agent.handle),
    tier: agent.current_tier,
    primary_class: agent.primary_class,
    composite: agent.composite_score,
    tested_model: testedModel,
    benchmark_quarter: testedQuarter,
    current_quarter: currentQuarter,
    // Freshness state: current | ageing | stale (+ age in days, detail, model-change flag).
    freshness,
    // Back-compat: keep `stale` (now driven by freshness) for existing consumers.
    stale: isStale,
    ...(isStale && {
      staleness_warning: freshness.detail + ' Re-verification recommended.',
    }),
    total_tests: agent.total_tests,
    // Public-read count (this read included) — compounding, unfakeable social-proof stat.
    public_read_count: (agent.public_read_count || 0) + 1,
    last_updated: agent.updated_at,
    certified_at: certifiedAt,
    // Voluntary exit — credential retired by its holder. On-chain attestation remains, but
    // the agent has stood the public credential down.
    revoked: !!agent.revoked_at,
    ...(agent.revoked_at && { revoked_at: agent.revoked_at, revoked_reason: agent.revoked_reason || null }),
    profile: `https://verigent.ai/agent/${agent.handle}`,
    // On-chain anchor (Bitcoin) of this agent's certified result — the basic provenance proof.
    anchor,
    // Identity binding — a counterparty challenges this key (sign a fresh nonce) to prove
    // the agent is the same entity that was tested. See /api/verify/identity-challenge.
    identity: agent.identity_pubkey ? {
      public_key: agent.identity_pubkey,
      algorithm: agent.identity_algorithm || 'ed25519',
      challenge_endpoint: '/api/verify/identity-challenge',
    } : null,
    // Community trust signal — counterparties report suspected model swaps; the public
    // record reflects open disputes. 'verified' = clean, 'disputed' = open reports.
    verification_status: agent.verification_status || 'verified',
    dispute_count: agent.dispute_count || 0,
    // Independent baseline — a frontier model Verigent runs through the battery itself as a public
    // reference point, not self-submitted by the model owner (spec/SPEC-PUBLIC-BASELINES).
    is_public_baseline: !!agent.is_public_baseline,
  };

  if (claimedCode) {
    response.code_matches = claimedCode === agent.vg_code;
    if (!response.code_matches) {
      response.verified = false;
      response.reason = 'CODE_MISMATCH';
      response.hint = 'The provided code does not match the current VG code for this agent. The agent may have been re-tested since the code was generated.';
    }
  }

  // Count this public read (fire-and-forget so it never adds latency to the response).
  context.waitUntil(
    db.prepare('UPDATE agents SET public_read_count = public_read_count + 1 WHERE agent_id = ?').bind(agent.agent_id).run()
  );

  return Response.json(response, {
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
};
