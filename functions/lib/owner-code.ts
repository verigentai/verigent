// functions/lib/owner-code.ts — helpers for the owner code-login (request-code / verify-code).
// The code is high-entropy + short-lived + attempt-capped, so a straight SHA-256 (no per-user salt) is
// sufficient — this is a one-time token, not a password. We store only the hash and compare in
// constant time.

// Unambiguous alphabet (no 0/O/1/I/L) — 31 chars. 8 chars ≈ 39.6 bits: infeasible to guess within the
// 5-attempt cap and 10-minute TTL, while staying easy to type from an email.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 8;
export const CODE_TTL_MINUTES = 10;
export const MAX_CODE_ATTEMPTS = 5;
// Request rate limits (per rolling window) — stop inbox spam + enumeration probing.
export const REQ_WINDOW_MINUTES = 15;
export const MAX_REQ_PER_EMAIL = 3;
export const MAX_REQ_PER_IP = 8;

// CSPRNG code. Rejection-free modulo bias avoidance: 256 % 31 != 0, so reject bytes >= 248.
export function generateCode(): string {
  let out = "";
  while (out.length < CODE_LENGTH) {
    const buf = new Uint8Array(CODE_LENGTH * 2);
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < CODE_LENGTH; i++) {
      if (buf[i] >= 248) continue; // 248 = 31 * 8; drop the biased tail
      out += ALPHABET[buf[i] % ALPHABET.length];
    }
  }
  return out;
}

// Normalise a typed code the same way we generate it (upper-case, strip spaces/hyphens) so a user
// pasting "abcd-efgh" still verifies.
export function normaliseCode(input: string): string {
  return (input || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export async function hashCode(code: string): Promise<string> {
  const bytes = new TextEncoder().encode(code);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Constant-time compare of two equal-length hex strings. Length-independent early return is safe here
// (both are fixed 64-char SHA-256 hex); the loop never short-circuits on the first differing char.
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// The verify DECISION, pulled out of the handler so it can be unit-tested without a DB. Given the
// looked-up code row (or null), the SHA-256 hash of the submitted code, and now(ms), returns the
// outcome. 'invalid' also covers a decoy row (empty owner_id/hash) — non-owner rows never pass.
export type CodeRow = { owner_id: string; code_hash: string; attempts: number; expires_at: string } | null;
export type CodeVerdict = 'ok' | 'expired' | 'capped' | 'wrong' | 'invalid';
export function verifyCodeDecision(row: CodeRow, inputHash: string, nowMs: number): CodeVerdict {
  if (!row || !row.owner_id || !row.code_hash) return 'invalid';
  const iso = row.expires_at.includes('T') ? (row.expires_at.endsWith('Z') ? row.expires_at : row.expires_at + 'Z') : row.expires_at.replace(' ', 'T') + 'Z';
  const exp = Date.parse(iso);
  if (!Number.isNaN(exp) && exp <= nowMs) return 'expired';
  if (row.attempts >= MAX_CODE_ATTEMPTS) return 'capped';
  return timingSafeEqualHex(inputHash, row.code_hash) ? 'ok' : 'wrong';
}
