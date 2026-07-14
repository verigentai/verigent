// POST /api/resend-keys — resend test key(s) to the email on file.
// Body: { email }. Looks up all active coupons for that email and resends.

// @ts-ignore — extensionless sibling resolved by the Pages bundler at runtime
import { renderEmailShell, EMAIL_COLORS } from "../lib/email";
// @ts-ignore — extensionless sibling resolved by the Pages bundler at runtime
import { deliverEmail, mailerFromEnv } from "../lib/email-send";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
function json(b, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...CORS } });
}
export function onRequestOptions() { return new Response(null, { status: 204, headers: CORS }); }

export async function onRequestPost(context) {
  const { request, env } = context;
  let data = {};
  try { data = await request.json(); } catch {}
  const email = (data.email || "").toString().trim().toLowerCase();
  if (!email || !email.includes("@")) return json({ ok: false, error: "Valid email required" }, 400);

  const coupons = await env.DB.prepare(
    `SELECT code, uses_allowed, uses_used, expires_at, tier FROM coupons
     WHERE LOWER(email) = ? AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
     ORDER BY created_at DESC`
  ).bind(email).all();

  const active = (coupons.results || []).filter(c => c.uses_used < c.uses_allowed);

  if (active.length === 0) {
    return json({ ok: true, sent: false, message: "No active keys found for this email. Check the email address or contact verify@verigent.ai." });
  }

  if (!env.RESEND_API_KEY) {
    return json({ ok: false, error: "Email service not configured" }, 500);
  }

  const C = EMAIL_COLORS;
  const keyRows = active.map(c => {
    const remaining = c.uses_allowed - c.uses_used;
    const expiresDate = c.expires_at ? new Date(c.expires_at) : null;
    const expiresStr = expiresDate
      ? `${expiresDate.getDate()} ${expiresDate.toLocaleString('en', { month: 'short' })} ${expiresDate.getFullYear()}`
      : 'No expiry';
    return `<tr>
      <td style="padding:10px 12px;color:${C.ACCENT};font-family:${C.MONO};font-size:16px;font-weight:700;letter-spacing:1px;border-top:1px solid ${C.BORDER}">${c.code}</td>
      <td style="padding:10px 12px;color:${C.TEXT};font-size:13px;text-align:center;border-top:1px solid ${C.BORDER}">${remaining} of ${c.uses_allowed}</td>
      <td style="padding:10px 12px;color:${C.MUTED};font-size:12px;text-align:right;border-top:1px solid ${C.BORDER}">${expiresStr}</td>
    </tr>`;
  }).join('');

  // Shared DARK on-brand shell (renderEmailShell → same wrap/header/footer as every other email).
  const bodyHtml = `
    <p style="margin:0 0 8px;font-size:15px;color:${C.TEXT};font-weight:600;">Your active test keys</p>
    <p style="margin:0 0 20px;font-size:13px;color:${C.MUTED};line-height:1.6;">Give any of these to your agent — or use them at <a href="https://verigent.ai/start" style="color:${C.ACCENT};text-decoration:none">verigent.ai/start</a>.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:${C.SURFACE};border:1px solid ${C.BORDER};border-radius:8px;overflow:hidden">
      <thead><tr>
        <th style="padding:9px 12px;color:${C.MUTED};font-size:11px;text-transform:uppercase;letter-spacing:1px;text-align:left">Key</th>
        <th style="padding:9px 12px;color:${C.MUTED};font-size:11px;text-transform:uppercase;letter-spacing:1px;text-align:center">Remaining</th>
        <th style="padding:9px 12px;color:${C.MUTED};font-size:11px;text-transform:uppercase;letter-spacing:1px;text-align:right">Expires</th>
      </tr></thead>
      <tbody>${keyRows}</tbody>
    </table>
    <p style="margin:20px 0 0;font-size:12px;color:${C.MUTED};">Need help? Contact <a href="mailto:verify@verigent.ai" style="color:${C.ACCENT};text-decoration:none">verify@verigent.ai</a>.</p>`;
  const html = renderEmailShell({ badge: 'Test keys', bodyHtml });

  await deliverEmail(mailerFromEnv(env), {
    from: "Verigent <verify@verigent.ai>",
    to: [email],
    subject: `Your Verigent test keys`,
    html,
    templateId: 'resend-keys',
  });

  return json({ ok: true, sent: true, count: active.length, message: `Keys sent to ${email}` });
}
