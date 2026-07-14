// functions/lib/autotopup.ts — min-balance auto-recharge from the owner's saved card
// (docs/AUTO-TOPUP.md). Called from the daily debit sweep after a successful debit / on depletion.
// Exits fast unless: payments master switch on, autotopup_enabled, balance < threshold, and a saved
// Stripe customer + payment method exist (captured by the checkout/webhook pair on a normal card
// top-up — there is no standalone add-card flow).

import { creditWallet } from './wallet';
import { sendTemplateEmail } from './email-template-loader';
import { mailerFromEnv } from './email-send';
import { perChallengeCents, FOUNDER_PRICE_CENTS, BASE_PROBES_PER_DAY } from './pricing';
// @ts-ignore — extensionless JS sibling (resolved by the Pages/Workers bundler at runtime)
import { paymentsEnabledDb } from './payments-flag.js';

interface AutotopupEnv {
  DB: D1Database;
  STRIPE_SECRET_KEY?: string;
  PAYMENTS_ENABLED?: string;
  RESEND_API_KEY?: string;
}

export interface AutotopupResult {
  attempted: boolean;
  succeeded?: boolean;
  reason?: string;          // why it didn't attempt / failed
  credited_cents?: number;
  balance_cents?: number;
}

// Persist the off-session instrument for auto top-up (docs/AUTO-TOPUP.md). The payment carried
// setup_future_usage=off_session + a customer (save-card opt-in, Ant 2026-07-13), so the
// PaymentIntent holds a reusable payment_method. Cards anchor to the OWNER row — the email
// identity — one card can back all of an owner's agents. Idempotent (plain UPDATE) and
// best-effort by design: a failure here must NEVER fail the credit. Called from the Stripe
// webhook AND from confirm-autotopup (whichever lands first wins; the second is a no-op rewrite).
export async function saveCardForAutotopup(
  db: D1Database,
  env: { STRIPE_SECRET_KEY?: string },
  ownerId: string,
  ids: { customerId?: string | null; piId?: string | null },
): Promise<{ saved: boolean; last4?: string | null }> {
  try {
    const customerId = ids.customerId || null;
    const piId = ids.piId || null;
    if (!customerId || !piId || !env.STRIPE_SECRET_KEY) return { saved: false };

    const auth = { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` };
    const piRes = await fetch(`https://api.stripe.com/v1/payment_intents/${piId}`, { headers: auth });
    if (!piRes.ok) return { saved: false };
    const pi = await piRes.json() as any;
    const pmId = typeof pi.payment_method === 'string' ? pi.payment_method : pi.payment_method?.id;
    if (!pmId) return { saved: false };

    let last4: string | null = null;
    const pmRes = await fetch(`https://api.stripe.com/v1/payment_methods/${pmId}`, { headers: auth });
    if (pmRes.ok) last4 = ((await pmRes.json()) as any)?.card?.last4 || null;

    await db.prepare(
      'UPDATE owners SET stripe_customer_id = ?, stripe_payment_method_id = ?, stripe_card_last4 = ? WHERE owner_id = ?'
    ).bind(customerId, pmId, last4, ownerId).run();
    return { saved: true, last4 };
  } catch (e) {
    console.error('saveCardForAutotopup failed (top-up credit unaffected):', e);
    return { saved: false };
  }
}

export async function maybeAutoTopup(
  db: D1Database,
  env: AutotopupEnv,
  agentId: string,
  // Sim-clock seam (staging fleet exercise): the 20h rate-limit claim + Stripe idempotency window
  // + wallet-low email stamping all read this. Absent (prod) = real now, behaviour unchanged.
  now: Date = new Date(),
): Promise<AutotopupResult> {
  const { sqlNow } = await import('./sim-clock');
  const nowSql = sqlNow(now);
  // PER-AGENT (step 1b): the auto-topup SETTINGS (enabled/threshold/amount) + per-charge bookkeeping
  // (last_attempt/last_status) are the AGENT's own now, alongside its balance + continuous state. Only
  // the CARD + login email stay owner-level (the person's shared instrument). So: recharge THIS agent's
  // wallet off the owner's card when THIS agent's balance falls below ITS OWN threshold.
  const agent = await db.prepare(
    `SELECT agent_id, owner_id, balance_cents, continuous_active,
            autotopup_enabled, autotopup_threshold_cents, autotopup_amount_cents,
            handle, display_name, locked_rate_cents, probes_per_day
     FROM agents WHERE agent_id = ?`
  ).bind(agentId).first() as any;
  if (!agent) return { attempted: false, reason: 'agent_not_found' };
  const ownerId = agent.owner_id;
  const owner = await db.prepare(
    'SELECT email, stripe_customer_id, stripe_payment_method_id FROM owners WHERE owner_id = ?'
  ).bind(ownerId).first() as any;

  // NOTE (2026-07-13, found by the staging fleet 14-sim-day exercise): autotopup_enabled gates the
  // CHARGE only (cardReady below), NOT the low-balance ALERT. The old early-return here made the
  // rail-split email (Ant 2026-07-02: "a crypto payer gets a LOW-BALANCE EMAIL so proof never
  // lapses unnoticed") unreachable for every crypto payer — they have no card flow, so the toggle
  // was never on, and their proof lapsed silently. The alert now runs for any low, active wallet;
  // the 20h claim below rate-limits it exactly as it rate-limits the charge.
  if ((agent.balance_cents ?? 0) >= (agent.autotopup_threshold_cents ?? 0)) {
    return { attempted: false, reason: 'above_threshold' };
  }

  // Don't recharge a wallet nobody's using (5k hardening 4): if THIS agent isn't continuously active,
  // nothing is drawing its balance down — skip the auto-charge (and the low-balance nudge).
  if (!agent.continuous_active) return { attempted: false, reason: 'not_active' };

  // ATOMIC attempt claim + rate limit — now per AGENT: at most one attempt per agent per 20h. Under
  // concurrent sweeps (double cron-fire) exactly one caller wins the claim, so neither the charge nor
  // the alert email can race into a duplicate for this agent.
  const claim = await db.prepare(
    `UPDATE agents SET autotopup_last_attempt_at = ?1
     WHERE agent_id = ?2
       AND (autotopup_last_attempt_at IS NULL OR autotopup_last_attempt_at <= datetime(?1, '-20 hours'))
     RETURNING agent_id`
  ).bind(nowSql, agentId).first();
  if (!claim) return { attempted: false, reason: 'rate_limited' };

  // RAIL SPLIT (Ant 2026-07-02): a saved card auto-recharges below; a crypto payer (no saved
  // instrument — LN/SOL can't be pulled from) gets a LOW-BALANCE EMAIL at their login address so
  // proof never lapses unnoticed. The alert doesn't need the payments master switch — it charges
  // nothing.
  // The CHARGE requires the owner's explicit toggle; the alert (else-branch) does not.
  const cardReady = agent.autotopup_enabled && owner.stripe_customer_id && owner.stripe_payment_method_id
    && env.STRIPE_SECRET_KEY && (await paymentsEnabledDb(env, db));
  if (!cardReady) {
    const to = (owner.email || '').includes('@') ? owner.email : null; // skip agent:<id> sentinels
    if (!to || !env.RESEND_API_KEY) {
      await db.prepare('UPDATE agents SET autotopup_last_status = ? WHERE agent_id = ?')
        .bind('skipped: no_saved_card_no_email', agentId).run();
      return { attempted: false, reason: 'no_saved_card' };
    }
    // Copy from the admin-edited 'wallet-low' template. Tokens: "Atlas" → agent name (HTML-escaped —
    // untrusted), "3 days" → the agent's REAL runway at its per-challenge rate × challenges/day dial.
    const { escHtml } = await import('./email-template-loader');
    const name = escHtml(agent.display_name || agent.handle || 'your agent');
    const burn = perChallengeCents(agent.locked_rate_cents ?? FOUNDER_PRICE_CENTS) * Math.max(1, agent.probes_per_day ?? BASE_PROBES_PER_DAY);
    const runwayDays = burn > 0 ? Math.floor((agent.balance_cents ?? 0) / burn) : 0;
    const runwayLabel = `${runwayDays} day${runwayDays === 1 ? '' : 's'}`;
    const sent = await sendTemplateEmail(db, mailerFromEnv(env, now.toISOString()), 'wallet-low', {
      to,
      vars: { Atlas: name, '3 days': runwayLabel },
      ctaUrl: 'https://verigent.ai/keep-current',
    }).catch(() => ({ ok: false }));
    await db.prepare('UPDATE agents SET autotopup_last_status = ? WHERE agent_id = ?')
      .bind(sent.ok ? 'emailed' : 'failed: email', agentId).run();
    return { attempted: true, succeeded: !!sent.ok, reason: sent.ok ? 'low_balance_email' : 'email_failed' };
  }

  const amountCents = Math.max(1000, agent.autotopup_amount_cents ?? 1000); // card-rail min $10
  // Second idempotency layer at Stripe. Keyed to a rolling 20h window that MATCHES the DB claim
  // window above (5k hardening 4) — not the UTC calendar day, whose midnight rollover could hand a
  // single low-balance episode a fresh key and charge twice. Same-window duplicates return the
  // original PaymentIntent instead of charging again.
  const windowBucket = Math.floor(now.getTime() / (20 * 3600 * 1000));

  try {
    const params = new URLSearchParams();
    params.set('amount', String(amountCents));
    params.set('currency', 'usd');
    params.set('customer', owner.stripe_customer_id);
    params.set('payment_method', owner.stripe_payment_method_id);
    params.set('off_session', 'true');
    params.set('confirm', 'true');
    params.set('description', 'Verigent wallet auto top-up');
    params.set('metadata[type]', 'wallet_autotopup');
    params.set('metadata[owner_id]', ownerId);
    params.set('metadata[agent_id]', agentId);

    const res = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        // Idempotency keyed per AGENT + window: each agent's wallet recharges independently.
        'Idempotency-Key': `autotopup-${agentId}-${windowBucket}`,
      },
      body: params.toString(),
    });
    const pi = await res.json() as any;

    if (!res.ok || pi?.status !== 'succeeded') {
      const code = pi?.error?.code || pi?.error?.decline_code || pi?.status || `http_${res.status}`;
      await db.prepare('UPDATE agents SET autotopup_last_status = ? WHERE agent_id = ?')
        .bind(`failed: ${code}`, agentId).run();
      return { attempted: true, succeeded: false, reason: String(code) };
    }

    // Charge landed at Stripe. Before crediting, record + atomically CLAIM a wallet_topup_sessions row
    // keyed on the PaymentIntent id — the SAME idempotency guard the webhook uses (stripe-webhook.ts
    // applyTopupCredit). This makes the credit exactly-once even if this path re-enters (a later sweep
    // in a different 20h window, a retry): a second attempt for the same PI finds the row already
    // 'paid' and no-ops instead of double-crediting. A charged PI whose row is never flipped to 'paid'
    // is a reconciliation signal (charged-not-credited) — not silent loss (review C3 / autotopup M2).
    await db.prepare(
      "INSERT OR IGNORE INTO wallet_topup_sessions (id, owner_id, agent_id, amount_cents, plan, status) VALUES (?, ?, ?, ?, 'autotopup', 'pending')"
    ).bind(pi.id, ownerId, agentId, amountCents).run();
    const claim = await db.prepare(
      "UPDATE wallet_topup_sessions SET status = 'paid', paid_at = datetime('now') WHERE id = ? AND status != 'paid'"
    ).bind(pi.id).run();
    if (((claim.meta as any)?.changes ?? 0) === 0) {
      // Row is already 'paid'. Trust the LEDGER, not the flag (review 2026-07-09): a prior attempt could
      // have claimed 'paid' then died BEFORE crediting (charged-not-credited), and the 20h claim would
      // then block the natural retry. Only no-op if a ledger row for this PI actually exists; otherwise
      // fall through and credit — self-healing, and creditWallet stays idempotent per stripe_session_id.
      const credited = await db.prepare(
        'SELECT 1 FROM wallet_transactions WHERE stripe_session_id = ? LIMIT 1'
      ).bind(pi.id).first();
      if (credited) {
        const cur = await db.prepare('SELECT balance_cents FROM agents WHERE agent_id = ?').bind(agentId).first() as any;
        await db.prepare('UPDATE agents SET autotopup_last_status = ? WHERE agent_id = ?')
          .bind('succeeded (already credited)', agentId).run();
        return { attempted: true, succeeded: true, credited_cents: 0, balance_cents: cur?.balance_cents ?? 0 };
      }
      // else: stranded claim (paid, never credited) → fall through and credit now.
    }

    // Claim won — credit THIS agent's wallet through the normal path (atomic balance+ledger; pay-on-
    // top-up referral applies like any other card top-up).
    const { balance_cents } = await creditWallet(db, agentId, amountCents, 'topup_stripe', {
      description: `Auto top-up — balance fell below $${((agent.autotopup_threshold_cents ?? 0) / 100).toFixed(2)}`,
      stripeSessionId: pi.id,
      nowIso: nowSql,
      mailer: mailerFromEnv(env), // (5n c) email the referrer if this top-up pays a referral credit
    });
    await db.prepare('UPDATE agents SET autotopup_last_status = ? WHERE agent_id = ?')
      .bind('succeeded', agentId).run();
    return { attempted: true, succeeded: true, credited_cents: amountCents, balance_cents };
  } catch (e: any) {
    await db.prepare('UPDATE agents SET autotopup_last_status = ? WHERE agent_id = ?')
      .bind(`failed: ${e?.message || 'network'}`, agentId).run();
    return { attempted: true, succeeded: false, reason: e?.message || 'network' };
  }
}
