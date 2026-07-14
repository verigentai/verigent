// Free weekly-test cap + its waitlist — ONE owner for the cap value and the week boundary, shared by
// the run endpoint (where the cap bites) and request-test-key (where a human is turned away and can be
// captured). Mirrors the outage_waitlist plumbing (functions/api/node-status.ts + v35). Build-handoff
// item 1, 2026-07-07.
//
// The cap stays 20 for launch (Ant's ruling: scarcity is honest during beta; the cap is the COGS
// seatbelt, a dial reviewed against conversion data — never a spend line said out loud). Copy firewall:
// the public message is quality-control framing, never "we limit spend".

export const WEEKLY_FREE_TEST_CAP = 20;

// Monday 00:00 UTC of the current week, as YYYY-MM-DD.
export function getWeekStart(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setUTCDate(monday.getUTCDate() - diff);
  return monday.toISOString().split('T')[0];
}

type DB = { prepare: (q: string) => any };

// Free runs consumed this week (is_free = 1 since Monday 00:00 UTC).
export async function freeRunsThisWeek(db: DB): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) as count FROM runs WHERE is_free = 1 AND started_at >= ? || 'T00:00:00Z'")
    .bind(getWeekStart())
    .first();
  return (r?.count as number) ?? 0;
}

export async function freeCapReached(db: DB): Promise<boolean> {
  return (await freeRunsThisWeek(db)) >= WEEKLY_FREE_TEST_CAP;
}

// Add / re-arm an email on the waitlist. Same dedupe shape as outage_waitlist: a re-request bumps
// requested_at and clears notified_at so the next window-open notify re-fires. Best-effort — never
// block the turn-away response on the log (table may not be migrated on a fresh env).
export async function joinFreeCapWaitlist(db: DB, email: string): Promise<void> {
  try {
    await db
      .prepare(
        "INSERT INTO free_cap_waitlist (email, requested_at) VALUES (?, datetime('now')) " +
        "ON CONFLICT(email) DO UPDATE SET requested_at = excluded.requested_at, notified_at = NULL"
      )
      .bind(email.trim().toLowerCase())
      .run();
  } catch { /* table not migrated yet — never block on the log */ }
}

// Quality-control framing (copy firewall). Interpolates the cap so the number never drifts from the const.
export const FREE_CAP_MESSAGE =
  `We run ${WEEKLY_FREE_TEST_CAP} free verifications a week so every one is graded properly. ` +
  `Leave an email and we'll tell you the moment next week's window opens.`;
