// POST /api/verify/channel/:run_token
// Channel reach: agent sends a code to the user, user emails it to verify@test.verigent.ai,
// Cloudflare Email Worker writes the code to D1. This endpoint checks if the code arrived.
// Also accepts POST from the agent to register the code it sent.

import { type Env, json, options, logProof } from '../../../lib/verify-helpers';
import { mailerFromEnv } from '../../../lib/email-send';
import { sendChannelVerifyEmail } from '../../../lib/email';

export const onRequestOptions: PagesFunction = async () => options();

// Agent calls POST to register the code it delivered to the user
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const runToken = context.params.run_token as string;
  const { request, env } = context;

  let body: any = {};
  try { body = await request.json(); } catch {}

  if (!body.code || typeof body.code !== 'string') {
    return json({ ok: false, error: 'Missing code field' }, 400);
  }

  await logProof(env.DB, runToken, 'channel_code_registered', {
    code: body.code,
  }, request);

  try {
    await env.DB.prepare(
      `INSERT INTO channel_codes (run_token, agent_code, registered_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(run_token) DO UPDATE SET agent_code = ?, registered_at = datetime('now')`,
    ).bind(runToken, body.code, body.code).run();
  } catch {
    // Table may not exist yet
  }

  // Send styled verification email to the user with a mailto: link
  if (env.RESEND_API_KEY) {
    try {
      const run = await env.DB.prepare(
        'SELECT email, agent_id FROM runs WHERE run_token = ?'
      ).bind(runToken).first<{ email: string | null; agent_id: string }>();

      const email = run?.email;
      if (!email && run?.agent_id) {
        const agent = await env.DB.prepare(
          'SELECT email FROM agents WHERE agent_id = ?'
        ).bind(run.agent_id).first<{ email: string | null }>();
        if (agent?.email) {
          await sendChannelVerifyEmail({
            to: agent.email,
            code: body.code,
            agentName: run.agent_id,
          }, mailerFromEnv(env)).catch(() => {});
        }
      } else if (email) {
        const agentName = run?.agent_id || 'Your agent';
        const agent = await env.DB.prepare(
          'SELECT display_name FROM agents WHERE agent_id = ?'
        ).bind(run.agent_id).first<{ display_name: string | null }>();
        await sendChannelVerifyEmail({
          to: email,
          code: body.code,
          agentName: agent?.display_name || agentName,
        }, mailerFromEnv(env)).catch(() => {});
      }
    } catch {}
  }

  return json({
    ok: true,
    message: 'Code registered. Waiting for user to email it to verify@test.verigent.ai',
  });
};

// GET to check if the user's email has arrived with the matching code
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const runToken = context.params.run_token as string;
  const { env } = context;

  try {
    const row = await env.DB.prepare(
      `SELECT agent_code, user_code, verified_at FROM channel_codes WHERE run_token = ?`,
    ).bind(runToken).first<{ agent_code: string; user_code: string | null; verified_at: string | null }>();

    if (!row) {
      return json({ ok: true, status: 'no_code_registered', verified: false });
    }

    if (!row.user_code) {
      return json({ ok: true, status: 'awaiting_email', verified: false });
    }

    const verified = row.agent_code === row.user_code;
    return json({
      ok: true,
      status: verified ? 'verified' : 'code_mismatch',
      verified,
      verified_at: row.verified_at,
    });
  } catch {
    return json({ ok: true, status: 'table_not_ready', verified: false });
  }
};
