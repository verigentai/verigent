// POST /api/verify/channel-inbound
// Fallback webhook: receives emails sent to verify@test.verigent.ai.
// Extracts the verification code from the subject line and matches it
// against registered codes in channel_codes table.
//
// PROF-INBOX:inbox-0004 — this IS the email-relay channel test. A real email through a real
// channel, matched on code regardless of sender, so an email-capable agent can self-prove by
// sending the code itself. (Optional v2: capture payload.from to score agent-sent vs human-relayed.)

interface Env {
  DB: D1Database;
  RESEND_WEBHOOK_SECRET?: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  // Resend inbound webhook payload has: from, to, subject, text, html, etc.
  const subject = (payload.subject || '').trim().toUpperCase();
  const textBody = (payload.text || '').trim().toUpperCase();

  // Extract code: look for 6-char alphanumeric code in subject or body
  const codePattern = /\b([A-Z0-9]{6})\b/;
  const subjectMatch = subject.match(codePattern);
  const bodyMatch = textBody.match(codePattern);
  const code = subjectMatch?.[1] || bodyMatch?.[1];

  if (!code) {
    return new Response(JSON.stringify({ ok: false, reason: 'no_code_found' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Find the run that registered this code
  try {
    const row = await env.DB.prepare(
      'SELECT run_token FROM channel_codes WHERE agent_code = ? AND user_code IS NULL'
    ).bind(code).first<{ run_token: string }>();

    if (row) {
      await env.DB.prepare(
        "UPDATE channel_codes SET user_code = ?, verified_at = datetime('now') WHERE run_token = ?"
      ).bind(code, row.run_token).run();

      return new Response(JSON.stringify({ ok: true, matched: true, run_token: row.run_token }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, matched: false, code }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ ok: false, reason: 'db_error' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
