// functions/lib/email-send.ts — THE single Resend choke point (docs/STAGING-FLEET-SIM-SPEC.md,
// Layer 0.3). Every outbound email in the codebase routes through deliverEmail(); no caller may
// fetch api.resend.com directly. The choke point exists so the staging fleet exercise can capture
// every send (recipient rewrite + sim_email_log) with ZERO chance of a missed path — senders take a
// Mailer object (not a bare API-key string), so a call site that skips this file fails typecheck.
//
// CAPTURE MODE (staging only): when EMAIL_CAPTURE is set (wrangler.staging.jsonc — never prod),
// every email actually delivers to that inbox with the original recipient prepended to the subject
// (`[to:owner-042@simfleet.test] …`), and the send is logged to sim_email_log so the time-warp
// assertions can query "which emails fired for whom on which sim-day" without IMAP-scraping.
// The rewrite REFUSES to run unless the D1 binding proves to be staging (sim_env sentinel —
// assertStagingDb), so a misconfigured prod deploy can never silently divert customer email.

import { assertStagingDb } from './sim-clock';

export interface Mailer {
  key: string;
  captureTo?: string | null;   // EMAIL_CAPTURE — staging-only recipient rewrite
  db?: D1Database | null;      // required when captureTo is set (guard + sim_email_log)
  simNowIso?: string | null;   // warped handlers stamp their sim-day onto captured sends
  // EMAIL_CAPTURE_LOG_ONLY=1 (staging): log to sim_email_log and SKIP the Resend call entirely.
  // The Resend key is shared with PROD — a fleet exercise sends hundreds of mails per real day
  // and busted the daily quota (found live 2026-07-13), which can block real customer email.
  // The D1 log is the assertion source; the capture inbox copy is a nicety we drop.
  logOnly?: boolean;
}

export function mailerFromEnv(
  env: { RESEND_API_KEY?: string; EMAIL_CAPTURE?: string; DB?: D1Database; [k: string]: any },
  simNowIso?: string | null,
): Mailer {
  return {
    key: env.RESEND_API_KEY || '',
    captureTo: env.EMAIL_CAPTURE || null,
    db: env.DB || null,
    simNowIso: simNowIso || null,
    logOnly: env.EMAIL_CAPTURE_LOG_ONLY === '1',
  };
}

export interface OutboundEmail {
  from: string;
  to: string[];
  subject: string;
  html?: string;
  text?: string;
  bcc?: string[];
  templateId?: string | null;  // logging hint for sim_email_log — stripped before Resend
}

export async function deliverEmail(mailer: Mailer, payload: OutboundEmail): Promise<{ ok: boolean; error?: string }> {
  if (!mailer?.key) return { ok: false, error: 'Missing email API key' };

  const { templateId, ...resendBody } = payload;
  let body: Record<string, any> = resendBody;

  if (mailer.captureTo) {
    if (!mailer.db) return { ok: false, error: 'EMAIL_CAPTURE set but no DB binding — capture guard cannot run' };
    try {
      await assertStagingDb(mailer.db);
    } catch (e: any) {
      // Fail CLOSED: if we can't prove staging, we neither rewrite NOR send — a captured-config
      // email must never reach a real recipient through the fallback.
      return { ok: false, error: `email capture refused: ${e?.message || e}` };
    }
    const originalTo = payload.to.join(', ');
    body = {
      ...body,
      to: [mailer.captureTo],
      bcc: undefined, // never leak a captured send to a real bcc inbox
      subject: `[to:${originalTo}] ${payload.subject}`,
    };
    try {
      await mailer.db.prepare(
        'INSERT INTO sim_email_log (sim_now, original_to, capture_to, subject, template_id) VALUES (?, ?, ?, ?, ?)'
      ).bind(mailer.simNowIso || null, originalTo, mailer.captureTo, payload.subject, templateId || null).run();
    } catch (e) {
      console.error('sim_email_log insert failed (send continues):', e);
    }
    // Log-only capture: the row above IS the delivery record; never touch the shared Resend quota.
    if (mailer.logOnly) return { ok: true };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${mailer.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) { const err = await res.text(); return { ok: false, error: `Resend ${res.status}: ${err.slice(0, 200)}` }; }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}
