// Node-health RUN GATE (2026-07-04 incident). We can't fairly run a verification while our
// Lightning/on-chain node is down — a REQUIRED sovereignty pillar depends on it, and a half-working
// test is worse than a clean pause (Ant). So while the node is unreachable we PAUSE run-STARTING,
// key-issuance and checkout ONLY — reports/track/retry-anchors stay up (in-flight runs finish and
// recover their anchors). This is availability/eligibility, NOT scoring.
//
// Effective state = MANUAL override (settings.maintenance_mode) THEN the live health probe:
//   'closed' → forced closed (maintenance), 'open' → forced open (ignore probe, e.g. node fine but
//   probe flaky), 'auto' / unset → follow the cached checkNodeHealth probe.

import { checkNodeHealth } from './lightning';

export interface GateEnv {
  DB: D1Database;
  CLN_API_URL?: string;
  CLN_RUNE?: string;
}

const CLOSED_MESSAGE =
  'Bitcoin infrastructure is temporarily unavailable — new runs are paused and no test keys are being ' +
  'issued right now. Nothing has been charged. This is a brief maintenance pause; please try again shortly. ' +
  'Existing runs and reports are unaffected.';

async function readMaintenanceOverride(env: GateEnv): Promise<'closed' | 'open' | 'auto'> {
  try {
    const row = (await env.DB.prepare(
      "SELECT value FROM settings WHERE key = 'maintenance_mode'"
    ).first()) as any;
    const v = row?.value;
    if (v === 'closed' || v === 'open') return v;
  } catch { /* settings table not migrated / no row → auto */ }
  return 'auto';
}

// The one gate both run-start and key-issuance call. Returns { open } — open:false means PAUSE
// (respond with `message`, do NOT charge or issue). `source` is for logging/admin visibility.
export async function runGateState(env: GateEnv): Promise<{ open: boolean; message: string; source: 'override' | 'health' | 'unconfigured' }> {
  const override = await readMaintenanceOverride(env);
  if (override === 'closed') return { open: false, message: CLOSED_MESSAGE, source: 'override' };
  if (override === 'open') return { open: true, message: '', source: 'override' };

  // AUTO — follow the live (cached) health probe. If CLN isn't configured at all, don't gate
  // (dev/preview without a node); the anchor path already degrades separately.
  if (!env.CLN_API_URL || !env.CLN_RUNE) return { open: true, message: '', source: 'unconfigured' };
  const healthy = await checkNodeHealth({ apiUrl: env.CLN_API_URL, rune: env.CLN_RUNE });
  return { open: healthy, message: healthy ? '' : CLOSED_MESSAGE, source: 'health' };
}

export { CLOSED_MESSAGE };
