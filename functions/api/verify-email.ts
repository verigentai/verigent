// GET /api/verify-email?token=evf_xxx — the link an agent's operator clicks to confirm their
// email before the free first test runs (anti-farming gate). Marks the email_verifications row
// verified; /api/run then lets the free test proceed for that email (once).
//
// 5jj: confirming the email IS proof of control of that address (same trust as the magic-link
// sign-in), so we ALSO establish the owner session here — the operator lands back on their report
// already recognised as owner, no separate sign-in. Idempotent owner create-or-find by the SAME
// normalised email the completion flow uses, so the session's owner_id matches the agent's once it
// registers. Mirrors owner/verify-link.ts.

import { ensureOwnerByEmail } from '../lib/wallet';
import { mintOwnerSession, ownerSessionCookie } from '../lib/owner-auth';
import { linkTokenLookupPair } from '../lib/link-tokens';

interface Env {
  DB: D1Database;
  OWNER_AUTH_SECRET?: string;
}

function page(title: string, message: string, status: number, setCookie?: string): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — Verigent</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#0f0e17;
         color:#e8e6f0; display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0; }
  .card { max-width:480px; padding:40px; text-align:center; }
  h1 { font-size:22px; margin:0 0 12px; }
  p { color:#a8a4c0; line-height:1.6; }
  a { color:#22d3ee; }
</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p>
<p><a href="https://verigent.ai">← Back to Verigent</a></p></div></body></html>`;
  const headers: Record<string, string> = { 'Content-Type': 'text/html; charset=utf-8' };
  if (setCookie) headers['Set-Cookie'] = setCookie;
  return new Response(html, { status, headers });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const token = new URL(request.url).searchParams.get('token') || '';
  if (!token) return page('Missing token', 'This verification link is incomplete. Start your free test again to get a fresh link.', 400);

  // Dual lookup (POST-LAUNCH #17): rows are stored as sha256(token) now; the raw leg only exists
  // for links minted before the hashing landed (24h TTL ages them out within a day).
  const [tokHash, tokRaw] = await linkTokenLookupPair(token);
  const row = await env.DB.prepare(
    'SELECT id, email, verified_at, expires_at FROM email_verifications WHERE token IN (?, ?)'
  ).bind(tokHash, tokRaw).first() as any;

  if (!row) return page('Invalid link', 'This verification link is invalid. Start your free test again to get a fresh one.', 404);

  const expired = await env.DB.prepare(
    "SELECT 1 AS ok FROM email_verifications WHERE token IN (?, ?) AND expires_at > datetime('now')"
  ).bind(tokHash, tokRaw).first() as any;
  if (!expired) return page('Link expired', 'This link has expired (they last 24 hours). Start your free test again to get a new one.', 410);

  // SINGLE-USE session mint (review 5kk #6): the ~30-day owner session is minted ONLY on the FIRST
  // click — the atomic verified_at claim below decides the winner. Without this, the link stayed a
  // reusable bearer credential for its 24h life: anyone it was forwarded to could collect a fresh
  // owner session. Residual (boarded): a corporate link-scanner that prefetches BEFORE the human
  // clicks wins the claim; full fix is a click-through confirm (POST), deferred.
  const claim = await env.DB.prepare(
    "UPDATE email_verifications SET verified_at = datetime('now') WHERE id = ? AND verified_at IS NULL"
  ).bind(row.id).run();
  const firstClick = (claim.meta?.changes ?? 0) > 0;

  // 5jj — the confirmed email proves control, so establish the owner session (create-or-find the
  // owner by this email, mint the ~30-day session, set vg_owner). Best-effort: verification still
  // succeeds even if the session can't be minted (e.g. secret unset), so the free test isn't blocked.
  let cookie: string | undefined;
  try {
    if (firstClick && row.email) {
      const ownerId = await ensureOwnerByEmail(env.DB, row.email);
      if (ownerId) {
        const session = await mintOwnerSession(ownerId, env.OWNER_AUTH_SECRET);
        if (session) cookie = ownerSessionCookie(session);
      }
    }
  } catch { /* best-effort — never block verification on session minting */ }

  return cookie
    ? page('Email verified ✓', "You're all set — and signed in. Head back to Verigent; your verification will run, and your report will recognise you as the owner automatically.", 200, cookie)
    : page('Email verified ✓', 'This address is confirmed — head back to Verigent to run your verification. (To manage your agents, sign in from the site with your email.)', 200);
};
