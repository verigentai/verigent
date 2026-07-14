// functions/lib/payments-flag.js — the billing MASTER SWITCH (Ant 2026-06-29).
//
// Payments stay DARK until PAYMENTS_ENABLED is explicitly "true" in the environment — even when
// live Stripe keys are fully wired. One flag flips ALL rails (Stripe + Lightning + SOL) on/off, so
// we can pre-stage every key and integration in prod and go live with a single switch, while
// keeping prod safely un-chargeable until the final go-ahead. Set PAYMENTS_ENABLED=true on staging
// (test-mode keys → no real money) to run the full flow; leave it unset on prod until launch.
export function paymentsEnabled(env) {
  return !!env && env.PAYMENTS_ENABLED === 'true';
}

// Runtime-overridable master switch. The D1 `settings.payments_enabled` row, WHEN PRESENT, wins over
// the env var — so the admin on/off button is a live kill-switch (flip billing on or off with no
// redeploy). When the row is absent (fresh deploy) or the table doesn't exist yet, we fall back to
// the PAYMENTS_ENABLED env var, so "deploy dark" still holds. Charge endpoints should await this.
export async function paymentsEnabledDb(env, db) {
  try {
    if (db) {
      const row = await db.prepare("SELECT value FROM settings WHERE key = 'payments_enabled'").first();
      if (row && row.value != null) return row.value === 'true';
    }
  } catch (e) {
    const msg = String((e && e.message) || e);
    // Only the "table not migrated yet" bootstrap case falls back to the env flag. ANY other D1
    // error (timeout, connectivity, binding) must NOT silently re-enable billing — a kill-switch
    // fails CLOSED, so an admin's OFF override can't be bypassed by a transient DB hiccup.
    if (!/no such table/i.test(msg)) return false;
  }
  return paymentsEnabled(env);
}
