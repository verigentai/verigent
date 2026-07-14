// Website derive layer for the CANONICAL pricing (functions/lib/pricing.ts is the owner). Pages
// import the daily-rate cents + cohort size from here and interpolate them into copy — never a
// hand-typed ¢ literal (§2.10 one-owner-per-fact). Change the rate in pricing.ts and every page
// that quotes it updates. Mirrors src/lib/dimensions.ts / doctrine.ts / duration.ts.
export {
  FOUNDER_DAILY_CENTS,   // founding-cohort daily rate (25) — dailyRateCents(749)
  DAILY_DEBIT_CENTS,     // standard daily rate (33) — dailyRateCents(999)
  FOUNDER_COHORT_SIZE,   // first-N founding slots (500)
  daysOfVerification,    // days a balance lasts at a given daily rate — kills hardcoded "~40 days" copy
  LIGHTNING_DISCOUNT,    // crypto credit bonus — Lightning (+12%), shown on the top-up rail cards
  SOL_DISCOUNT,          // crypto credit bonus — Solana (+8%)
  MIN_TOPUP_USD_CRYPTO,  // server-enforced minimum crypto top-up ($2) — UI floor must match it
} from "../../functions/lib/pricing";
