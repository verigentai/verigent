// functions/lib/freshness.ts — soft-expiry freshness for VG certificates.
//
// A Verigent cert is never hard-voided. It carries a freshness state that decays with age,
// because an agent's identity is tied to its model + behaviour, and agentic time runs fast:
// model generations turn over every few months, so a year-old cert may be certifying an
// agent that no longer exists. The counterparty always sees the cert AND its freshness and
// decides for themselves. Re-cert is voluntary-but-incentivised (agents want the Current badge).
//
// THREE-STATE model (collapsed from five with Ant 2026-06-24): current · ageing · stale.
//   current : recently / continuously verified — the live, trustworthy state (first 3 days)
//   ageing  : days 4–14 — checks stopped, slipping; re-verify to restore
//   stale   : day 15+ — old enough that re-verification is recommended
// The day-bands below are the WHOLE dial and are surfaced as live admin knobs (Ant tunes the
// decay curve without a redeploy). A continuously-verifying agent re-certs constantly so it stays
// Current; once checks stop it ages to Ageing after 3 days, then Stale after 14.
export const CURRENT_MAX_DAYS = 3;    // days 0–3   -> current
export const AGEING_MAX_DAYS = 14;    // days 4–14  -> ageing; beyond -> stale

export type FreshnessState = 'current' | 'ageing' | 'stale';

// User-facing tones (single source of truth — badge + /api/spec read these). Traffic-light, so the
// freshness indicator stands out against the monochrome purple site.
export const TONE: Record<FreshnessState, string> = {
  current: '#22c55e',  // green
  ageing:  '#f59e0b',  // amber
  stale:   '#ef4444',  // red
};

export interface Freshness {
  state: FreshnessState;
  label: string;          // human label e.g. "Current"
  age_days: number | null;
  certified_at: string | null;
  model_changed: boolean; // current tested model differs from certified model -> forces stale
  detail: string;
  // PROVISIONAL-CURRENT (Ant 2026-07-10): the agent topped up while aged/stale and re-verification is
  // underway but not yet confirmed by a real check. state is reported 'current' so the owner sees they're
  // back on the moment they pay, but this flag drives the honest "Provisional" tag + rollover. Cleared
  // the instant a real check lands (→ true Current) or when the 24h grace expires (→ real Ageing/Stale).
  provisional?: boolean;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / 86_400_000);
}

// certifiedAt: ISO timestamp the cert was last issued (last_certified_at, COALESCE updated_at).
// currentModel/certifiedModel: optional model labels; if both present and differ, force stale.
export function computeFreshness(
  certifiedAt: string | null | undefined,
  opts: { currentModel?: string | null; certifiedModel?: string | null; now?: Date; reverifyingUntil?: string | null } = {},
): Freshness {
  const now = opts.now ?? new Date();

  // Model-change override — the honest signal. A swapped model means the certified entity
  // changed, so the cert is stale regardless of how recently it was issued.
  const modelChanged = !!(
    opts.currentModel && opts.certifiedModel &&
    opts.currentModel.trim() && opts.certifiedModel.trim() &&
    opts.currentModel.trim() !== opts.certifiedModel.trim()
  );

  if (!certifiedAt) {
    return {
      state: 'stale', label: 'Stale', age_days: null, certified_at: null,
      model_changed: modelChanged,
      detail: 'No certification date on record — re-verification recommended.',
    };
  }

  const certDate = new Date(certifiedAt);
  const ageDays = Math.max(0, daysBetween(now, certDate));

  if (modelChanged) {
    return {
      state: 'stale', label: 'Stale', age_days: ageDays, certified_at: certifiedAt,
      model_changed: true,
      detail: 'The agent is running a different model than the one certified. Re-verification required to restore freshness.',
    };
  }

  let state: FreshnessState;
  let detail: string;
  if (ageDays <= CURRENT_MAX_DAYS) {
    state = 'current';
    detail = `Verified ${ageDays} day(s) ago — current. Keep verifying to stay current.`;
  } else if (ageDays <= AGEING_MAX_DAYS) {
    state = 'ageing';
    detail = `Verified ${ageDays} day(s) ago — ageing. Re-verify to return to current.`;
  } else {
    state = 'stale';
    detail = `Verified ${ageDays} day(s) ago — past the ${AGEING_MAX_DAYS}-day window and now stale. Re-verification recommended.`;
  }

  // PROVISIONAL-CURRENT override (Ant 2026-07-10): the agent topped up while Ageing/Stale and re-
  // verification is underway within the 24h grace. Show Current so the owner sees they're back on the
  // moment they pay — but flag it Provisional (honest: no fresh check has confirmed it yet). A real
  // check clears reverifyingUntil (→ genuine Current); grace expiry lets it fall back to the true state.
  // Never overrides a model-swap stale (that early-returns above): a changed model is a hard stale a
  // top-up must not paper over.
  if ((state === 'ageing' || state === 'stale') && opts.reverifyingUntil) {
    const until = new Date(opts.reverifyingUntil);
    if (!isNaN(until.getTime()) && until.getTime() > now.getTime()) {
      return {
        state: 'current', label: 'Current', age_days: ageDays, certified_at: certifiedAt,
        model_changed: false, provisional: true,
        detail: 'Provisional — you’ve topped up and re-verification is underway. This confirms as fully Current on your agent’s next completed challenge.',
      };
    }
  }

  const label = state.charAt(0).toUpperCase() + state.slice(1);
  return { state, label, age_days: ageDays, certified_at: certifiedAt, model_changed: false, detail };
}
