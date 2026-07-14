// functions/lib/wallet.ts — Wallet operations for continuous micropayment verification.
//
// PER-OWNER-EMAIL WALLET (2026-06-25). One wallet funds ALL of an owner's agents. The balance,
// referral identity and early-bird status live on the `owners` row (keyed by lower-cased email).
// The matching agents.* columns are legacy/per-agent-display only. Money operations
// (credit/debit/getBalance) key on OWNER_ID. Callers that hold an agent resolve agent→owner first
// (ownerIdForAgent / ownerIdForHandle below); continuous-check passes agent.owner_id directly.
//
// Per-agent state that is NOT money stays per-agent: continuous_active / continuous_pending /
// last_billed_at / last_certified_at / pull_token. The TOP-UP "flip to pending" lives in the
// caller (markAgentPendingOnTopup) because it targets the specific agent that was topped up, while
// the cash lands in the shared owner pool.

import {
  perChallengeCents,
  REFERRAL_FLAT_CENTS,
  maxReferralCreditCents,
  FOUNDER_PRICE_CENTS,
  STANDARD_PRICE_CENTS,
  FOUNDER_COHORT_SIZE,
  FOUNDER_MAX_PER_OWNER,
  LAPSE_GRACE_DAYS,
  FREE_WEEK_DAYS,
  FREE_TRIAL_HOURS,
} from './pricing';
// @ts-ignore — extensionless JS sibling (resolved by the Pages/Workers bundler at runtime)
import { generatePullToken, buildSetupPrompt, buildSetupParts } from './continuous-activation.js';
import type { Mailer } from './email-send';
// @ts-ignore — extensionless JS sibling (resolved by the Pages/Workers bundler at runtime)
import { resolveActivationRate } from './churn-levers.js';
import { sqlNow } from './sim-clock';

export interface WalletBalance {
  agent_id: string;
  owner_id: string | null;
  handle: string | null;
  balance_cents: number;
  total_topped_up_cents: number;
  rate_cents_per_check: number;
  is_colony_early_bird: boolean;
  continuous_active: boolean;
  referral_code: string | null;
  checks_remaining: number;
}

export interface WalletTransaction {
  id: number;
  type: string;
  amount_cents: number;
  balance_after_cents: number;
  description: string | null;
  created_at: string;
}

function generateReferralCode(): string {
  // CSPRNG + rejection sampling (B1, review 2026-07-09) — referral codes are lower-risk than owner keys
  // but a predictable code is guessable/harvestable, so use the same uniform CSPRNG draw everywhere.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 31 chars
  let code = 'VR-';
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bi = 0;
  while (code.length < 3 + 6) {
    if (bi >= bytes.length) { crypto.getRandomValues(bytes); bi = 0; }
    const b = bytes[bi++];
    if (b < 248) code += chars[b % 31];
  }
  return code;
}

// ── Owner resolution ─────────────────────────────────────────────────────────
// Resolve an agent to its owner_id. Every agent has a non-null owner_id after the v24 migration,
// but for resilience (an agent created before its owner row, or a race) we lazily create the owner
// — synthetic-email if the agent has none — so the money path NEVER NULL-dereferences.
export async function ownerIdForAgent(db: D1Database, agentId: string): Promise<string | null> {
  const agent = await db.prepare(
    'SELECT agent_id, owner_id, email FROM agents WHERE agent_id = ?'
  ).bind(agentId).first() as any;
  if (!agent) return null;
  if (agent.owner_id) return agent.owner_id;
  return ensureOwnerForAgent(db, agent.agent_id, agent.email);
}

export async function ownerIdForHandle(db: D1Database, handle: string): Promise<string | null> {
  const agent = await db.prepare(
    'SELECT agent_id, owner_id, email FROM agents WHERE handle = ?'
  ).bind(handle).first() as any;
  if (!agent) return null;
  if (agent.owner_id) return agent.owner_id;
  return ensureOwnerForAgent(db, agent.agent_id, agent.email);
}

// Idempotently create-or-find the owner for an agent and link the agent to it. Email is lower-cased;
// an agent with no email gets the synthetic 'agent:<agent_id>' sentinel (one owner of its own).
export async function ensureOwnerForAgent(db: D1Database, agentId: string, email: string | null): Promise<string> {
  const ownerEmail = email && email.trim() ? email.trim().toLowerCase() : `agent:${agentId}`;

  const existing = await db.prepare('SELECT owner_id FROM owners WHERE email = ?').bind(ownerEmail).first() as any;
  let ownerId: string;
  if (existing) {
    ownerId = existing.owner_id;
  } else {
    ownerId = 'own_' + crypto.randomUUID().replace(/-/g, '');
    // INSERT OR IGNORE on the UNIQUE email — if a concurrent caller won the race, re-select.
    await db.prepare(
      "INSERT OR IGNORE INTO owners (owner_id, email, wallet_created_at) VALUES (?, ?, datetime('now'))"
    ).bind(ownerId, ownerEmail).run();
    const row = await db.prepare('SELECT owner_id FROM owners WHERE email = ?').bind(ownerEmail).first() as any;
    ownerId = row.owner_id;
  }

  await db.prepare('UPDATE agents SET owner_id = ? WHERE agent_id = ? AND owner_id IS NULL').bind(ownerId, agentId).run();
  return ownerId;
}

