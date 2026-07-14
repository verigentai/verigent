// GET /api/owner/verify-link?token=oml_xxx — the link clicked from the sign-in email.
//
// Validates the login token (exists, purpose='login', not expired, not already consumed), marks it
// consumed (single-use — a replayed link is rejected), mints the ~30-day owner session, sets the
// vg_owner cookie, and 302-redirects to /owner. Mirrors verify-email.ts's expired/invalid HTML
// handling for the failure cases. Does NOT touch free_test_claims — login is orthogonal to the free
// test gate.

import { mintOwnerSession, ownerSessionCookie, verifyOwnerSession, getOwnerTokenFromCookie } from '../../lib/owner-auth';
import { ensureOwnerByEmail } from '../../lib/wallet';
import { linkTokenLookupPair } from '../../lib/link-tokens';

interface Env {
  DB: D1Database;
  OWNER_AUTH_SECRET?: string;
}

// A sign-in token is a bearer credential — keep it out of caches, referrers and back-forward stores
// (Codex 2026-07-10: token sits in the query string). Applied to every response from this route.
const SAFE_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store, max-age=0',
  'Referrer-Policy': 'no-referrer',
};

function page(title: string, message: string, status: number, extra: Record<string, string> = {}): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${title} — Verigent</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#0f0e17;
         color:#e8e6f0; display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0; }
  .card { max-width:480px; padding:40px; text-align:center; }
  h1 { font-size:22px; margin:0 0 12px; }
  p { color:#a8a4c0; line-height:1.6; }
  a { color:#22d3ee; }
  .btn { display:inline-block; margin:8px 6px; padding:10px 18px; border-radius:10px; background:#7c5cff; color:#fff; text-decoration:none; }
  .btn.ghost { background:transparent; border:1px solid #33324a; color:#a8a4c0; }
</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p>
<p><a href="https://verigent.ai">← Back to Verigent</a></p></div></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...SAFE_HEADERS, ...extra } });
}

const escAttr = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const token = new URL(request.url).searchParams.get('token') || '';
  if (!token) return page('Missing link', 'This sign-in link is incomplete. Request a new one from the sign-in page.', 400);

  // PURPOSE↔PREFIX binding (Codex 2026-07-10): a token's prefix must match its purpose, so a
  // 'login_cta' token can never be presented where an interactive 'login' is meant, and vice-versa.
  const expectedPurpose = token.startsWith('oml_') ? 'login' : token.startsWith('olc_') ? 'login_cta' : null;
  if (!expectedPurpose) return page('Invalid link', 'This sign-in link is invalid. Request a fresh one from the sign-in page.', 404);

  // Dual lookup (POST-LAUNCH #17): rows are stored as sha256(token) now; the raw leg only exists
  // for links minted before the hashing landed (short TTLs age them out within a day).
  const [tokHash, tokRaw] = await linkTokenLookupPair(token);
  const row = await env.DB.prepare(
    "SELECT id, email, consumed_at, expires_at, purpose FROM email_verifications WHERE token IN (?, ?) AND purpose = ?"
  ).bind(tokHash, tokRaw, expectedPurpose).first() as any;

  if (!row) return page('Invalid link', 'This sign-in link is invalid. Request a fresh one from the sign-in page.', 404);
  if (row.consumed_at) return page('Link already used', 'This sign-in link has already been used. Request a fresh one from the sign-in page.', 410);

  // Resolve the token's owner (created at request-link time; ensure for resilience).
  const ownerId = await ensureOwnerByEmail(env.DB, row.email);
  if (!ownerId) return page('Sign-in failed', "We couldn't complete sign-in. Please request a new link.", 500);

  // SESSION-SWAP GUARD (Codex HIGH, 2026-07-10): a forwarded/attacker-supplied CTA must NOT silently
  // replace a DIFFERENT owner's live session — otherwise the victim could act inside the sender's
  // account (e.g. top up the wrong wallet). If already signed in as someone else, require an explicit
  // confirm before switching. The token is NOT consumed here, so "Switch" still works once.
  const existingSub = await verifyOwnerSession(getOwnerTokenFromCookie(request.headers.get('Cookie')), env.OWNER_AUTH_SECRET);
  const switching = new URL(request.url).searchParams.get('switch') === '1';
  if (existingSub && existingSub !== ownerId && !switching) {
    const sep = request.url.includes('?') ? '&' : '?';
    const confirmUrl = escAttr(request.url + `${sep}switch=1`);
    return page('Switch account?',
      `You're already signed in to a different Verigent account. This link signs you in as <b>${escAttr(row.email)}</b> instead.`
      + `<br><br><a class="btn" href="${confirmUrl}">Switch to ${escAttr(row.email)}</a>`
      + `<a class="btn ghost" href="https://verigent.ai/owner">Stay signed in</a>`, 200);
  }

  // Single-use + not-expired in ONE atomic update (Codex LOW — closes the expiry TOCTOU): only the
  // call that flips a still-live, unconsumed row proceeds. A concurrent click or an expired token
  // both fail here.
  const claim = await env.DB.prepare(
    "UPDATE email_verifications SET consumed_at = datetime('now') WHERE id = ? AND consumed_at IS NULL AND expires_at > datetime('now')"
  ).bind(row.id).run();
  if (!claim?.meta?.changes) {
    return page('Link expired or used', 'This link has expired or was already used. Request a fresh sign-in link from the Verigent sign-in page.', 410);
  }

  const session = await mintOwnerSession(ownerId, env.OWNER_AUTH_SECRET);
  if (!session) return page('Sign-in unavailable', 'Sign-in is temporarily unavailable. Please try again shortly.', 503);

  // Optional post-login landing: only a same-origin absolute PATH (guard: single leading '/', never
  // '//' or '/\' or a scheme). Anything else falls back to /owner.
  const nextRaw = new URL(request.url).searchParams.get('next') || '';
  const safeNext = /^\/[^/\\]/.test(nextRaw) ? nextRaw : '/owner';

  return new Response(null, {
    status: 302,
    headers: {
      'Location': safeNext,
      'Set-Cookie': ownerSessionCookie(session),
      ...SAFE_HEADERS,
    },
  });
};
