// GET /api/agent/:handle — Agent profile with radar, verification status, and (owner-only) history.
// PUBLIC viewers get the CURRENT snapshot only — the point-in-time score a counterparty trusts.
// The full test HISTORY (the progress dashboard) is private: returned only when the request carries
// a valid vg_owner session that OWNS this agent. One verified owner-email unlocks all its agents.

import { verifyOwnerSession, getOwnerTokenFromCookie } from '../../lib/owner-auth';
import { computeFreshness } from '../../lib/freshness';
import { ensureWeeklySnapshot, labelForWeekId, tenureForAgent } from '../../lib/weekly';
import { REFERRAL_FLAT_CENTS, FOUNDER_PRICE_CENTS, perChallengeCents } from '../../lib/pricing';
import { COMPOSITE_DIMENSIONS } from '../../lib/test-manifest';
import { signScorecardLink } from '../../lib/scorecard';

// Composite dims only — the per-task breakdown NEVER exposes shadow / resilience / safety dims.
const COMPOSITE_DIM_SET = new Set(COMPOSITE_DIMENSIONS.map((d) => d.key));

interface Env {
  DB: D1Database;
  OWNER_AUTH_SECRET?: string;
  SCORECARD_LINK_SECRET?: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const handle = context.params.handle as string;
  if (!handle) {
    return Response.json({ error: 'handle is required' }, { status: 400 });
  }

  const db = context.env.DB;

  // Look up by handle or agent_id
  const agent = await db.prepare(
    'SELECT * FROM agents WHERE handle = ? COLLATE NOCASE OR agent_id = ? COLLATE NOCASE'
  ).bind(handle, handle).first() as any;

  if (!agent) {
    return Response.json({ error: 'AGENT_NOT_FOUND' }, { status: 404 });
  }

  // PUBLIC BASELINES publish only once they have a real completed run — a pre-run baseline row
  // rendering as a blank "V0/Stale" report for a recognisable frontier model is a credibility hit
  // waiting to be screenshotted (review 2026-07-05). Until the first run completes, the entry
  // simply doesn't exist publicly.
  if (agent.is_public_baseline) {
    const hasRun = await db.prepare(
      "SELECT 1 AS ok FROM runs WHERE agent_id = ? AND status = 'completed' LIMIT 1"
    ).bind(agent.agent_id).first();
    if (!hasRun) {
      return Response.json({ error: 'AGENT_NOT_FOUND', detail: 'Baseline entry publishes with its first completed verification.' }, { status: 404 });
    }
  }

  // Get registry entry
  const lb = await db.prepare(
    'SELECT * FROM registry WHERE agent_id = ?'
  ).bind(agent.agent_id).first() as any;

  // Founder status (public badge) lives on the AGENT row since the v32 per-agent split — the founder
  // claim stamps agents.is_colony_early_bird/founder_number; reading owners here showed every
  // post-v32 founder as false (review 5kk #8). agent is a SELECT * row, both columns present.
  const isFounder = !!agent.is_colony_early_bird;
  const founderNumber: number | null = agent.founder_number ?? null;

  // Owner gate: history is PRIVATE. Only an authenticated owner session that owns THIS agent sees
  // the trajectory; public viewers get the current snapshot only. One verified owner-email unlocks
  // all of that owner's agents (each agent's owner_id is matched against the session).
  const ownerToken = getOwnerTokenFromCookie(context.request.headers.get('Cookie'));
  const ownerId = await verifyOwnerSession(ownerToken, context.env.OWNER_AUTH_SECRET);
  const isOwner = !!ownerId && agent.owner_id === ownerId;

  // Get test history ONLY for the owner. Continuous verification produces ~5 runs/day, so the
  // dashboard needs a deep window (≈3 weeks at the default cadence) to draw a real trajectory.
  const history = isOwner
    ? await db.prepare(
        'SELECT composite_score, tier, primary_class, class_scores, dimension_scores, completed_at, run_token FROM test_history WHERE agent_id = ? ORDER BY completed_at DESC LIMIT 120'
      ).bind(agent.agent_id).all()
    : { results: [] as any[] };