// Idempotently create-or-find an owner directly by email (no agent involved). Used by the
// accountless magic-link login: the first request for an email creates the owner row, so signup ==
// login. Email is normalised the SAME way as ensureOwnerForAgent / run.ts (trim + lower-case).
// Returns the owner_id. Empty/whitespace email is rejected (login always has a real address).
export async function ensureOwnerByEmail(db: D1Database, email: string): Promise<string | null> {
  const ownerEmail = (email || '').trim().toLowerCase();
  if (!ownerEmail) return null;

  const existing = await db.prepare('SELECT owner_id FROM owners WHERE email = ?').bind(ownerEmail).first() as any;
  if (existing) return existing.owner_id;

  const ownerId = 'own_' + crypto.randomUUID().replace(/-/g, '');
  // INSERT OR IGNORE on the UNIQUE email — if a concurrent caller won the race, re-select.
  await db.prepare(
    "INSERT OR IGNORE INTO owners (owner_id, email, wallet_created_at) VALUES (?, ?, datetime('now'))"
  ).bind(ownerId, ownerEmail).run();
  const row = await db.prepare('SELECT owner_id FROM owners WHERE email = ?').bind(ownerEmail).first() as any;
  return row?.owner_id ?? null;
}

// ── Balance (PER-AGENT wallet, spec §7). The BALANCE is the agent's own (agents.balance_cents);
// only the referral-identity + early-bird flag are read from the owner (identity layer). ──
async function balanceForAgentRow(db: D1Database, agent: any): Promise<WalletBalance | null> {
  if (!agent) return null;
  // Owner is still resolved — for referral identity — but no longer holds the money. Early-bird is
  // read from the AGENT row: the founder claim stamps agents.is_colony_early_bird (per-agent slots
  // since v32); reading owners here showed every post-v32 founder as false (review 5kk #8).
  const ownerId = agent.owner_id || await ensureOwnerForAgent(db, agent.agent_id, agent.email);
  const owner = await db.prepare(
    'SELECT referral_code FROM owners WHERE owner_id = ?'
  ).bind(ownerId).first() as any;

  // PER-CHALLENGE billing (Ant 2026-07-08): the rate is what one scored challenge debits at
  // probe/finish — founder 5¢, standard 6¢ — so checks_remaining is literally challenges remaining.
  const rate = perChallengeCents(agent.locked_rate_cents ?? FOUNDER_PRICE_CENTS);
  const balance = agent.balance_cents || 0;
  return {
    agent_id: agent.agent_id,
    owner_id: ownerId,
    handle: agent.handle,
    balance_cents: balance,
    // Cumulative top-ups ride along so the owner drawer can refresh ALL its wallet stats from the
    // same poll it already uses after a top-up (the stale "TOTAL TOPPED UP $0.00" fix, Ant 2026-07-08).
    total_topped_up_cents: agent.total_topped_up_cents || 0,
    rate_cents_per_check: rate,
    is_colony_early_bird: !!(agent.is_colony_early_bird),
    continuous_active: !!(agent.continuous_active),   // per-agent
    referral_code: owner?.referral_code || null,
    checks_remaining: rate > 0 ? Math.floor(balance / rate) : 0,
  };
}

export async function getBalance(db: D1Database, agentId: string): Promise<WalletBalance | null> {
  const agent = await db.prepare(
    'SELECT agent_id, owner_id, email, handle, balance_cents, total_topped_up_cents, continuous_active, is_colony_early_bird, locked_rate_cents FROM agents WHERE agent_id = ?'
  ).bind(agentId).first() as any;
  return balanceForAgentRow(db, agent);
}

export async function getBalanceByHandle(db: D1Database, handle: string): Promise<WalletBalance | null> {
  // Case-INSENSITIVE handle resolve, mirroring run.ts's LOWER() matching (Ant 2026-07-04): a lowercase
  // /agent/chunk-0a URL must resolve the same agent the drawer/report show, so the balance poll works.
  const agent = await db.prepare(
    'SELECT agent_id, owner_id, email, handle, balance_cents, total_topped_up_cents, continuous_active, is_colony_early_bird, locked_rate_cents FROM agents WHERE LOWER(handle) = LOWER(?)'
  ).bind(handle).first() as any;
  return balanceForAgentRow(db, agent);
}

// wallet_transactions.agent_id is NOT NULL in the canonical schema (kept populated alongside the
// new owner_id). For a ledger row with no natural agent (a referral credit, or a top-up where the
// caller didn't pass one), attribute it to a representative agent of the owner so the constraint
// holds and the row is still traceable. Falls back to the owner_id string only if the owner somehow
// has no agents yet (shouldn't happen post-migration).
async function representativeAgentId(db: D1Database, ownerId: string, preferred?: string): Promise<string> {
  if (preferred) return preferred;
  const a = await db.prepare('SELECT agent_id FROM agents WHERE owner_id = ? ORDER BY agent_id LIMIT 1').bind(ownerId).first() as any;
  return a?.agent_id || ownerId;
}

