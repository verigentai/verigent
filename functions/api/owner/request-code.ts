// POST /api/owner/request-code — request a one-time code to sign in as the owner of a SPECIFIC agent.
// { email, handle } → uniform 202 (identical body every time). A code is generated + emailed ONLY when
// the email is that agent's owner-of-record, and only within the request rate limits. Everything after
// the response is decided is best-effort — no branch can change the status or leak whether the email
// owns the agent. Mirrors the non-enumeration pattern of /api/start-verify.

import { sendNotificationEmail, codeChip } from '../../lib/email';
import { mailerFromEnv } from '../../lib/email-send';
import { ensureOwnerByEmail } from '../../lib/wallet';
import {
  generateCode, hashCode, CODE_TTL_MINUTES,
  REQ_WINDOW_MINUTES, MAX_REQ_PER_EMAIL, MAX_REQ_PER_IP,
} from '../../lib/owner-code';

interface Env { DB: D1Database; RESEND_API_KEY?: string; }

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// The single uniform response — byte-identical for every caller (owner, non-owner, rate-limited, bad).
function accepted(): Response {
  return Response.json(
    { status: 'sent', detail: "If that email is this agent's owner, we've sent a sign-in code. It expires in 10 minutes." },
    { status: 202, headers: CORS },
  );
}

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204, headers: CORS });

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  let email = '', handle = '';
  try {
    const b = (await request.json()) as { email?: string; handle?: string };
    email = (b?.email || '').toString().trim();
    handle = (b?.handle || '').toString().trim();
  } catch { return accepted(); }

  const normalised = email.toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalised)) return accepted();
  // TWO MODES (spec §3): handle present → AGENT-scoped ("own THIS agent"); handle absent → OWNER-scoped
  // (email-only sign-in to the directory). Both mint the same vg_owner session on verify.
  const ownerScoped = !handle;
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';

  try {
    // Request rate limits — per email + per IP within the rolling window (shared across both modes).
    const since = `-${REQ_WINDOW_MINUTES} minutes`;
    const perEmail = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM owner_login_codes WHERE email = ? AND created_at > datetime('now', ?)",
    ).bind(normalised, since).first<{ n: number }>();
    const perIp = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM owner_login_codes WHERE request_ip = ? AND created_at > datetime('now', ?)",
    ).bind(ip, since).first<{ n: number }>();
    if ((perEmail?.n ?? 0) >= MAX_REQ_PER_EMAIL || (perIp?.n ?? 0) >= MAX_REQ_PER_IP) return accepted();

    let issue = false;              // do we mint + email a real code?
    let scopedAgentId: string | null = null;
    let ownerId: string | null = null;

    if (ownerScoped) {
      // OWNER-scoped: the email IS the identity. signup == login — resolve or CREATE the owner by
      // email (same normalisation as the completion flow), then always issue. Non-enumerating by
      // construction: every valid email gets a code, so nothing leaks about who already exists.
      ownerId = await ensureOwnerByEmail(env.DB, normalised);
      issue = !!ownerId;
    } else {
      // AGENT-scoped (unchanged): is this email the OWNER-OF-RECORD of THIS agent? Only then issue;
      // otherwise a decoy row is inserted so owner/non-owner are indistinguishable.
      const agent = await env.DB.prepare(
        "SELECT agent_id, owner_id FROM agents WHERE handle = ? COLLATE NOCASE OR agent_id = ? COLLATE NOCASE",
      ).bind(handle, handle).first<{ agent_id: string; owner_id: string | null }>();
      if (!agent) return accepted(); // unknown handle — nothing to scope; still uniform
      scopedAgentId = agent.agent_id;
      let ownerEmail: string | null = null;
      if (agent.owner_id) {
        const owner = await env.DB.prepare('SELECT email FROM owners WHERE owner_id = ?')
          .bind(agent.owner_id).first<{ email: string | null }>();
        ownerEmail = owner?.email ? owner.email.trim().toLowerCase() : null;
      }
      issue = !!(ownerEmail && agent.owner_id && ownerEmail === normalised);
      ownerId = issue ? agent.owner_id : null;
    }

    // Always insert a row (drives per-IP/per-email counting). A real (issued) row carries a code_hash
    // + owner_id; a decoy carries empty owner_id/code_hash and never verifies — so an attacker can't
    // tell owner from non-owner. agent_id is NULL for the owner-scoped path.
    //
    // STAGING FIXED CODE (Ant 2026-07-13): staging captures email log-only (fleet-sim spec), so a
    // real emailed code can never be read there — sign-in would be impossible. When
    // STAGING_FIXED_LOGIN_CODE is set (wrangler.staging.jsonc, never prod) AND the D1 binding proves
    // to be the staging database (sim_env sentinel — same double gate as the sim clock), the issued
    // code is the fixed one. Everything else (hashing, TTL, attempts, rate limits, non-enumeration)
    // is unchanged. Staging also sits behind Cloudflare Access, so this is a third lock, not a first.
    let fixedCode: string | null = null;
    if (issue && (env as any).STAGING_FIXED_LOGIN_CODE) {
      try {
        const { assertStagingDb } = await import('../../lib/sim-clock');
        await assertStagingDb(env.DB);
        fixedCode = String((env as any).STAGING_FIXED_LOGIN_CODE);
      } catch { fixedCode = null; } // not provably staging → behave exactly like prod
    }
    const code = issue ? (fixedCode ?? generateCode()) : '';
    const codeHash = issue ? await hashCode(code) : '';
    await env.DB.prepare(
      "INSERT INTO owner_login_codes (email, agent_id, owner_id, code_hash, request_ip, expires_at) VALUES (?, ?, ?, ?, ?, datetime('now', ?))",
    ).bind(normalised, scopedAgentId, issue ? ownerId : '', codeHash, ip, `+${CODE_TTL_MINUTES} minutes`).run();

    if (issue && env.RESEND_API_KEY) {
      // Send OFF the response path (waitUntil) so an issuing request returns in the SAME time as a
      // non-issuing one — no timing oracle. The DB writes above already run for both.
      const mailer = mailerFromEnv(env);
      // §16.3: this is a SIGN-IN code — it authenticates YOU to manage your agents. Copy is
      // deliberately distinct from a test key (which starts an agent's run), so the two never confuse.
      const leadHtml = ownerScoped
        ? `Enter this <strong>sign-in code</strong> to sign in and manage your agents (this signs you in — it doesn't start a test):<br><br>`
          + codeChip(code)
          + `<br><br>It expires in ${CODE_TTL_MINUTES} minutes and can be used once.<br><br><strong>Didn't request this?</strong> Someone may be trying to sign in to your Verigent account. You can safely ignore this email — the code is useless to anyone without access to your inbox, and it expires shortly. <strong>Never share it with anyone</strong>, and no one from Verigent will ever ask you for it.`
        : `Enter this <strong>sign-in code</strong> on ${handle}'s report to sign in as its owner (this signs you in — it doesn't start a test):<br><br>`
          + codeChip(code)
          + `<br><br>It expires in ${CODE_TTL_MINUTES} minutes and can be used once.<br><br><strong>Didn't request this?</strong> Someone may be trying to sign in to your Verigent account. You can safely ignore this email — the code is useless to anyone without access to your inbox, and it expires shortly. <strong>Never share it with anyone</strong>, and no one from Verigent will ever ask you for it.`;
      const sendPromise = sendNotificationEmail(
        { to: email, subject: 'Your Verigent sign-in code', badge: 'Sign in', leadHtml },
        mailer,
      ).catch(() => {});
      if (typeof waitUntil === 'function') waitUntil(sendPromise); // else it runs fire-and-forget
    }
  } catch (e) {
    console.error('request-code best-effort failure (uniform 202 returned):', e);
  }

  return accepted();
};
