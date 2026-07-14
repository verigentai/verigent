// functions/lib/pricing.ts — single source of truth for Verigent pricing.
//
// Every payment rail (Stripe inline, Lightning, SOL) reads from here so a price change is a
// one-line edit. Frontend display strings are updated to match by hand.
//
// LOCKED model — DAILY-WALLET continuous verification (Ant 2026-06-30). Supersedes and REPLACES the
// retired one-shot $199/$249 "benchmark" SKUs (removed 2026-07-06 along with the legacy Stripe
// checkout/payment-intent endpoints and the dormant x402 marketplace path — x402 is shelved to the
// post-launch list). A prepaid wallet drawn down daily: Founding-500 = 25¢/day locked for life;
// standard = 33¢/day. No subscription, no duration plans, no one-shot purchase.

// "$9.99" / "$0.25" style formatting from cents. (Kept general — used by /api/spec.)
export function formatUsd(cents: number): string {
  return '$' + (cents / 100).toFixed(2);
}

// ── Continuous verification pricing — the live model (reset with Ant 2026-06-22) ──
// "Price the month, derive the daily debit." $9.99/mo is the anchor and the source of truth.
// We bill once per day in whole cents (D1 balances are integers, so no sub-cent per-check
// debits) — the per-day amount is MONTHLY_PRICE_CENTS / 30 rounded to the nearest cent.
export const MONTHLY_PRICE_CENTS = 999;          // $9.99/mo — the anchor price
export const BILLING_DAYS_PER_MONTH = 30;
// 999 / 30 = 33.3 → 33¢/day. Actual month lands ~$9.90–$10.23 by month length; "$9.99" is the anchor.
export const DAILY_DEBIT_CENTS = Math.round(MONTHLY_PRICE_CENTS / BILLING_DAYS_PER_MONTH); // 33
// Back-compat alias — wallet/continuous-check bill one "check" per day at this rate.
export const CONTINUOUS_RATE_CENTS = DAILY_DEBIT_CENTS;
// DEPRECATED: early birds no longer get a cheaper RATE. They pay the same flat $9.99 (locked
// for life); their perk is a higher referral share. Kept equal for back-compat.
export const COLONY_EARLY_BIRD_RATE_CENTS = DAILY_DEBIT_CENTS;

// ── DAILY-WALLET PRICING (LOCKED 2026-06-30) — supersedes the monthly-anchor model ────────────────
// Continuous usage-billing from a prepaid wallet. The STORED canonical rate is monthly cents; the
// agent is shown — and reasons about — the DAILY rate (÷30). No subscription, no duration plans.
//   Founding 500 → 749/mo = 25¢/day, locked for life while subscribed (forfeit if stale past grace).
//   Standard (after the 500) → 999/mo = 33¢/day.
export const FOUNDER_PRICE_CENTS = 749;
export const STANDARD_PRICE_CENTS = 999;
export const FOUNDER_COHORT_SIZE = 500;
// Per-owner founder cap (decision G, Ant 2026-07-03): at most this many of one owner's agents can hold
// a founder slot — anti-whale-farming. The 6th+ agent under one owner is a normal agent at the
// standard rate. Applied alongside the global FOUNDER_COHORT_SIZE cap in the founder claim.
export const FOUNDER_MAX_PER_OWNER = 5;
// HARD per-owner AGENT cap (decision H, Ant 2026-07-03): the real control against the per-agent-free-
// test abuse vector (one email spinning up many free tests). At agent CREATION, an owner with this
// many REAL agents is blocked from creating the next — routed to support ("contact us for enquiries"),
// not an outright no. Supersedes G as the primary defence; G stays as cheap defence-in-depth.
export const MAX_AGENTS_PER_OWNER = 5;

// Daily whole-cent rate from a stored monthly rate. Founder 749→25¢, standard 999→33¢.
export function dailyRateCents(monthlyCents: number): number {
  if (!monthlyCents || BILLING_DAYS_PER_MONTH <= 0) return 0;
  return Math.round(monthlyCents / BILLING_DAYS_PER_MONTH);
}
export const FOUNDER_DAILY_CENTS = dailyRateCents(FOUNDER_PRICE_CENTS);    // 25
export const STANDARD_DAILY_CENTS = dailyRateCents(STANDARD_PRICE_CENTS);  // 33
// "~25¢/day" display string from a stored monthly rate.
export function formatDailyRate(monthlyCents: number): string {
  return `~${dailyRateCents(monthlyCents)}¢/day`;
}
// Days of verification a wallet balance buys at a given monthly rate ("~40 days on $10").
export function daysOnWallet(balanceCents: number, monthlyCents: number): number {
  const d = dailyRateCents(monthlyCents);
  return d > 0 ? Math.floor(balanceCents / d) : 0;
}

