// functions/lib/billing.js — consumption-based billing rule for continuous verification.
//
// Locked with Ant 2026-06-25: bill-at-PROOF, never pay for nothing. An agent's prepaid credits
// drain ONLY for periods where the service was actually consumed — i.e. a successful check
// actually happened. A dead/quiet scheduler performs no checks, so it is NOT billed, and its cert
// ages honestly (no checks → last_certified_at stops advancing). This replaces the old flat
// daily debit that drained whether or not anything was tested.
//
// Pure + unit-tested so the money path can be verified without a live D1.

// `lastCertifiedAt` advances ONLY on a real successful check (administered probe or MCP-pull
// finish) — billing must NOT touch it. `lastBilledAt` is the billing clock. Bill this period iff a
// check refreshed the cert AFTER the last bill (the service was consumed since we last charged).
export function consumptionBillable(lastCertifiedAt, lastBilledAt) {
  if (!lastCertifiedAt) return false;           // never verified → nothing consumed → don't bill
  if (!lastBilledAt) return true;               // has a check, never billed → bill the first period
  return new Date(lastCertifiedAt).getTime() > new Date(lastBilledAt).getTime();
}

// PER-CHALLENGE DEBIT gate (Ant ruling 2026-07-08 — billing moved from the daily sweep to
// probe/finish). A challenge is billable iff it was actually SCORED (a `pending` first-pull has no
// proof — proof-or-zero applies to our own charging too), the agent is outside any free window
// (72h trial / 7d referral), it isn't a Verigent-run public baseline (we absorb those), and the
// payments master switch is ON. Pure so the money decision is unit-testable without a live D1.
import { inFreeWeek } from './churn-levers.js';

export function challengeDebitBillable({ pending, freeUntil, isPublicBaseline, paymentsEnabled, nowIso }) {
  if (!paymentsEnabled) return false;
  if (pending) return false;
  if (isPublicBaseline) return false;
  // Reuse the one free-window predicate (churn-levers.inFreeWeek) so the money path can't drift from
  // the rest of the code if the boundary rule ever changes (Ant review fix — was a re-implementation).
  if (inFreeWeek(freeUntil, nowIso)) return false;
  return true;
}
