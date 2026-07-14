// POST /api/start-verify — the single "smart" entry for /start.
// One email field routes to the right next step, with a UNIFORM 202 (no account-enumeration oracle):
//   • KNOWN owner (an `owners` row already exists) → email a 20-min magic sign-in link → /owner.
//   • NEW email (no owner)                         → issue a free test key (1/email/7d) → email it.
//
// The owner lookup is READ-ONLY on purpose — we do NOT create an owner here (an owner row is created
// when a test completes / an agent registers). So a genuine first-timer stays "new" and receives the
// free key rather than a sign-in link to an empty dashboard. Mirrors the two endpoints it replaces:
// /api/owner/request-link (sign-in) and /api/request-test-key (free key, send only on fresh issue).

import { sendNotificationEmail } from '../lib/email';
import { mailerFromEnv } from '../lib/email-send';
import { sendTemplateEmail } from '../lib/email-template-loader';
import { generateLinkToken, hashLinkToken } from '../lib/link-tokens';
import { scrubUrls } from '../lib/log-scrub';

interface Env {
  DB: D1Database;
  RESEND_API_KEY?: string;
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// The single uniform response — identical body + status for every caller (valid or not).
function accepted() {
  return Response.json(
    { status: 'sent', detail: "If that's a valid email, your next step is on its way. Check your inbox." },
    { status: 202, headers: CORS },
  );
}

function generateKey(): string {
  // CSPRNG + rejection sampling (C1, review 2026-07-09) — this key writes a `coupons` row and can mint
  // an owner session via session-from-key, so a predictable Math.random() draw was an account-takeover
  // vector (V8's PRNG is seedable/observable). Mirrors request-test-key.ts:generateCode + run.ts. Format
  // UNCHANGED: VG- + 8 chars from the 31-char alphabet.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 31 chars
  let code = 'VG-';
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bi = 0;
  while (code.length < 3 + 8) {
    if (bi >= bytes.length) { crypto.getRandomValues(bytes); bi = 0; }
    const b = bytes[bi++];
    if (b < 248) code += chars[b % 31]; // 248 = 31*8; reject 248-255 to keep the draw uniform
  }
  return code;
}

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { status: 204, headers: CORS });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let email = '';
  let ref = '';
  try {
    const body = (await request.json()) as { email?: string; ref?: string };
    email = (body?.email || '').toString().trim();
    ref = (body?.ref || '').toString().trim().slice(0, 64);
  } catch {
    return accepted();
  }

  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  if (!emailValid) return accepted();
  const normalised = email.toLowerCase();

  // Everything below is best-effort — the response is already decided (uniform 202), so no branch
  // here can change the status or surface an error to the caller.
  try {
    const owner = await env.DB.prepare('SELECT owner_id FROM owners WHERE email = ?')
      .bind(normalised)
      .first<{ owner_id: string }>();

    if (owner) {
      // RETURNING → owner sign-in magic link (mirrors /api/owner/request-link).
      // Raw token rides the email only; the DB keeps sha256(token) (POST-LAUNCH #17).
      const token = generateLinkToken('oml_');
      await env.DB.prepare(
        "INSERT INTO email_verifications (email, token, purpose, expires_at) VALUES (?, ?, 'login', datetime('now', '+20 minutes'))",
      )
        .bind(normalised, await hashLinkToken(token))
        .run();

      if (env.RESEND_API_KEY) {
        await sendNotificationEmail(
          {
            to: email,
            subject: 'Your Verigent sign-in link',
            badge: 'Sign in',
            leadHtml:
              "You already have an agent verified with Verigent. Click below to sign in to your dashboard, where you can top up your wallet and set up a new test for another agent. This link expires in 20 minutes and can be used once. If you didn't request it, you can safely ignore this email.",
            ctaText: 'Sign in to Verigent',
            ctaUrl: `https://verigent.ai/api/owner/verify-link?token=${token}`,
          },
          mailerFromEnv(env),        ).catch(() => {});
      }
    } else {
      // NEW → free test key, unless one was already issued to this email in the last 7 days.
      // REPEAT REQUESTS are no longer silent (Ant hit this himself pre-launch, 2026-07-08 — "on its
      // way" screen + empty inbox = a confused first customer): an UNUSED recent key is RE-SENT
      // (idempotent — same key), a USED one gets a short honest note + support appeal.
      // ANTI-INBOX-BOMB (Ant review fix): re-send ONLY within 30 min of the key's creation. That
      // covers the genuine "I just submitted and didn't get it" case but caps an attacker looping a
      // victim's address to a 30-minute window (outside it → silent, matching the pre-today behaviour).
      // TODO(post-launch): a last_notified_at column + per-key hourly throttle restores the full
      // days-later helpfulness safely — flagged, needs a coupons migration.
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const recent = await env.DB.prepare(
        "SELECT code, uses_used, expires_at, created_at FROM coupons WHERE email = ? AND tier = 'benchmark-1' AND created_at >= ? ORDER BY created_at DESC LIMIT 1",
      )
        .bind(normalised, sevenDaysAgo)
        .first<{ code: string; uses_used: number; expires_at: string; created_at: string }>();

      const withinResendWindow = recent
        && Date.now() - new Date(recent.created_at.replace(' ', 'T') + (recent.created_at.includes('Z') ? '' : 'Z')).getTime() < 30 * 60 * 1000;

      if (recent && withinResendWindow && env.RESEND_API_KEY) {
        const stillValid = recent.uses_used === 0 && new Date(recent.expires_at).getTime() > Date.now();
        if (stillValid) {
          // Re-send the SAME key (it may have gone to spam / been deleted).
          await sendNotificationEmail(
            {
              to: email,
              subject: 'Your Verigent test key (re-sent)',
              badge: 'Test key',
              leadHtml: `Here's your free test key again: <strong>${recent.code}</strong>. It's the same key we issued earlier — one use, valid until it expires. Tell your agent: <em>"Get verified at verigent.ai — read verigent.ai/agents.txt. Test key: ${recent.code}."</em>`,
              ctaText: 'Start your test',
              ctaUrl: `https://verigent.ai/start?key=${recent.code}&email=${encodeURIComponent(email)}`,
            },
            mailerFromEnv(env),          ).catch(() => {});
        } else {
          // Key already used (or expired): say so honestly — report + wallet path, no new free key.
          await sendNotificationEmail(
            {
              to: email,
              subject: 'Your free test has been used this week',
              badge: 'Test key',
              leadHtml: `This email's free test has already been ${recent.uses_used > 0 ? 'used' : 'issued'} in the past 7 days — free tests are one per email per week. If your agent already ran its test, its report is live on its agent page. Want to keep testing continuously? A small prepaid wallet does it — top up from your report's Owner Controls. Reckon you've got a genuine case for another free run — a failed run, a new agent, something we should hear? Email <a href="mailto:support@verigent.ai">support@verigent.ai</a> and a human will sort you out.`,
              ctaText: 'Sign in to see your agents',
              ctaUrl: 'https://verigent.ai/start',
            },
            mailerFromEnv(env),          ).catch(() => {});
        }
      }

      if (!recent) {
        const code = generateKey();
        const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await env.DB.prepare(
          // Free first test attests on-chain + lists in the registry (5gg, Ant-ruled) — the hook /
          // the real cert experience. includes_attestation=1.
          `INSERT INTO coupons (code, tier, uses_allowed, uses_used, includes_attestation, expires_at, note, email)
           VALUES (?, 'benchmark-1', 1, 0, 1, ?, ?, ?)`,
        )
          .bind(code, expires, `Free test key requested by ${normalised}${ref ? ` (ref:${ref})` : ''}`, normalised)
          .run();

        if (env.RESEND_API_KEY) {
          await sendNotificationEmail(
            {
              to: email,
              subject: 'Your Verigent test key',
              badge: 'Test key',
              leadHtml: `Your free test key is <strong>${code}</strong>. It's valid for 24 hours and can be used once. Click below to start your test — paste the prompt into a fresh agent session — or tell your agent directly: <em>"Get verified at verigent.ai — read verigent.ai/agents.txt. Test key: ${code}."</em>`,
              ctaText: 'Start your test',
              // carry email (pre-fills the verification-email step) + ref (keeps the referral bound
              // through the round-trip) so the referrer is credited without the referee re-entering it.
              ctaUrl: `https://verigent.ai/start?key=${code}&email=${encodeURIComponent(email)}${ref ? `&ref=${encodeURIComponent(ref)}` : ''}`,
            },
            mailerFromEnv(env),          ).catch(() => {});
        }

        // (5n a) If this signup came through a referral link, tell the referrer someone they invited
        // just joined (credit on the way). Only fires when a NEW key is minted, so it's naturally
        // once per referee signup within the 7-day window — no repeat-spam on re-requests.
        if (ref && env.RESEND_API_KEY) {
          try {
            const referrer = await env.DB.prepare('SELECT email FROM owners WHERE referral_code = ?')
              .bind(ref).first<{ email: string | null }>();
            if (referrer?.email && referrer.email.includes('@')) {
              // 'referrer-referee-signed-up' template; token "referee@example.com" → who joined.
              await sendTemplateEmail(env.DB, mailerFromEnv(env), 'referrer-referee-signed-up', {
                to: referrer.email,
                vars: { 'referee@example.com': normalised },
                ctaUrl: 'https://verigent.ai/agents',
              }).catch(() => {});
            }
          } catch { /* best-effort — never affects the uniform 202 */ }
        }
      }
    }
  } catch (e) {
    // scrubUrls: an error from the send path can embed the sign-in URL — and its ?token= — in e.message.
    console.error('start-verify best-effort failure (uniform 202 still returned):', scrubUrls(e));
  }

  return accepted();
};