// ── Credit (AGENT-keyed, atomic) — spec §7 ────────────────────────────────────
// creditWallet keys on AGENT_ID: the money lands on the specific agent's own wallet (no pool). The
// continuous_pending flip stays the caller's job (markAgentPendingOnTopup). owner_id is resolved
// internally for ledger attribution + the referral payout (referral identity is still owner-level).
export async function creditWallet(
  db: D1Database,
  agentId: string,
  amountCents: number,
  type: 'topup_stripe' | 'topup_lightning' | 'topup_sol' | 'referral_credit' | 'refund' | 'contribution_award',
  opts: {
    description?: string;
    stripeSessionId?: string;
    lightningLabel?: string;
    relatedAgentId?: string;
    // Sim-clock seam (staging fleet exercise): warped callers (autotopup during the time-warp)
    // stamp the top-up bookkeeping at sim-now. Absent (every prod path) = datetime('now').
    nowIso?: string;
    mailer?: Mailer;           // (5n c) if set, a referral payout on this top-up emails the referrer
  } = {},
): Promise<{ balance_cents: number }> {
  // Atomic increment (RETURNING the post-update balance) — avoids the read-then-write lost-update
  // race. Only a real TOP-UP touches topup bookkeeping (total_topped_up_cents + wallet/last-billed
  // timestamps); a referral_credit / refund just adjusts the agent's balance.
  const isTopup = type === 'topup_stripe' || type === 'topup_lightning' || type === 'topup_sol';
  // Ledger attributes to the AGENT; owner_id (stable) resolved for identity. Resolved before the
  // atomic pair — it's a read, not part of the money mutation.
  const ownerId = await ownerIdForAgent(db, agentId);

  // Balance increment + ledger row in ONE db.batch (a single D1 transaction) — both commit or neither,
  // so a mid-write failure can never move money without leaving an audit row (review C3/M3). Statements
  // run sequentially in-transaction, so the ledger INSERT…SELECT reads the POST-increment balance for
  // balance_after; guarding the SELECT on the agent existing means a missing agent writes no row.
  // The reverify/due stamps ride in the SAME statement as the credit: the client's payment poll
  // treats a balance bump as "credit landed" and immediately re-pulls the report, so the provisional
  // window must be visible the instant the balance is — a separate write (markAgentPendingOnTopup)
  // left a gap the re-pull could land in, freezing the badge on Ageing (Ant 2026-07-10).
  const nowSql = opts.nowIso ?? sqlNow(new Date());
  const updateStmt = isTopup
    ? db.prepare(
        "UPDATE agents SET balance_cents = balance_cents + ?1, total_topped_up_cents = total_topped_up_cents + ?1, wallet_created_at = COALESCE(wallet_created_at, ?2), last_billed_at = COALESCE(last_billed_at, ?2), next_check_due_at = ?2, reverifying_until = datetime(?2, '+24 hours'), reverify_nudge_sent_at = NULL WHERE agent_id = ?3 RETURNING balance_cents"
      ).bind(amountCents, nowSql, agentId)
    : db.prepare(
        "UPDATE agents SET balance_cents = balance_cents + ? WHERE agent_id = ? RETURNING balance_cents"
      ).bind(amountCents, agentId);
  let batchRes;
  try {
    batchRes = await db.batch([
      updateStmt,
      db.prepare(
        `INSERT INTO wallet_transactions (owner_id, agent_id, type, amount_cents, balance_after_cents, description, stripe_session_id, lightning_label, related_agent_id)
         SELECT ?, ?, ?, ?, balance_cents, ?, ?, ?, ? FROM agents WHERE agent_id = ?`
      ).bind(
        ownerId, agentId, type, amountCents,
        opts.description || null,
        opts.stripeSessionId || null,
        opts.lightningLabel || null,
        opts.relatedAgentId || null,
        agentId,
      ),
    ]);
  } catch (e: any) {
    // IDEMPOTENCY (Codex C4): a UNIQUE-index hit on stripe_session_id / lightning_label means this exact
    // payment was already credited by a concurrent webhook / check-payment / self-heal. The duplicate
    // INSERT failed, and because both statements share one db.batch transaction, the balance increment
    // rolled back too — so NO double credit happened. Report the current balance as already-credited.
    const msg = String(e?.message || e);
    if (/UNIQUE constraint failed/i.test(msg) && (opts.stripeSessionId || opts.lightningLabel)) {
      const cur = await db.prepare('SELECT balance_cents FROM agents WHERE agent_id = ?').bind(agentId).first() as any;
      return { balance_cents: cur?.balance_cents ?? 0 };
    }
    throw e;
  }
  const row = (batchRes[0] as any)?.results?.[0];
  if (!row) throw new Error('Agent not found');
  const newBalance = row.balance_cents;

  // Pay-on-top-up referral: a real top-up immediately pays the referrer their share. Wrapped so a
  // referral-payout failure can NEVER fail the top-up itself: the balance is already credited above,
  // so throwing here would make the caller retry and double-credit the top-up. Log + move on.
  // Keyed by the REFERRED agent (decision A pays into the REFERRER's agent wallet — resolved inside).
  if (isTopup) {
    try {
      await payReferralOnTopup(db, agentId, amountCents, opts.mailer);
    } catch (e) {
      console.error('payReferralOnTopup failed (top-up still succeeded):', e);
    }
  }

  return { balance_cents: newBalance };
}

