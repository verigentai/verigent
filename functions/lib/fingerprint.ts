// functions/lib/fingerprint.ts — private model fingerprint for swap detection.
//
// We store a SHA-256 hash of the certified model, NEVER the model itself. That lets us detect a
// swap (the hash changes on re-test → the cert can be flagged Stale) WITHOUT storing or revealing
// which model an agent runs. Operators keep their (often tailored) model private; we keep the
// anti-swap signal. Stored in agents.model_fingerprint_hash (schema-v18).

export async function hashModel(modelLabel: string | null | undefined): Promise<string | null> {
  const m = (modelLabel || '').trim().toLowerCase();
  if (!m) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(m));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}
