// functions/lib/churn-levers.js — pure decision logic for the retention levers (Ant 2026-06-28):
//   • referral free-week  — a referred agent runs continuous FREE for FREE_WEEK_DAYS.
//   • founding price-lock — Founding-500 lock the founder rate ($7.49/mo) for life; forfeited on
//                           lapse > grace or cancel, so a rejoiner re-prices at the $9.99 standard rate.
//
// Pure + unit-tested (professor/churn-levers.test.mjs) so the money path is verifiable without a
// live D1. SQL-side stamping (datetime('now','+7 days')) lives in the endpoints; these functions
// decide the NUMBERS and the booleans. Constants are passed in by the caller (from pricing.ts) so
// this file stays dependency-free, exactly like billing.js.

const DAY_MS = 86_400_000;

// Daily debit (whole cents) derived from a monthly rate. Mirrors pricing.ts DAILY_DEBIT_CENTS but
// for an arbitrary owner rate (founders 749→25¢, standard 999→33¢).
export function dailyDebitForRate(monthlyCents, daysPerMonth = 30) {
  if (!monthlyCents || daysPerMonth <= 0) return 0;
  return Math.round(monthlyCents / daysPerMonth);
}

// Is this agent inside its referral free-week right now? freeUntil null/absent → no (never granted).
export function inFreeWeek(freeUntil, nowIso) {
  if (!freeUntil) return false;
  return new Date(nowIso).getTime() < new Date(freeUntil).getTime();
}

// Resolve the monthly rate to stamp on the owner at (re)activation:
//   • first activation (no existing lock): lock the CURRENT published price passed by the caller —
//     the founder rate (749) while the Founding-500 cohort is open, else the standard rate (999).
//     Founder status (first 500) IS the cheaper locked rate + badge.
//   • re-activation WITH an existing lock: keep it — UNLESS they lapsed beyond the grace window
//     (a real walk-away or explicit cancel), in which case the lock is forfeited and they re-price
//     at the standard (rejoin) rate.
// lapsedAt null = never lapsed (continuous still rolling) → always keep the lock.
export function resolveActivationRate({
  lockedRateCents,
  lapsedAt,
  nowIso,
  publishedCents,
  standardCents,
  graceDays,
}) {
  if (lockedRateCents == null) {
    return publishedCents; // first activation → lock whatever price is published right now
  }
  if (lapsedAt) {
    const lapsedMs = new Date(nowIso).getTime() - new Date(lapsedAt).getTime();
    if (lapsedMs > graceDays * DAY_MS) return standardCents; // walked away → forfeit the lock
  }
  return lockedRateCents; // within grace → keep your locked rate
}

// Does a newly-activating owner get a Founder slot? The first `founderCap` owners to activate earn the
// Founder badge + higher referral share. Pure so the cap logic is unit-tested; the COUNT query that
// feeds `currentFounderCount` lives in the endpoint (wallet.ts).
export function isFounderSlotOpen(currentFounderCount, founderCap) {
  return (currentFounderCount ?? 0) < founderCap;
}
