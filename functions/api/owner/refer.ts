// POST /api/owner/refer — a signed-in owner sends a referral invite. Body: { email } (the referee).
//
// The referrer is the AUTHENTICATED owner (vg_owner cookie), and we use THEIR owner-level
// referral_code — so the credit binds to them regardless of what the referee later types. The invite
// email carries /start?ref=<code>; when the referee signs up through it, start-verify captures the ref
// automatically (they enter nothing). This is the "flip": attribution is guaranteed for the referrer.
//
// Uniform 202 whether or not the email is deliverable (no membership oracle). 401 only when there is
// no valid owner session — this is an authenticated action from the owner's own dashboard.

import { verifyOwnerSession, getOwnerTokenFromCookie } from '../../lib/owner-auth';
import { mailerFromEnv } from '../../lib/email-send';
import { sendTemplateEmail } from '../../lib/email-template-loader';

interface Env {
  DB: D1Database;
  OWNER_AUTH_SECRET?: string;
  RESEND_API_KEY?: string;
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { status: 204, headers: CORS });

function accepted() {
  return Response.json(
    { status: 'sent', detail: "If that's a valid address, the invite is on its way." },
    { status: 202, headers: CORS },
  );
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const token = getOwnerTokenFromCookie(request.headers.get('Cookie'));
  const ownerId = await verifyOwnerSession(token, env.OWNER_AUTH_SECRET);
  if (!ownerId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Content-Type': 'application/json', ...CORS } });
  }

  let email = '';
  try {
    const body = (await request.json()) as { email?: string };
    email = (body?.email || '').toString().trim();
  } catch {
    return accepted();
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return accepted();

  // Everything below is best-effort — the response is already decided (uniform 202).
  try {
    // The referrer's own owner-level code. Mint one if this owner doesn't have it yet.
    let row = await env.DB.prepare('SELECT referral_code, email FROM owners WHERE owner_id = ?')
      .bind(ownerId).first<{ referral_code: string | null; email: string | null }>();
    const referrerEmail = row?.email || null;
    let code = row?.referral_code || null;
    if (!code) {
      const minted = 'r' + Array.from(crypto.getRandomValues(new Uint8Array(6)))
        .map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 10);
      await env.DB.prepare('UPDATE owners SET referral_code = ? WHERE owner_id = ? AND referral_code IS NULL')
        .bind(minted, ownerId).run();
      // Re-read in case a concurrent call won the UNIQUE race.
      row = await env.DB.prepare('SELECT referral_code, email FROM owners WHERE owner_id = ?')
        .bind(ownerId).first<{ referral_code: string | null; email: string | null }>();
      code = row?.referral_code || minted;
    }

    if (env.RESEND_API_KEY && code) {
      // Copy from the admin-edited 'referee-invite' template. Token: the sample literal
      // "referrer@example.com" → the real referrer address (or a neutral phrase when unknown).
      await sendTemplateEmail(env.DB, mailerFromEnv(env), 'referee-invite', {
        to: email,
        vars: { 'referrer@example.com': referrerEmail && referrerEmail.includes('@') ? referrerEmail : 'A verified owner' },
        ctaUrl: `https://verigent.ai/start?ref=${encodeURIComponent(code)}`,
      }).catch(() => {});

      // (5n b) Confirm to the SIGNED-IN referrer that their invite went out + how the credit works.
      // Separate email to the referrer's own address — doesn't affect the uniform-202 toward the referee.
      if (referrerEmail && referrerEmail.includes('@')) {
        await sendTemplateEmail(env.DB, mailerFromEnv(env), 'referrer-invite-confirmation', {
          to: referrerEmail,
          ctaUrl: 'https://verigent.ai/agents',
        }).catch(() => {});
      }
    }
  } catch (e) {
    console.error('owner refer best-effort failure (uniform 202 still returned):', e);
  }

  return accepted();
};