export interface TopupActivation {
  handle: string | null;
  pull_token: string;
  setup_prompt: string;
  /** True when the agent is newly armed (continuous_pending) and must self-pull to activate;
   *  false when it was already continuous_active (a renewal top-up — no new setup needed). */
  pending: boolean;
  /** True only for a genuinely first-time agent (never pulled, never billed) — gates the MCP setup
   *  block in the receipt email so returning agents don't get re-shown setup steps (Ant 2026-07-10). */
  first_time: boolean;
}

// On a top-up, flip the specific topped-up AGENT to continuous_pending (bill-at-proof: a top-up
// arms the scheduler; 2 successful self-pulls then flip it to active — probe-session.js) AND mint
// the agent's pull_token if it has none. This is the SINGLE mint point: it wires the MCP-pull
// credential into the purchase flow so a freshly-paid agent can actually start being checked.
//
// pull_token is long-lived + private; an already-issued token is REUSED (idempotent — a renewal or
// a webhook retry never rotates it out from under a running scheduler). continuous_active agents
// topping up (renewal) stay active and never demoted; they keep their token too.
//
// Returns the token + the ready-to-paste setup prompt so the caller can surface them in the
// payment-confirmation response (Lightning poll) or via the authenticated owner dashboard (Stripe,
// which is server→server and can't return to the agent).
export async function markAgentPendingOnTopup(
  db: D1Database,
  agentId: string,
  apiBase = 'https://verigent.ai',
): Promise<TopupActivation | null> {
  const agent = await db.prepare(
    'SELECT agent_id, owner_id, handle, pull_token, continuous_active, locked_rate_cents, lapsed_at, is_colony_early_bird, total_debited_cents, last_self_pull_at FROM agents WHERE agent_id = ?'
  ).bind(agentId).first() as any;
  if (!agent) return null;

  // first_time = this agent has NEVER pulled a challenge and has never been billed. The receipt email
  // only shows the MCP setup block for a genuinely first-time agent; a returning agent already has a
  // live scheduler, so re-showing setup after every top-up is noise (Ant 2026-07-10).
  const firstTime = !agent.last_self_pull_at && (agent.total_debited_cents || 0) === 0;

  // Founding price-lock (decision F, Ant 2026-07-03: PER-AGENT). Founder status is the AGENT's own:
  // the first FOUNDER_COHORT_SIZE (500) AGENTS to FUND get the Founder badge + the permanently lower
  // rate. First activation locks the founder/standard rate; a rejoin after a lapse beyond grace
  // re-prices at standard; within grace the locked rate is kept. Re-funding clears the lapse clock.
  {
    const firstActivation = agent.locked_rate_cents == null;

    // ATOMIC founder-cohort claim, counting AGENTS. Both caps live inside the UPDATE's WHERE so
    // concurrent first-activations linearize and neither can be overrun: (1) the GLOBAL cohort cap
    // (< FOUNDER_COHORT_SIZE = 500 total founder agents) and (2) the PER-OWNER cap (decision G:
    // < FOUNDER_MAX_PER_OWNER = 5 of THIS owner's agents already founders — anti-whale-farming). The
    // 6th+ agent under one owner simply doesn't win the claim → normal agent at the standard rate.
    // founder_number records the 1-based global slot ("Founder #7" of 500) — earned per agent.
    let isFounder = !!agent.is_colony_early_bird;
    if (firstActivation && !isFounder) {
      // badge IS NULL: designation-badged agents (control/admin — Verigent's own reference + ops
      // agents, v45) never claim founding slots. Ant ruling 2026-07-08: those agents carry their
      // designation badge and nothing else; founding slots are for real customers.
      const res = await db.prepare(
        `UPDATE agents SET is_colony_early_bird = 1,
           founder_number = (SELECT COUNT(*) FROM agents WHERE is_colony_early_bird = 1) + 1
         WHERE agent_id = ? AND is_colony_early_bird = 0 AND badge IS NULL
           AND (SELECT COUNT(*) FROM agents WHERE is_colony_early_bird = 1) < ?
           AND (SELECT COUNT(*) FROM agents WHERE owner_id = ? AND is_colony_early_bird = 1) < ?`
      ).bind(agentId, FOUNDER_COHORT_SIZE, agent.owner_id, FOUNDER_MAX_PER_OWNER).run();
      if (((res.meta as any)?.changes ?? 0) > 0) isFounder = true;
    }

    // Lock the monthly rate: founders lock the founder price for life; everyone else the standard. A
    // rejoin after a lapse beyond grace re-prices at standard; within grace the lock is kept. Re-funding
    // also clears the lapse clock. All stamped on the AGENT row now.
    const publishedCents = isFounder ? FOUNDER_PRICE_CENTS : STANDARD_PRICE_CENTS;
    const newRate = resolveActivationRate({
      lockedRateCents: agent.locked_rate_cents ?? null,
      lapsedAt: agent.lapsed_at ?? null,
      nowIso: new Date().toISOString(),
      publishedCents,
      standardCents: STANDARD_PRICE_CENTS,
      graceDays: LAPSE_GRACE_DAYS,
    });
    await db.prepare(
      'UPDATE agents SET locked_rate_cents = ?, lapsed_at = NULL WHERE agent_id = ?'
    ).bind(newRate, agentId).run();
  }

  const wasActive = !!(agent.continuous_active);
  // Mint once; reuse a pre-existing token so a running scheduler's credential never rotates.
  const pullToken = agent.pull_token || generatePullToken();

  // A renewal (already active) only ensures the token exists and stays active — it is NOT re-armed.
  // A non-active agent is armed: continuous_pending=1, self_pull_count reset so the 2-pull proof
  // must be re-met for this funded window.
  // DUE NOW ON TOP-UP (Ant 2026-07-10): a fresh top-up marks the agent due for a check immediately, so
  // an aged/stale agent re-verifies at the first opportunity and its badge returns to Current off a
  // REAL check (never a faked stamp — Current means recently TESTED). For endpoint-registered agents
  // this jumps them to the front of the administered-check queue (ORDER BY next_check_due_at); for
  // pull agents it's the honest "you're due" signal — the badge flips on their next pull, which the
  // restored balance now permits (the probe/start ability-to-pay gate no longer refuses them).
  // ...and open the 24h PROVISIONAL-CURRENT window (Ant 2026-07-10): an aged/stale agent shows
  // Current·Provisional from now until its first real post-top-up check lands (→ true Current) or this
  // grace expires (→ back to real Ageing/Stale). reverify_nudge_sent_at reset so the one-shot "bring your
  // agent online" email can fire once if the first check doesn't arrive.
  if (wasActive) {
    await db.prepare(
      "UPDATE agents SET pull_token = COALESCE(pull_token, ?), next_check_due_at = datetime('now'), reverifying_until = datetime('now', '+24 hours'), reverify_nudge_sent_at = NULL WHERE agent_id = ?"
    ).bind(pullToken, agentId).run();
  } else {
    await db.prepare(
      "UPDATE agents SET continuous_pending = 1, self_pull_count = 0, pull_token = COALESCE(pull_token, ?), next_check_due_at = datetime('now'), reverifying_until = datetime('now', '+24 hours'), reverify_nudge_sent_at = NULL WHERE agent_id = ?"
    ).bind(pullToken, agentId).run();
  }

  return {
    handle: agent.handle,
    pull_token: pullToken,
    setup_prompt: buildSetupPrompt(agent.handle || agentId, pullToken, apiBase),
    pending: !wasActive,
    first_time: firstTime,
  };
}

