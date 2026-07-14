// functions/lib/owner-auth.ts — accountless owner session: an HS256 JWT in an HttpOnly cookie.
//
// SEPARATE from admin-auth on every axis (a deliberate isolation barrier):
//   • cookie name      vg_owner        (admin is vg_admin)
//   • signing secret   env.OWNER_AUTH_SECRET   (admin is env.ADMIN_AUTH_SECRET)
//   • verify fn        verifyOwnerSession      (admin is verifyJWT)
// An owner cookie therefore can NEVER authenticate an admin endpoint and vice-versa: different name
// (each side only reads its own cookie name) AND different secret (even a hand-crafted token with
// the right claims fails the HMAC under the other secret). NEVER share a secret between the two.
//
// sub = owner_id ('own_…'). ~30-day session (locked decision: long-lived, no passwords). The secret
// is read from env at call time — NEVER hardcoded. If the secret is unset we fail CLOSED (no token
// minted, every verify returns null) rather than signing with a guessable empty key.

import { generateLinkToken, hashLinkToken } from './link-tokens';

const COOKIE_NAME = 'vg_owner';
const SESSION_DAYS = 30;
const SESSION_SECONDS = SESSION_DAYS * 24 * 3600;

function b64urlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlEncodeStr(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecodeToStr(s: string): string {
  return atob(s.replace(/-/g, '+').replace(/_/g, '/'));
}

function b64urlDecodeToBytes(s: string): Uint8Array {
  return Uint8Array.from(b64urlDecodeToStr(s), c => c.charCodeAt(0));
}

async function hmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, [usage],
  );
}

// Mint a ~30-day owner session JWT for an owner_id. Returns null if the secret is unset (fail-closed).
export async function mintOwnerSession(ownerId: string, secret: string | undefined): Promise<string | null> {
  if (!secret) return null;
  const header = b64urlEncodeStr(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64urlEncodeStr(JSON.stringify({
    sub: ownerId,
    iat: now,
    exp: now + SESSION_SECONDS,
  }));
  const key = await hmacKey(secret, 'sign');
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64urlEncode(new Uint8Array(sig))}`;
}

// Verify an owner session token. Returns the owner_id (sub) on success, null otherwise. Fails closed
// when the secret is unset. Verifies the HMAC FIRST (constant-work crypto.subtle.verify), then exp.
export async function verifyOwnerSession(token: string | null, secret: string | undefined): Promise<string | null> {
  if (!token || !secret) return null;
  try {
    const [header, payload, signature] = token.split('.');
    if (!header || !payload || !signature) return null;

    const key = await hmacKey(secret, 'verify');
    const sigBytes = b64urlDecodeToBytes(signature);
    const ok = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(`${header}.${payload}`));
    if (!ok) return null;

    const claims = JSON.parse(b64urlDecodeToStr(payload));
    // exp is REQUIRED (Codex 2026-07-10): a signed token without exp must NOT be accepted forever.
    if (typeof claims.exp !== 'number' || claims.exp < Math.floor(Date.now() / 1000)) return null;
    if (!claims.sub || typeof claims.sub !== 'string') return null;
    return claims.sub;
  } catch {
    return null;
  }
}

// Extract the vg_owner cookie value from a Cookie header. Anchored to its own name so it can never
// pick up the vg_admin cookie (the names are distinct and this regex is name-specific).
export function getOwnerTokenFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)vg_owner=([^;]+)/);
  return match ? match[1] : null;
}

// Set-Cookie value that establishes the owner session. HttpOnly (no JS access), Secure, SameSite=Lax
// (Lax so the magic-link GET redirect from the email client still presents the freshly-set cookie on
// the landing navigation), Path=/. Max-Age = ~30 days.
export function ownerSessionCookie(token: string): string {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`;
}

// Set-Cookie value that clears the owner session (logout). Same attributes, Max-Age=0.
export function clearOwnerSession(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// Auto-login CTA for LIFECYCLE emails (Ant 2026-07-10, approved). Mints a SINGLE-USE token that
// verify-link consumes to sign the owner in and land them on `next` (a same-origin path). Distinct
// purpose 'login_cta' + a longer 24h TTL (a nudge email may sit in an inbox for hours) — kept
// SEPARATE from the 20-min interactive 'login' tokens so neither's cap or TTL bleeds into the other.
// Returns null (caller omits the auto-login and uses a plain link) if the email is missing.
// SECURITY: single-use (verify-link claims consumed_at atomically), short-lived, and the only power
// it grants is what the owner already has via "email me a link" — email access already == account
// access. No cashout path (withdrawals need more). `next` is open-redirect-guarded in verify-link.
export async function mintLoginCtaUrl(
  db: D1Database, email: string, next: string, base = 'https://verigent.ai',
): Promise<string | null> {
  const normalised = (email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalised)) return null;
  try {
    // Raw token rides the emailed URL only; the DB keeps sha256(token) (POST-LAUNCH #17).
    const token = generateLinkToken('olc_');
    await db.prepare(
      "INSERT INTO email_verifications (email, token, purpose, expires_at) VALUES (?, ?, 'login_cta', datetime('now', '+24 hours'))"
    ).bind(normalised, await hashLinkToken(token)).run();
    const q = next ? `&next=${encodeURIComponent(next)}` : '';
    return `${base}/api/owner/verify-link?token=${token}${q}`;
  } catch {
    return null;   // mint failed → caller falls back to a plain (non-auto-login) link
  }
}