  // Get model from most recent completed run's run_conditions (+ the run's on-chain artifacts for
  // the proof trail below).
  let testedModel: string | null = null;
  const latestRun = await db.prepare(
    "SELECT run_token, run_conditions, anchor_txid, identity_pubkey, identity_algorithm, composite_score, tier, primary_class, class_scores, dimension_scores, checkpoints, completed_at, attested, battery_hash FROM runs WHERE agent_id = ? AND status = 'completed' ORDER BY completed_at DESC LIMIT 1"
  ).bind(agent.agent_id).first() as any;
  if (latestRun?.run_conditions) {
    try {
      const rc = JSON.parse(latestRun.run_conditions);
      testedModel = rc.model || rc.model_version || null;
    } catch {}
  }

  // PROOF TRAIL (Ant 2026-07-02): every publicly-verifiable artifact this agent produced, one card
  // on the report. Attestation + probe-draw commitment anchor (both BTC OP_RETURN), the sovereign
  // payments the agent actually sent during testing (used_txids, per chain), and the bound identity
  // key (challengeable live on /verify). Rows exist only when the artifact does.
  const proofs: Array<{ kind: string; label: string; id: string; url: string | null }> = [];
  if (lb?.attestation_txid) {
    proofs.push({ kind: 'attestation', label: 'Cert anchored to Bitcoin · OP_RETURN', id: lb.attestation_txid, url: `https://mempool.space/tx/${lb.attestation_txid}` });
  }
  if (latestRun?.anchor_txid && latestRun.anchor_txid !== lb?.attestation_txid) {
    proofs.push({ kind: 'draw_commitment', label: 'Challenge-draw commitment · OP_RETURN', id: latestRun.anchor_txid, url: `https://mempool.space/tx/${latestRun.anchor_txid}` });
  }
  if (latestRun?.run_token) {
    const pays = await db.prepare(
      'SELECT txid, chain FROM used_txids WHERE run_token = ? ORDER BY recorded_at DESC LIMIT 3'
    ).bind(latestRun.run_token).all();
    for (const p of (pays.results || []) as any[]) {
      const sol = (p.chain || 'sol') === 'sol';
      proofs.push({
        kind: sol ? 'payment_sol' : 'payment_btc',
        label: sol ? 'Sovereign payment · Solana' : 'Sovereign payment · Bitcoin',
        id: p.txid,
        url: sol ? `https://solscan.io/tx/${p.txid}` : `https://mempool.space/tx/${p.txid}`,
      });
    }
  }
  if (agent.identity_pubkey || latestRun?.identity_pubkey) {
    const algo = agent.identity_algorithm || latestRun?.identity_algorithm || 'ed25519';
    proofs.push({
      kind: 'identity',
      label: `Bound identity · ${algo} — challenge it live`,
      id: agent.identity_pubkey || latestRun.identity_pubkey,
      url: `/verify?handle=${encodeURIComponent(agent.handle || agent.agent_id)}`,
    });
  }

  // Get rank
  let rank = null;
  if (lb && lb.listed) {
    const rankResult = await db.prepare(
      'SELECT COUNT(*) as rank FROM registry WHERE composite_score > ? AND listed = 1'
    ).bind(lb.composite_score).first() as any;
    rank = (rankResult?.rank ?? 0) + 1;
  }

  // PUBLIC = WEEKLY-FROZEN, OWNER = LIVE (docs/WEEKLY-STANDINGS.md; Ant §7.1 2026-07-02).
  // The public `current` block is the latest PUBLISHED weekly snapshot — the frozen figure a
  // counterparty can rely on until the next drop. The authed owner sees the LIVE continuous state
  // up to the latest probe (their freshness badge carries currency). Enforced HERE, server-side —
  // the live numbers never leave the API for a public viewer once a week has been published.
  // Falls back to live only before the first publication (brand-new agent).
  await ensureWeeklySnapshot(db, agent.agent_id).catch(() => {});
  const snap = !isOwner
    ? await db.prepare(
        'SELECT week_id, composite, tier, primary_class, class_scores, dimension_scores, published_at, run_token FROM weekly_snapshots WHERE agent_id = ? ORDER BY week_id DESC LIMIT 1'
      ).bind(agent.agent_id).first() as any
    : null;