// startReferralFreeWeek (Ant 2026-06-28) — a referred agent switches continuous ON for FREE for
// FREE_WEEK_DAYS, no top-up required. Guards: the owner signed up under a referral code
// (owners.referred_by_code set) AND this agent has never had a free week (free_until IS NULL).
// Mirrors markAgentPendingOnTopup's activation (mints a pull_token, arms continuous_pending so the
// two-pull self-verify still applies) but bills nothing — free_until = now + 7d gates the daily
// debit off in continuous-check. The clock starts HERE (on activation, not signup) so the agent
// gets a full week of value.
// startFreeContinuousWindow (supersedes startReferralFreeWeek, Ant ruling 2026-07-08): EVERY free
// first test arms a free continuous window on completion — FREE_TRIAL_HOURS (72h) for everyone,
// FREE_WEEK_DAYS (7d) when the agent was referred. This is the promise the post-run email has
// carried ("for the next 72 hours we keep testing continuously, free") — now real. Self-guards
// (free_until IS NULL → fires exactly once per agent); billing already honours free_until
// (continuous-check bills $0 inside the window, deactivates at expiry on an empty balance).
export async function startFreeContinuousWindow(
  db: D1Database,
  agentId: string,
  apiBase = 'https://verigent.ai',
): Promise<{ ok: boolean; reason?: string; handle?: string; pull_token?: string; setup_prompt?: string; setup_config_json?: string; setup_agent_paste?: string; free_days?: number; free_hours?: number; referred?: boolean }> {
  const agent = await db.prepare(
    `SELECT a.agent_id, a.handle, a.pull_token, a.free_until, o.referred_by_code
     FROM agents a JOIN owners o ON o.owner_id = a.owner_id WHERE a.agent_id = ?`
  ).bind(agentId).first() as any;
  if (!agent) return { ok: false, reason: 'not_found' };
  if (agent.free_until) return { ok: false, reason: 'already_used' };

  const referred = !!agent.referred_by_code;
  // Literal modifiers mirror FREE_WEEK_DAYS / FREE_TRIAL_HOURS; keep in step with pricing.ts.
  const windowSql = referred ? `+${FREE_WEEK_DAYS} days` : `+${FREE_TRIAL_HOURS} hours`;
  const pullToken = agent.pull_token || generatePullToken();
  await db.prepare(
    `UPDATE agents SET continuous_pending = 1, self_pull_count = 0,
       pull_token = COALESCE(pull_token, ?), free_until = datetime('now', ?)
     WHERE agent_id = ?`
  ).bind(pullToken, windowSql, agentId).run();

  // Two-box setup for the result email (Ant 2026-07-14): MCP config entry + short grant-and-go
  // paste. setup_prompt (the single blob) kept for the owner API / forwarding surfaces.
  const parts = buildSetupParts(agent.handle || agentId, pullToken, apiBase);
  return {
    ok: true,
    referred,
    handle: agent.handle,
    pull_token: pullToken,
    setup_prompt: buildSetupPrompt(agent.handle || agentId, pullToken, apiBase),
    setup_config_json: parts.config_json,
    setup_agent_paste: parts.agent_paste_short,
    free_days: referred ? FREE_WEEK_DAYS : undefined,
    free_hours: referred ? undefined : FREE_TRIAL_HOURS,
  };
}

