// Lightweight cron heartbeats (5v-a). Each scheduled endpoint stamps a timestamp when it fires, so
// the admin system-health panel can answer "are the crons actually running on schedule?" — a cron
// that stops firing on an empty/quiet DB otherwise leaves no trace. Stored in the existing key/value
// `settings` table (no migration); all writes/reads are best-effort and never block the cron.

const KEY = (name: string) => `cron_hb:${name}`;

export async function stampCronHeartbeat(db: D1Database, name: string): Promise<void> {
  try {
    // Single clean upsert. The prior version bound TWO params to a ONE-placeholder INSERT
    // (VALUES (?, datetime('now')) + .bind(key, '')), which threw a param-count mismatch that the
    // catch swallowed — so nothing was ever written (5v-f). One placeholder (key); value/updated_at
    // are datetime('now') literals on both insert and conflict-update.
    await db.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES (?, datetime('now'), datetime('now')) " +
      "ON CONFLICT(key) DO UPDATE SET value = datetime('now'), updated_at = datetime('now')"
    ).bind(KEY(name)).run();
  } catch { /* best-effort — a missing settings table or write error never blocks the cron */ }
}

// Returns { name: { last_fire_iso, age_hours } } for the given cron names. Missing → null age.
export async function readCronHeartbeats(
  db: D1Database, names: string[]
): Promise<Record<string, { last_fire: string | null; age_hours: number | null }>> {
  const out: Record<string, { last_fire: string | null; age_hours: number | null }> = {};
  for (const n of names) out[n] = { last_fire: null, age_hours: null };
  try {
    const rows = await db.prepare(
      `SELECT key, value, CAST((julianday('now') - julianday(value)) * 24 AS REAL) AS age_hours
       FROM settings WHERE key LIKE 'cron_hb:%'`
    ).all();
    for (const r of (rows.results || []) as any[]) {
      const name = String(r.key).slice('cron_hb:'.length);
      if (name in out) out[name] = { last_fire: r.value || null, age_hours: r.age_hours != null ? Number(r.age_hours) : null };
    }
  } catch { /* settings table not present yet — leave nulls */ }
  return out;
}