// ── PER-CHALLENGE DEBIT (Ant ruling 2026-07-08) — bill at probe/finish, not a daily batch ─────────
// Every SCORED challenge debits the agent's wallet immediately (bill-at-proof, Constitution §2.8;
// the daily sweep no longer debits). The per-challenge rate derives from the locked daily rate at
// the base cadence of 5 challenges/day: founder 25¢/day → 5¢ exact; standard 33¢/day FLOORS to 6¢
// (never round UP past the published anchor — transparency §2.6; undercharging pennies is ours to
// eat). An agent dialled to 20 challenges/day simply pays per challenge (~$1/day for a founder) —
// the drawer derives its displayed rate from this same function.
export const BASE_PROBES_PER_DAY = 5;
export function perChallengeCents(monthlyCents: number): number {
  const daily = dailyRateCents(monthlyCents);
  if (daily <= 0) return 0;
  return Math.max(1, Math.floor(daily / BASE_PROBES_PER_DAY));
}

export const LAPSE_GRACE_DAYS = 14;       // re-fund within 14d keeps the founder rate
export const FRESHNESS_GRACE_DAYS = 3;    // badge greys after 3 days stale
export const FREE_WEEK_DAYS = 7;          // referral free-week length
export const FREE_TRIAL_HOURS = 72;       // EVERY free first test arms 72h of free continuous testing (Ant ruling 2026-07-08 — "that's the product"; the post-run email has promised it since day one). Referred agents get FREE_WEEK_DAYS instead.

// ── DEPRECATED back-compat aliases (retired as the wallet/copy refactor lands; COLONY_EARLY_BIRD_RATE_CENTS
//    is already declared above) ──
export const FOUNDER_CAP = FOUNDER_COHORT_SIZE;            // 500
export const FOUNDING_PRICE_CENTS = FOUNDER_PRICE_CENTS;   // 749
export const BETA_PRICE_CENTS = FOUNDER_PRICE_CENTS;
export const BETA_ACTIVE = true;
export const FOUNDING_COHORT_OPEN = true;
export function currentPublishedPriceCents(): number { return STANDARD_PRICE_CENTS; }
export function dailyDebitForRateCents(monthlyCents: number): number { return dailyRateCents(monthlyCents); }

// On-demand Sovereignty retest (docs/SOVEREIGNTY-RETEST-SPEC.md, RULED Ant 2026-07-11): flat $2.00,
// all tiers, one-off per use. Debited at PROOF (when the retest is scored), never at purchase. This
// is the OWNER of the number (§2.10). Cap: 3 per rolling 7 days (owned in the retest endpoint).
export const SOVEREIGNTY_RETEST_FEE_CENTS = 200;
export const SOVEREIGNTY_RETEST_WEEKLY_CAP = 3;

// Crypto rail discounts — applied to the amount paid at top-up. Adoption nudge + our real
// processing savings (Stripe's 30¢ fixed fee hurts a $9.99 charge; Lightning is cheapest to us).
export const LIGHTNING_DISCOUNT = 0.12;  // 12% off — cheapest rail, deepest cut
export const SOL_DISCOUNT = 0.08;        // 8% off

export type PayRail = 'fiat' | 'lightning' | 'sol';
export function railDiscount(rail: PayRail): number {
  return rail === 'lightning' ? LIGHTNING_DISCOUNT : rail === 'sol' ? SOL_DISCOUNT : 0;
}
// Crypto rails give a CREDIT BONUS (pay $X, get $X × (1 + bonus) of verification — see
// check-payment.ts), so the EFFECTIVE monthly cost is MONTHLY / (1 + bonus).
// Lightning +12% → 999/1.12 ≈ $8.92 · Sol +8% → 999/1.08 ≈ $9.25 · fiat $9.99.
// (railDiscount returns the bonus fraction; kept the name for back-compat.)
export function monthlyPriceCents(rail: PayRail = 'fiat'): number {
  return Math.round(MONTHLY_PRICE_CENTS / (1 + railDiscount(rail)));
}