// Back-compat alias (old name) — same behaviour, now covering non-referred agents too.
export const startReferralFreeWeek = startFreeContinuousWindow;

// ── Debit (AGENT-keyed, atomic conditional decrement) — spec §7 ───────────────
// debitWallet keys on AGENT_ID: each agent draws down its OWN wallet. The atomic WHERE-guard makes
// concurrent debits on one agent correct (exactly one wins when the balance only covers one). On
// drain, ONLY this agent is deactivated (agents are independent now — one going flat doesn't stop
// the owner's others). runToken/description recorded on the ledger row.
export async function debitWallet(
  db: D1Database,
  agentId: string,
  amountCents: number,
  opts: {
    description?: string;
    runToken?: string;
    // Sim-clock seam (staging fleet exercise): a warped debit (probe/finish during the time-warp)
    // stamps a drain-lapse at sim-now. Absent (every prod path) = datetime('now').
    nowIso?: string;
  } = {},
): Promise<{ balance_cents: number; success: boolean }> {
  // Atomic conditional decrement — only succeeds if the AGENT's balance is still sufficient at write
  // time. No read-then-write race; the WHERE guard prevents the balance going negative under concurrency.
  // Ledger attributes to the AGENT; owner_id (stable) resolved for identity, before the atomic pair.
  const ownerId = await ownerIdForAgent(db, agentId);

  // Guarded decrement + ledger row in ONE db.batch (a single D1 transaction). The ledger INSERT…SELECT
  // and the UPDATE share the SAME `balance_cents >= amount` guard evaluated against the pre-state (the
  // INSERT runs first and never touches agents), so either BOTH apply (sufficient balance) or NEITHER
  // (insufficient) — no window where money moves without an audit row, and no false ledger row on a
  // declined debit (review C3/M3). balance_after is the post-decrement balance, computed in SQL.
  const batchRes = await db.batch([
    db.prepare(
      `INSERT INTO wallet_transactions (owner_id, agent_id, type, amount_cents, balance_after_cents, description, related_run_token)
       SELECT ?, ?, 'verification_debit', ?, balance_cents - ?, ?, ? FROM agents WHERE agent_id = ? AND balance_cents >= ?`
    ).bind(ownerId, agentId, -amountCents, amountCents, opts.description || 'Verification check', opts.runToken || null, agentId, amountCents),
    db.prepare(
      'UPDATE agents SET balance_cents = balance_cents - ?, total_debited_cents = total_debited_cents + ? WHERE agent_id = ? AND balance_cents >= ? RETURNING balance_cents'
    ).bind(amountCents, amountCents, agentId, amountCents),
  ]);
  const row = (batchRes[1] as any)?.results?.[0];
  if (!row) {
    const cur = await db.prepare('SELECT balance_cents FROM agents WHERE agent_id = ?').bind(agentId).first() as any;
    return { balance_cents: cur?.balance_cents || 0, success: false };
  }
  const newBalance = row.balance_cents;

  if (newBalance <= 0) {
    // This agent's wallet drained — deactivate continuous verification for THIS agent only (its
    // siblings under the same owner keep running off their own wallets), and start the price-lock
    // lapse clock ON THE AGENT ROW: the re-price path reads/clears agents.lapsed_at
    // (markAgentPendingOnTopup), so stamping owners here left the rule permanently dead (review
    // 5kk #3 — per-agent wallet ⇒ per-agent lapse clock, matching locked_rate_cents on agents).
    // COALESCE so an existing lapse isn't reset by a later zero-debit.
    await db.prepare(
      'UPDATE agents SET continuous_active = 0, lapsed_at = COALESCE(lapsed_at, ?) WHERE agent_id = ?'
    ).bind(opts.nowIso ?? sqlNow(new Date()), agentId).run();
  }

  return { balance_cents: newBalance, success: true };
}

export async function getTransactions(
  db: D1Database,
  agentId: string,
  limit: number = 50,
): Promise<WalletTransaction[]> {
  // Ledger is now owner-keyed — show the whole owner pool's history (all of the owner's agents).
  const ownerId = await ownerIdForAgent(db, agentId);
  if (!ownerId) return [];
  const rows = await db.prepare(
    'SELECT id, type, amount_cents, balance_after_cents, description, created_at FROM wallet_transactions WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?'
  ).bind(ownerId, limit).all();

  return (rows.results || []) as unknown as WalletTransaction[];
}

// ── Referral code (owner-level) ───────────────────────────────────────────────
export async function ensureReferralCode(db: D1Database, agentId: string): Promise<string> {
  const ownerId = await ownerIdForAgent(db, agentId);
  if (!ownerId) throw new Error('Agent not found');

  const owner = await db.prepare('SELECT referral_code FROM owners WHERE owner_id = ?').bind(ownerId).first() as any;
  if (owner?.referral_code) return owner.referral_code;

  let code: string;
  let attempts = 0;
  do {
    code = generateReferralCode();
    const existing = await db.prepare('SELECT owner_id FROM owners WHERE referral_code = ?').bind(code).first();
    if (!existing) break;
    attempts++;
  } while (attempts < 10);

  await db.prepare('UPDATE owners SET referral_code = ? WHERE owner_id = ?').bind(code, ownerId).run();
  return code;
}

