// functions/lib/link-tokens.ts — magic-link tokens hashed at rest (POST-LAUNCH #17, Codex
// 2026-07-10 MED). Sign-in and verify links ride the query string (oml_ interactive login,
// olc_ auto-login CTA, evf_ email-verify), and email_verifications used to store them PLAINTEXT —
// a DB read (backup, injection, admin console) yielded live login links. Defense-in-depth:
// the email still carries the raw token, the DB row keeps only sha256(token), and redemption
// hashes the presented token to match.
//
// Back-compat: rows minted before this landed hold the raw token, and every purpose is short-TTL
// (20 min / 24 h), so readers do ONE dual lookup — WHERE token IN (sha256(presented), presented) —
// and the plaintext leg goes dead on its own within a day of deploy. No collision risk: raw
// tokens are prefixed 44-char strings, hashes are bare 64-char hex.

export type LinkTokenPrefix = 'oml_' | 'olc_' | 'evf_';

// CSPRNG token, same shape every mint site used inline: prefix + 20 random bytes hex.
export function generateLinkToken(prefix: LinkTokenPrefix): string {
  return prefix + Array.from(crypto.getRandomValues(new Uint8Array(20)))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}

// sha256 hex — what actually lands in email_verifications.token.
export async function hashLinkToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// The pair a redemption query binds: [hash, raw] for `WHERE token IN (?, ?)` — hashed rows match
// the first leg, legacy in-flight plaintext rows the second.
//
// SECURITY: the raw leg is format-gated. Without the gate, a stolen DB value (the stored hash)
// could be presented AS the token and the raw leg would match it verbatim — quietly undoing the
// whole hash-at-rest protection. Real raw tokens are always prefixed; anything else gets the
// hash bound on BOTH legs, so a presented hash can only ever be re-hashed (and miss).
const RAW_TOKEN_SHAPE = /^(oml_|olc_|evf_)[0-9a-f]{40}$/;

export async function linkTokenLookupPair(token: string): Promise<[string, string]> {
  const hash = await hashLinkToken(token);
  return [hash, RAW_TOKEN_SHAPE.test(token) ? token : hash];
}