  // Class/dim scores + composite/tier live on the RUN row. A FREE (unpaid) run is neither attested
  // into the registry nor weekly-snapshotted, so the old fallback (snap → registry `lb`) left both
  // empty and the report rendered blank (5cc blocker B). Fall back to the latest completed RUN, then
  // the agent row, so every completed run — free or paid — renders its dimensions + radar.
  const parseJson = (s: any) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };
  const nonEmpty = (o: any) => o && Object.keys(o).length > 0;
  // Pick the first source that actually HAS scores: weekly snapshot → registry → the completed run.
  // (A free run isn't in the registry and its weekly snapshot can be empty, so the run is the floor.)
  const pickClass = [parseJson(snap?.class_scores), parseJson(lb?.class_scores), parseJson(latestRun?.class_scores)].find(nonEmpty) || {};
  const pickDim = [parseJson(snap?.dimension_scores), parseJson(lb?.dimension_scores), parseJson(latestRun?.dimension_scores)].find(nonEmpty) || {};
  // Per-dimension measurement status (display contract, grade-batch finalize →
  // checkpoints.dimension_status): { "<dim>": "pending" } for dims NOT measured on the latest run
  // (e.g. session_continuity on a first run — no prior plant to recall). Additive: absent ⇒ every
  // dim shown was measured. Only meaningful when the dims shown come from that same latest run.
  const cpParsed = (() => {
    try {
      const cp = JSON.parse(latestRun?.checkpoints || '{}');
      return cp && typeof cp === 'object' ? cp : {};
    } catch { return {}; }
  })();
  const dimStatus = cpParsed.dimension_status && typeof cpParsed.dimension_status === 'object' ? cpParsed.dimension_status : null;
  // rubric_version (§2.4 — the scoring-band version this run graded under). Absent ⇒ pre-stamp run.
  const rubricVersion = typeof cpParsed.rubric_version === 'string' ? cpParsed.rubric_version : null;
  const current = {
    composite: snap?.composite ?? agent.composite_score ?? latestRun?.composite_score ?? null,
    tier: snap?.tier || agent.current_tier || latestRun?.tier || null,
    primary_class: snap?.primary_class || agent.primary_class || latestRun?.primary_class || null,
    class_scores: pickClass,
    dimension_scores: pickDim,
    ...(dimStatus ? { dimension_status: dimStatus } : {}),
    ...(rubricVersion ? { rubric_version: rubricVersion } : {}),
  };

  // PER-TASK BREAKDOWN (5ff) — the individual task scores that make up each dimension average, so the
  // report can show "one 80 + two 0s", not just the mean. SCORES ONLY, never the prompt text: the
  // probe-draw moat (§2.3) is about not being able to drill a prompt — a past run's numeric scores
  // reveal no prompt and the next draw differs, so this is moat-safe. Composite dims only (never
  // shadow/resilience/safety). Reflects the run the report shows: the frozen weekly run for a public
  // viewer, the latest run for the owner.
  const displayRunToken = (!isOwner && snap?.run_token) ? snap.run_token : (latestRun?.run_token || null);
  const task_breakdown: Record<string, Array<{ score: number; err: boolean }>> = {};
  if (displayRunToken) {
    const trows = await db.prepare(
      'SELECT dimension, COALESCE(validated_score, median_score, 0) AS score, is_error_injected AS err FROM run_tasks WHERE run_token = ? ORDER BY dimension, task_id'
    ).bind(displayRunToken).all();
    for (const t of (trows.results || []) as any[]) {
      if (!COMPOSITE_DIM_SET.has(t.dimension)) continue;
      (task_breakdown[t.dimension] ||= []).push({ score: Math.round(t.score), err: !!t.err });
    }
  }

  // Freshness = the proof-status hero badge (Current/Ageing/Stale). Prefer the agent's LIVE cert clock
  // (last_certified_at — what probe/finish advances on every check), so the report badge agrees with
  // verify/badge/owner, which all key off it. The registry snapshot (lb.last_tested_at) lagged the live
  // clock, so a lapsed agent whose live clock had aged still read Current here — surface disagreement
  // (Ant 2026-07-10). Fall back to the registry snapshot, then the latest run's completion (5cc blocker
  // B — free runs have no registry row, so without a fallback they'd always read Stale).
  const certifiedAt = agent.last_certified_at ?? lb?.last_tested_at ?? latestRun?.completed_at ?? null;
  const freshness = computeFreshness(certifiedAt, { certifiedModel: agent.certified_model, reverifyingUntil: agent.reverifying_until });

  // Track record: consecutive published weeks (the "continuously verified" tenure stat — an accrued,
  // public trust signal that only an unbroken verification run can produce).
  const trackRecord = await tenureForAgent(db, agent.agent_id);

  // OWNER WALLET BLOCK — only on an authenticated owner's own report. Feeds the owner controls
  // (balance / probes slider / auto top-up / referral standing) with REAL data; public viewers and
  // non-owners never receive it.
  let wallet: any = undefined;
  if (isOwner && agent.owner_id) {
    // Balance + top-ups + auto-topup SETTINGS (enabled/threshold/amount/last_status) are the AGENT's
    // own now (spec §7 + step 1b). Only the CARD + login email stay owner-level (the person's shared
    // instrument) — read from owners.
    const o = await db.prepare(
      `SELECT email, stripe_customer_id, stripe_payment_method_id, stripe_card_last4
       FROM owners WHERE owner_id = ?`
    ).bind(agent.owner_id).first() as any;
    const refs = await db.prepare(
      "SELECT COUNT(*) AS n FROM referrals WHERE referrer_owner_id = ? AND status = 'active'"
    ).bind(agent.owner_id).first() as any;
    const activeRefs = refs?.n ?? 0;
    // Per-referee breakdown (5z): who was referred (agent handle/display, falling back to the referred
    // agent id) + status + the flat monthly credit that referral earns. No rank/tier — just the honest
    // list. Ordered newest first, capped so the drawer stays tidy.
    const refListRows = await db.prepare(
      `SELECT r.status AS status,
              COALESCE(a.display_name, a.handle, r.referred_agent_id) AS label
       FROM referrals r
       LEFT JOIN agents a ON a.agent_id = r.referred_agent_id
       WHERE r.referrer_owner_id = ? AND r.status = 'active'
       ORDER BY r.created_at DESC
       LIMIT 12`
    ).bind(agent.owner_id).all();
    const refList = (refListRows.results as any[] ?? []).map((r) => ({
      label: String(r.label ?? 'agent'),
      status: String(r.status ?? 'active'),
      credit_cents: REFERRAL_FLAT_CENTS,
    }));
    wallet = {
      balance_cents: agent.balance_cents ?? 0,
      total_topped_up_cents: agent.total_topped_up_cents ?? 0,
      probes_per_day: agent.probes_per_day ?? 5,
      // Free-window end (72h base / +4d if referred). While in the future, challenges bill $0 — the
      // drawer shows "billing starts <date>" so a top-up during the window doesn't read as broken
      // (Ant 2026-07-10). Null once the window has passed / never granted → normal billing.
      free_until: agent.free_until ?? null,
      // Per-challenge debit rate (Ant 2026-07-08): the drawer derives its displayed daily rate from
      // THIS number (rate × challenges/day) so display always matches what probe/finish debits.
      per_challenge_cents: perChallengeCents(agent.locked_rate_cents ?? FOUNDER_PRICE_CENTS),
      autotopup: {
        enabled: !!agent.autotopup_enabled,
        threshold_usd: (agent.autotopup_threshold_cents ?? 500) / 100,
        amount_usd: (agent.autotopup_amount_cents ?? 1000) / 100,
        card: { saved: !!(o?.stripe_customer_id && o?.stripe_payment_method_id), last4: o?.stripe_card_last4 || null },
        email: (o?.email || '').includes('@') ? o.email : null,
        last_status: agent.autotopup_last_status || null,
      },
      referrals: { active: activeRefs, credit_cents_per: REFERRAL_FLAT_CENTS, list: refList },
    };
  }

  // Owner-only scorecard link. Minted server-side, returned ONLY to the authenticated owner (non-owners
  // always get null → no button). Tier by PAID state = wallet actually topped up (Ant 2026-07-05;
  // corrected same day, review 5kk #2 — attested stopped implying paid when free tests began attesting):
  //   • PAID (total_topped_up_cents > 0) → FULL: a signed link (client never sees SCORECARD_LINK_SECRET).
  //     Fail-closed — if the secret is unset, no signed link (null) rather than a broken one.
  //   • UNPAID → ABBREVIATED: an UNSIGNED link; the endpoint returns the teaser (abbreviated
  //     markdown) for unsigned requests. Surfaces the existing teaser to unpaid owners — NOT a scoring or
  //     grading-eligibility change, just which tier of the already-computed scorecard is linked.
  // The client shows the (identical) scorecard button whenever this is non-null; content tier differs by state.
  let scorecard_url: string | null = null;
  if (isOwner && latestRun?.run_token) {
    if (((agent.total_topped_up_cents as number) || 0) > 0) {
      const sig = await signScorecardLink(latestRun.run_token, context.env.SCORECARD_LINK_SECRET);
      if (sig) scorecard_url = `/api/scorecard/${latestRun.run_token}?sig=${encodeURIComponent(sig)}`;
    } else {
      scorecard_url = `/api/scorecard/${latestRun.run_token}`; // unsigned → abbreviated teaser
    }
  }

  return Response.json({
    agent_id: agent.agent_id,
    handle: agent.handle,
    is_owner: isOwner,
    scorecard_url,
    // Score provenance (commit-reveal): battery version hash the latest run scored under; null =
    // pre-transparency (never faked). Read-only citation for the report page.
    battery_hash: latestRun?.battery_hash ?? null,
    suffix: agent.suffix || '0a',
    display_name: agent.display_name,
    vg_code: agent.vg_code || null,
    is_founder: isFounder,
    founder_number: founderNumber,
    // Independent baseline (spec/SPEC-PUBLIC-BASELINES): a frontier model Verigent runs through the
    // exact same battery as a public reference point — not self-submitted by the model owner. The
    // report keys off this to show the baseline label and suppress owner-only CTAs.
    is_public_baseline: !!agent.is_public_baseline,
    // Owner has authorised the Sovereignty pillar (real-action challenges) but it may not be
    // demonstrated yet — the report greys the radar wedges as "pending" rather than red "locked"
    // until the sovereignty challenges land and grade (Ant 2026-07-10).
    sovereignty_authorized: !!agent.sovereignty_authorized,
    // Designation badge ('control' | 'admin' | null) — v45, punchlist item 9. Shown beside the name.
    badge: agent.badge || null,
    proof: freshness.label,
    // Provisional-Current (Ant 2026-07-10): true while a just-topped-up aged/stale agent is re-verifying
    // and no real check has confirmed yet. Drives the "Provisional" tag + rollover on the freshness badge.
    proof_provisional: !!freshness.provisional,
    track_record: trackRecord,
    // Which frozen drop the public numbers come from; null = live (owner view / pre-first-publish).
    published: snap ? { week_id: snap.week_id, week_label: labelForWeekId(snap.week_id), published_at: snap.published_at } : null,
    current,
    task_breakdown,
    narrative: lb?.narrative || null,
    attestation: lb?.attestation_txid ? {
      txid: lb.attestation_txid,
      explorer: `https://mempool.space/tx/${lb.attestation_txid}`,
    } : null,
    registry: {
      listed: !!(lb && lb.listed),
      rank,
    },
    tested_model: testedModel,
    proofs,
    ...(wallet ? { wallet } : {}),
    stats: {
      total_tests: agent.total_tests,
      member_since: agent.created_at,
      last_tested: certifiedAt,
    },
    history: (history.results || []).map((h: any) => ({
      composite: h.composite_score,
      tier: h.tier,
      primary_class: h.primary_class,
      class_scores: JSON.parse(h.class_scores || '{}'),
      dimension_scores: JSON.parse(h.dimension_scores || '{}'),
      tested_at: h.completed_at,
      run_token: h.run_token || null,
    })),
  });
};