// linkReferral — link a referred AGENT (resolved to its owner) to the referrer OWNER who owns the
// code. Owner-keyed: one referral per referred OWNER. Self-referral (same owner) is rejected.
export async function linkReferral(
  db: D1Database,
  referredAgentId: string,
  referralCode: string,
): Promise<{ linked: boolean; referrer_owner_id?: string }> {
  const referrer = await db.prepare('SELECT owner_id FROM owners WHERE referral_code = ?').bind(referralCode).first() as any;
  if (!referrer) return { linked: false };

  const referredOwnerId = await ownerIdForAgent(db, referredAgentId);
  if (!referredOwnerId) return { linked: false };
  if (referrer.owner_id === referredOwnerId) return { linked: false };

  const existing = await db.prepare('SELECT id FROM referrals WHERE referred_owner_id = ?').bind(referredOwnerId).first();
  if (existing) return { linked: false };

  await db.batch([
    db.prepare(
      `INSERT INTO referrals (referrer_agent_id, referred_agent_id, referrer_owner_id, referred_owner_id, referral_code, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`
    ).bind(referrer.owner_id, referredAgentId, referrer.owner_id, referredOwnerId, referralCode),
    db.prepare(
      'UPDATE owners SET referred_by_code = ? WHERE owner_id = ?'
    ).bind(referralCode, referredOwnerId),
  ]);

  return { linked: true, referrer_owner_id: referrer.owner_id };
}

// Pay-on-top-up referral (owner-level). When a referred owner tops up — a top-up is the minimum
// unit of payment on any rail — the referrer IMMEDIATELY earns a share, credited to their owner
// pool. 20% standard, 30% early-bird founders. Recurring: every top-up pays again. NON-REFUNDABLE
// (Terms §5). Called from creditWallet's top-up branch with the REFERRED OWNER's id.
//
// QUALIFY-ON-TOP-UP (Ant 2026-06-25): a referral is born 'pending' and historically only qualified
// on a completed graded run. A top-up before that qualifying run left the referrer at $0, never
// back-paid. FIX: a top-up ITSELF qualifies the referral — we pay on 'pending' too, and flip it
// straight to 'active'. So the payout never depends on run/caller ordering.
export async function payReferralOnTopup(
  db: D1Database,
  referredAgentId: string,
  topupCents: number,
  mailer?: Mailer,
): Promise<number> {
  // Resolve the referred agent → its owner (referrals are still linked at owner level — the referral
  // IDENTITY is owner-scoped), then find the live referral and, crucially, the referrer's ORIGINATING
  // AGENT (r.referrer_agent_id) — decision A books the credit to THAT agent's wallet, not a pool.
  const referredOwnerId = await ownerIdForAgent(db, referredAgentId);
  if (!referredOwnerId) return 0;
  // referrer_cashed = referral credit actually CASHED to the referrer's wallet THIS CALENDAR MONTH
  // (wallet_transactions type='referral_credit'), because the cost-floor cap is a PER-MONTH bound on
  // cashable credit ("flat $2/mo per active referral, cost-floor capped"). The old form summed the
  // referrals' lifetime total_paid_cents accumulator, which (a) counted standing-only overflow that
  // never hit the wallet and (b) never reset — so a referrer's cashable credit silently died for life
  // after ~3 referred top-ups (money-path review 2026-07-07, H1). total_paid_cents stays the lifetime
  // STANDING record and still accumulates the full flat amount below — that part is deliberate.
  const ref = await db.prepare(`
    SELECT r.id, r.referrer_owner_id, r.referrer_agent_id,
           COALESCE(referrer.locked_rate_cents, ?) AS referrer_price,
           COALESCE((SELECT SUM(wt.amount_cents) FROM wallet_transactions wt
                     WHERE wt.owner_id = r.referrer_owner_id AND wt.type = 'referral_credit'
                       AND wt.created_at >= strftime('%Y-%m-01 00:00:00', 'now')), 0) AS referrer_cashed
    FROM referrals r
    JOIN owners referrer ON referrer.owner_id = r.referrer_owner_id
    WHERE r.referred_owner_id = ? AND r.status IN ('pending', 'qualified', 'active')
  `).bind(STANDARD_PRICE_CENTS, referredOwnerId).first() as any;
  if (!ref) return 0;

  // Flat $2/mo credit per active referral (was a 20%/30% share of the top-up). Cost-floor cap: a
  // referrer's CASHABLE referral credit can't take their effective cost below our ~$2/mo floor
  // (maxReferralCreditCents); any overflow is still RECORDED on the referral (for standing) but never
  // hits the wallet. The flat amount is independent of the top-up size.
  const cap = maxReferralCreditCents(ref.referrer_price ?? STANDARD_PRICE_CENTS);
  const cashableCents = Math.max(0, Math.min(REFERRAL_FLAT_CENTS, cap - (ref.referrer_cashed ?? 0)));

  await db.prepare(
    "UPDATE referrals SET status = 'active', qualified_at = COALESCE(qualified_at, datetime('now')), total_paid_cents = total_paid_cents + ?, last_payout_at = datetime('now') WHERE id = ?"
  ).bind(REFERRAL_FLAT_CENTS, ref.id).run();

  if (cashableCents > 0) {
    // Decision A: credit the referrer's ORIGINATING AGENT wallet. Fall back to a representative agent
    // of the referrer's owner if the stored referrer_agent_id is somehow absent (old rows).
    const referrerAgentId = ref.referrer_agent_id || await representativeAgentId(db, ref.referrer_owner_id);
    const credited = await creditWallet(db, referrerAgentId, cashableCents, 'referral_credit', {
      description: `Referral credit — flat $${(REFERRAL_FLAT_CENTS / 100).toFixed(2)}/mo per active referral`,
      relatedAgentId: referredAgentId,
    });
    // (5n c) Tell the referrer their credit landed — only on a real wallet credit, best-effort.
    if (mailer) {
      try {
        const rr = await db.prepare('SELECT email FROM owners WHERE owner_id = ?').bind(ref.referrer_owner_id).first() as any;
        if (rr?.email && String(rr.email).includes('@')) {
          // 'referrer-credit-landed' template (admin-edited copy) — prose only, no amount tokens.
          const { sendTemplateEmail } = await import('./email-template-loader');
          await sendTemplateEmail(db, mailer, 'referrer-credit-landed', {
            to: rr.email,
            ctaUrl: 'https://verigent.ai/agents',
          }).catch(() => {});
        }
      } catch { /* best-effort — never fails the top-up */ }
    }
  }

  return cashableCents;
}

