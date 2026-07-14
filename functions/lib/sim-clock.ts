// functions/lib/sim-clock.ts — the simulated clock for the staging fleet exercise
// (docs/STAGING-FLEET-SIM-SPEC.md, Layer 1).
//
// simNow(env, request) is the ONE way a time-sensitive server path reads "now". It returns the real
// clock unless ALL of the following hold:
//   1. SIM_CLOCK_ENABLED === '1'  — set ONLY in wrangler.staging.jsonc, never in prod config;
//   2. the request carries an `X-Sim-Now: <ISO>` header (the Layer-3 driver sets it per sim-day);
//   3. the bound D1 is provably the STAGING database (sim_env sentinel row — see assertStagingDb).
// Prod therefore ignores the header twice over: the var is absent, and even a misconfigured var
// hard-fails on the sentinel before any warped time can leak into real data.
//
// WHAT IS NEVER WARPED (spec rule): auth/magic-link/link-token expiry, rate-limiting of real
// callers, idempotency timestamps. Those paths simply never call simNow — do not thread it there.

export interface SimClockEnv {
  DB: D1Database;
  SIM_CLOCK_ENABLED?: string;
  [k: string]: any;
}

// Per-isolate cache: the binding's staging-or-not verdict is an immutable fact for the life of the
// isolate, so one sentinel SELECT covers all subsequent calls.
let stagingVerdict: boolean | null = null;

// Hard gate shared by the sim clock AND the email-capture rewrite (email-send.ts): the staging D1
// carries a sentinel row (`sim_env` key='env' value='staging') inserted manually on staging only —
// never by a migration, so prod can never acquire it. Missing table, missing row, or any other
// value ⇒ this is NOT the staging DB ⇒ throw. Belt-and-braces behind the env-var gate.
export async function assertStagingDb(db: D1Database): Promise<void> {
  if (stagingVerdict === true) return;
  let value: string | null = null;
  try {
    const row = await db.prepare("SELECT value FROM sim_env WHERE key = 'env'").first() as any;
    value = row?.value ?? null;
  } catch { value = null; }
  if (value !== 'staging') {
    stagingVerdict = false;
    throw new Error('sim tooling refused: D1 binding is not the staging database (sim_env sentinel absent)');
  }
  stagingVerdict = true;
}

// Test seam only — resets the per-isolate cache so a single test process can exercise both verdicts.
export function _resetStagingVerdictForTests(): void { stagingVerdict = null; }

export async function simNow(env: SimClockEnv, request: Request): Promise<Date> {
  const header = request?.headers?.get?.('X-Sim-Now');
  if (env?.SIM_CLOCK_ENABLED !== '1' || !header) return new Date();
  await assertStagingDb(env.DB);
  const d = new Date(header);
  if (isNaN(d.getTime())) throw new Error(`invalid X-Sim-Now header: ${header}`);
  return d;
}

// SQLite-format UTC timestamp ('YYYY-MM-DD HH:MM:SS') — matches what datetime('now') stores, so
// warped values compare and insert byte-identically with real ones (no 'T'-vs-space skew).
export function sqlNow(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}
