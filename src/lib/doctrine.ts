// src/lib/doctrine.ts — the website's SINGLE source for Deserving Doctrine machine facts.
//
// Everything here DERIVES from the canonical backend modules (functions/lib/doctrine.ts — the ONE
// owner per constitution §2.10, pinned by CANONICAL.md + the prebuild gate — and, for the bounty's
// dollar-equivalent display, functions/lib/pricing.ts). Pages import ONLY this shim — never the
// backend modules, never a hand-typed literal. Change a bounty term / the reveal lag in the owning
// module and it flows here (and across the site) with zero edits.

export {
  REVEAL_LAG_DAYS,
  BOUNTY_STATUS,
  BOUNTY_SITE_CREDIT_MONTHS,
  BOUNTY_MINOR_CREDIT_MONTHS,
  BOUNTY_MAJOR_CREDIT_MONTHS,
  BOUNTY_CRITICAL_CREDIT_MONTHS,
  BOUNTY_CASH_CAP_PCT_REVENUE,
  CONTRIBUTE_QUESTION_CREDIT_DAYS,
  CONTRIBUTE_DIMENSION_CREDIT_DAYS,
  OTS_STATUSES,
  OTS_PROOF_PATH,
} from "../../functions/lib/doctrine";
export type { OtsStatus } from "../../functions/lib/doctrine";

// Standard monthly price — used ONLY to render the bounty's "≈ $X at today's rate" equivalents.
// Owner: functions/lib/pricing.ts (pinned by CANONICAL.md).
export { STANDARD_PRICE_CENTS } from "../../functions/lib/pricing";