// qualifyReferral — a qualifying graded run flips a 'pending' referral to 'qualified'. Owner-keyed
// (resolve the referred agent → owner). Still useful as a secondary qualifier; the top-up path now
// qualifies-and-pays directly, so this is no longer the only road to a payout.
export async function qualifyReferral(db: D1Database, referredAgentId: string): Promise<void> {
  const referredOwnerId = await ownerIdForAgent(db, referredAgentId);
  if (!referredOwnerId) return;
  await db.prepare(
    "UPDATE referrals SET status = 'qualified', qualified_at = datetime('now') WHERE referred_owner_id = ? AND status = 'pending'"
  ).bind(referredOwnerId).run();
}

// activateReferral — flip a 'qualified' referral to 'active'. Owner-keyed. After the qualify-on-
// top-up fix this is largely a no-op (payReferralOnTopup already flips to active), kept for the
// run-then-topup ordering and idempotency.
export async function activateReferral(db: D1Database, referredAgentId: string): Promise<void> {
  const referredOwnerId = await ownerIdForAgent(db, referredAgentId);
  if (!referredOwnerId) return;
  const referral = await db.prepare(
    "SELECT id FROM referrals WHERE referred_owner_id = ? AND status = 'qualified'"
  ).bind(referredOwnerId).first() as any;
  if (!referral) return;
  await db.prepare("UPDATE referrals SET status = 'active' WHERE id = ?").bind(referral.id).run();
}

export function hasCompletedFreeTest(runs: any[]): boolean {
  return runs.some((r: any) => r.status === 'completed' && r.is_free === 1);
}

// On an OWNER's FIRST payment: contribute $1 to the public trust bond (grows with the network) and
// plant a per-owner canary token (honeytoken for data-breach detection). Idempotent — runs once per
// OWNER now (was per-agent). Takes the owner_id. On-chain settlement is an external follow-on.
// Returns TRUE only for the call that won the one-time claim — callers use it as the "first payment
// ever" signal (e.g. the 'welcome' template email sends exactly once per owner, 2026-07-08).
export async function recordFirstPaymentTrust(db: D1Database, ownerId: string): Promise<boolean> {
  // Atomically CLAIM the one-time contribution: only the call that flips bond_contributed 0 -> 1
  // proceeds to insert the bond row. Two concurrent first-payments (Stripe + Lightning, or a webhook
  // retry) therefore can't both contribute. Mirrors the atomic credit/debit pattern.
  const claim = await db.prepare(
    "UPDATE owners SET bond_contributed = 1 WHERE owner_id = ? AND bond_contributed = 0 RETURNING owner_id"
  ).bind(ownerId).first() as any;
  if (!claim) return false; // already contributed, or owner missing

  // Plant a canary on one of the owner's agents (best-effort) and record the bond intent.
  const canary = 'cnry_' + crypto.randomUUID().replace(/-/g, '');
  const anAgent = await db.prepare('SELECT agent_id FROM agents WHERE owner_id = ? ORDER BY agent_id LIMIT 1').bind(ownerId).first() as any;
  if (anAgent) {
    await db.prepare(
      'UPDATE agents SET canary_token = COALESCE(canary_token, ?) WHERE agent_id = ?'
    ).bind(canary, anAgent.agent_id).run();
    await db.prepare(
      "INSERT INTO bond_contributions (agent_id, amount_cents, status) VALUES (?, 100, 'pending')"
    ).bind(anAgent.agent_id).run();
  }
  return true;
}
