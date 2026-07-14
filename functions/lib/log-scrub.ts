// functions/lib/log-scrub.ts — redact URLs from server-side error logs (Codex LOW, 2026-07-10).
//
// Payment-path fetch failures often embed the endpoint they were hitting in err.message — for the
// Solana rail that endpoint is the KEYED Helius RPC URL (the key is the query string), so logging
// the raw message re-leaks the very secret SOL_RPC_URL was moved to a Pages secret to protect.
// Client-facing responses are already generic; this closes the server-log side.

/** Error message safe for console logging: any URL (and its query/key) collapses to [url]. */
export function scrubUrls(err: unknown): string {
  const msg = (err as any)?.message ?? err ?? '';
  return String(msg).replace(/https?:\/\/[^\s"']+/g, '[url]');
}