// ── REFERRAL — flat $2/mo credit per active referred agent (was a 20%/30% share). Capped so a
// referrer's credit can never take their effective cost below our ~$2/mo cost floor; any overflow is
// a status flag only, never cashable. One flat number for everyone — no founder rate premium.
export const REFERRAL_FLAT_CENTS = 200;
export const REFERRAL_COST_FLOOR_CENTS = 200;
export function maxReferralCreditCents(priceCents: number): number {
  return Math.max(0, priceCents - REFERRAL_COST_FLOOR_CENTS);
}
// DEPRECATED: rate-based referral retired. Aliases (now flat) kept until the wallet refactor lands.
export const REFERRAL_RATE = 0;
export const EARLY_BIRD_REFERRAL_RATE = 0;
export function referralPayoutCents(_isEarlyBird?: boolean): number { return REFERRAL_FLAT_CENTS; }
export const REFERRAL_PAYOUT_CENTS = REFERRAL_FLAT_CENTS;

// Trust-breach bond: a one-time $1 per paying agent into the public on-chain bond, so the bond
// grows with the network. NOT recurring. Slashed (in part) on a proven data-sale breach.
export const BOND_CONTRIBUTION_CENTS = 100;

// Minimum / maximum wallet top-up amounts. Stripe's 30¢ fixed fee makes tiny fiat top-ups
// uneconomic, so the fiat floor is higher; crypto rails have NO minimum (Ant ruling 2026-07-10):
// Lightning routes single sats, Sol transfers near-dust, and we credit whatever lands anyway — a
// displayed "$2 minimum" was neither a network truth nor an enforced one. The only functional floor
// is one challenge's cost, which the UI states as guidance.
export const MIN_TOPUP_USD_FIAT = 10;
export const MIN_TOPUP_USD_CRYPTO = 0;
export const MAX_TOPUP_USD = 500;
export const MIN_TOPUP_USD = MIN_TOPUP_USD_FIAT; // deprecated alias (fiat floor)
export function minTopupUsd(rail: PayRail = 'fiat'): number {
  return rail === 'fiat' ? MIN_TOPUP_USD_FIAT : MIN_TOPUP_USD_CRYPTO;
}

// ── Top-up = prepaid wallet credit. DAILY-WALLET model: NO duration/plan discounts — a top-up simply
// credits what you pay (plus the crypto credit bonus, LN +12% / SOL +8%). The two discount axes are
// payment rail + referral only. The single 1:1 entry below keeps creditForTopup/planCreditCents valid
// for existing callers; the entry CTA is "Start with a $10 wallet".
export interface TopupPlan {
  key: 'monthly';
  label: string;
  payCents: number;      // what the agent pays (all rails)
  creditCents: number;   // pool credited on the fiat rail (1:1; crypto bonus stacks)
  approxDays: number;    // creditCents / standard daily rate
  savingsPct: number;
}
export const TOPUP_PLANS: TopupPlan[] = [
  { key: 'monthly', label: 'Wallet top-up', payCents: 1000, creditCents: 1000, approxDays: daysOnWallet(1000, STANDARD_PRICE_CENTS), savingsPct: 0 },
];
export function getTopupPlan(key: string): TopupPlan | null {
  return TOPUP_PLANS.find(p => p.key === key) ?? null;
}
// Pool credited for a PLAN on a given rail — plan credit × (1 + crypto bonus).
export function planCreditCents(planKey: string, rail: PayRail = 'fiat'): number {
  const plan = getTopupPlan(planKey);
  if (!plan) return 0;
  return Math.round(plan.creditCents * (1 + railDiscount(rail)));
}
// Pool credited for a CUSTOM (non-plan) top-up — paid amount × (1 + crypto bonus).
export function customCreditCents(payCents: number, rail: PayRail = 'fiat'): number {
  return Math.round(payCents * (1 + railDiscount(rail)));
}
// Pool credited for ANY top-up — a named plan's discounted credit (with crypto bonus stacked), or
// for a custom amount the paid amount × (1 + crypto bonus). Single source for both payment rails.
export function creditForTopup(plan: string | null | undefined, payCents: number, rail: PayRail = 'fiat'): number {
  if (plan && plan !== 'custom' && getTopupPlan(plan)) return planCreditCents(plan, rail);
  return customCreditCents(payCents, rail);
}

// Runway helpers — day-based, since we bill once per day.
export function daysOfVerification(balanceCents: number, dailyDebitCents: number = DAILY_DEBIT_CENTS): number {
  return dailyDebitCents > 0 ? Math.floor(balanceCents / dailyDebitCents) : 0;
}
export function checksFromBalance(balanceCents: number, rateCentsPerCheck: number = DAILY_DEBIT_CENTS): number {
  return rateCentsPerCheck > 0 ? Math.floor(balanceCents / rateCentsPerCheck) : 0;
}
