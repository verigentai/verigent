// POST /api/owner/request-link — body { email }
//
// Accountless magic-link login for OWNERS. Upserts the owner row (first-seen email → created, so
// signup IS login), mints a single-use login token, and emails a verify link. ALWAYS returns the
// SAME 202 whether or not the email/owner existed — no account-enumeration oracle. Any internal
// failure (owner upsert, email send) is swallowed AFTER the uniform response is decided, so timing
// and status never leak whether the address is known.
//
// Token: 'oml_' + 20 random bytes hex (owner-magic-link). TTL ~20 min. purpose='login' — kept
// strictly separate from the 'free_test' verification tokens so a login token can never be replayed
// as a free-test grant and vice-versa.

import { ensureOwnerByEmail } from '../../lib/wallet';
import { mailerFromEnv } from '../../lib/email-send';
import { sendNotificationEmail } from '../../lib/email';
import { generateLinkToken, hashLinkToken } from '../../lib/link-tokens';
import { scrubUrls } from '../../lib/log-scrub';

interface Env {
  DB: D1Database;
  RESEND_API_KEY?: string;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204, headers: CORS });

// The single uniform response — identical body + status for every caller.
function accepted(): Response {
  return Response.json({
    status: 'LOGIN_LINK_SENT',
    detail: 'If that email is recognised, a sign-in link is on its way. Check your inbox — the link expires in 20 minutes.',
  }, { status: 202, headers: CORS });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let email = '';
  try {
    const body = await request.json() as any;
    email = (body?.email || '').toString().trim();
  } catch {
    // Malformed body — still return the uniform 202 (don't leak parsing as a different path).
    return accepted();
  }

  // Basic shape check. An invalid address still gets the uniform 202 (no oracle) — we just skip the
  // work. Same normaliser the rest of the system uses (trim above + lower-case here).
  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  if (!emailValid) return accepted();

  const normalised = email.toLowerCase();

  // Everything below is best-effort and wrapped: the response is already decided, so no branch here
  // can change status or surface an error to the caller.
  try {
    // Rate-limit (Codex 2026-07-10): cap the number of LIVE login links per email so this endpoint
    // can't be used to spam an inbox or burn our sending reputation. The 20-min token TTL is the
    // window — at most LOGIN_LINK_CAP unexpired 'login' tokens per address at once. Over the cap → skip
    // the mint + send, but still return the SAME uniform 202 (no account/rate oracle). Best-effort: a
    // count failure falls through to normal behaviour rather than locking anyone out.
    const LOGIN_LINK_CAP = 3;
    const live = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM email_verifications WHERE email = ? AND purpose = 'login' AND expires_at > datetime('now')"
    ).bind(normalised).first() as any;
    if ((live?.n ?? 0) >= LOGIN_LINK_CAP) return accepted();

    const ownerId = await ensureOwnerByEmail(env.DB, normalised);
    if (ownerId) {
      // Raw token rides the email only; the DB keeps sha256(token) (POST-LAUNCH #17).
      const token = generateLinkToken('oml_');
      await env.DB.prepare(
        "INSERT INTO email_verifications (email, token, purpose, expires_at) VALUES (?, ?, 'login', datetime('now', '+20 minutes'))"
      ).bind(normalised, await hashLinkToken(token)).run();

      if (env.RESEND_API_KEY) {
        await sendNotificationEmail({
          to: email,
          subject: 'Your Verigent sign-in link',
          badge: 'Sign in',
          leadHtml: "Click below to sign in to your Verigent dashboard. This link expires in 20 minutes and can be used once. If you didn't request it, you can safely ignore this email.",
          ctaText: 'Sign in to Verigent',
          ctaUrl: `https://verigent.ai/api/owner/verify-link?token=${token}`,
        }, mailerFromEnv(env)).catch(() => {});
      }
    }
  } catch (e) {
    // scrubUrls: an error from the send path can embed the CTA URL — and its ?token= — in e.message.
    console.error('owner request-link best-effort failure (uniform 202 still returned):', scrubUrls(e));
  }

  return accepted();
};
