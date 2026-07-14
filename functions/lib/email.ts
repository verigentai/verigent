// Verigent transactional emails:
// 1. Purchase confirmation (test key + invoice)
// 2. Run expired (test didn't complete — sent by cron sweep)
// 3. Channel verification (code + mailto: link for one-click confirm)
// 4. Test complete (VG key + scores)

// DARK-ONLY, on-brand palette (docs/DESIGN-SYSTEM.md). ONE shared shell for EVERY transactional
// email — one owner per fact, so the emails can't drift back to light/hand-rolled. Charcoal-slate
// purple canvas #2a2b37 (not black, not grey), a slightly-elevated card, sky-blue --sky accent,
// light ink text, faint hairline borders. Wordmark "Verigent" (capital V).

import { TEST_DURATION_LABEL, TEST_WINDOW_MINUTES } from './test-duration';
import { type Mailer, deliverEmail } from './email-send';

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";
const BG = '#2a2b37';          // --bg canvas (charcoal-slate purple)
const CARD = '#32333f';        // --bg-2 elevated card surface on the dark canvas
const SURFACE = '#262732';     // --well recessed data zone (code boxes, insets)
const TEXT = '#f0f1f7';        // --ink near-white headings/body
const MUTED = '#8d8fa6';       // --muted secondary text
const ACCENT = '#4f8cff';      // --sky current/live accent
const ACCENT_DIM = '#3f79e6';
const BORDER = 'rgba(255,255,255,0.10)'; // faint hairline
const DANGER = '#f0b46a';      // warm amber (readable on dark; not harsh red)
const MONO = "ui-monospace,Menlo,Consolas,'Courier New',monospace";
const DM_GUARD = '';

// The brand logo is INLINED as a base64 data URI (primary) — the absolute URL is gate-served as
// text/html to un-cookied clients (broken image in every real inbox), and many clients block remote
// images by default; inlining renders regardless. The static path is also gate-exempted (belt-and-
// braces) for the few clients (Outlook desktop) that strip data: URIs. Regenerate this literal if the
// logo asset changes: `base64 -i public/verigent-logo.png | tr -d '\n'`.
const LOGO_DATA_URI = 'data:image/png;base64,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';
// Brand HEADER BAR (§16.2): SOLID standard Verigent purple #2a2b37 (--bg) — Ant ruled 2026-07-04 no
// gradient, one consistent bar across every email. The white logo (~luma 187) reads on the dark bar;
// a hairline border-bottom delineates the header from the slightly-elevated #32333f card body. The
// logo is the shared, UNIFORM size across all emails (small/standard). NEVER a re-typed text wordmark.
// badgeColor is a light lavender so the badge also reads on the dark bar.
const GRAD = 'linear-gradient(110deg,#a99bd6 0%,#b9a8ee 52%,#9fb8e8 100%)'; // CTA fill (on dark body)
function header(badge: string, badgeColor: string = '#d7ccf5'): string {
  return `<tr><td style="padding:20px 40px;${DM_GUARD}background-color:${BG};border-bottom:1px solid ${BORDER};">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td><img src="${LOGO_DATA_URI}" height="12" alt="Verigent" style="display:block;height:12px;width:auto;border:0;" /></td>
      <td align="right"><span style="font-size:12px;color:${badgeColor};font-weight:700;text-transform:uppercase;letter-spacing:1.5px;">${badge}</span></td>
    </tr>
  </table>
</td></tr>`;
}

// Shared on-brand DARK code/key chip — inline-block so it's valid inside a leadHtml <p>. Dark inset,
// sky-blue border, light mono text. The single source of truth for how a code renders in any email
// (owner sign-in code, test key, etc.) — replaces every hand-rolled light chip.
export function codeChip(code: string): string {
  return `<span style="display:inline-block;font-family:${MONO};font-size:24px;font-weight:700;letter-spacing:5px;color:${TEXT};background:${SURFACE};border:1px solid ${ACCENT};border-radius:8px;padding:12px 22px;">${code}</span>`;
}

// THE single brand button for every email CTA — purple/lilac gradient, dark ink (§16.11). NEVER a
// sky-blue button (sky is a faint accent only). Every transactional CTA routes through here so an
// email can't drift back to the old blue button. Ant flagged email inconsistency repeatedly.
export function gradButton(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;padding:12px 28px;background:${GRAD};background-color:#b9a8ee;color:#2a2b37;font-size:14px;font-weight:700;text-decoration:none;border-radius:8px;">${label}</a>`;
}

function footer(extra: string = ''): string {
  return `<tr><td style="padding:24px 40px;border-top:1px solid ${BORDER};${DM_GUARD}background-color:${CARD};">
  ${extra}
  <p style="margin:${extra ? '12px' : '0'} 0 0;font-size:11px;color:${MUTED};">Verigent — Independent AI Agent Verification</p>
</td></tr>`;
}

function wrap(inner: string): string {
  return `<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<style>
  :root { color-scheme: dark; }
</style>
</head>
<body style="margin:0;padding:0;background-color:${BG};${DM_GUARD}font-family:${FONT};color:${TEXT};">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:${BG};${DM_GUARD}padding:40px 20px;">
<tr><td align="center" style="${DM_GUARD}background-color:${BG};">
<table width="600" cellpadding="0" cellspacing="0" style="background-color:${CARD};${DM_GUARD}border-radius:12px;overflow:hidden;border:1px solid ${BORDER};">
${inner}
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ─── EMAIL 1: PURCHASE CONFIRMATION ───

interface PurchaseEmailPayload {
  to: string;
  testKey: string;
  testKeys?: string[];
  tier: string;
  uses: number;
  amountCents: number;
  invoiceId?: string;
}

function buildPurchaseHTML(p: PurchaseEmailPayload): string {
  const amount = p.amountCents > 0 ? `USD $${(p.amountCents / 100).toFixed(2)}` : 'Free';
  const keys = p.testKeys && p.testKeys.length > 0 ? p.testKeys : [p.testKey];
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const invNum = p.invoiceId || `VG-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${p.testKey.slice(-6).toUpperCase()}`;
  return wrap(`
${header('Invoice')}

<tr><td style="padding:32px 40px 24px;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td>
        <p style="margin:0 0 2px;font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:1px;">Invoice</p>
        <p style="margin:0;font-size:14px;color:${TEXT};font-weight:600;font-family:${MONO};">${invNum}</p>
      </td>
      <td align="right">
        <p style="margin:0 0 2px;font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:1px;">Date</p>
        <p style="margin:0;font-size:14px;color:${TEXT};">${dateStr}</p>
      </td>
    </tr>
  </table>
</td></tr>

<tr><td style="padding:0 40px 24px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDER};border-radius:8px;overflow:hidden;">
    <tr style="${DM_GUARD}background-color:${SURFACE};">
      <td style="padding:10px 16px;font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:1px;font-weight:600;">Item</td>
      <td style="padding:10px 16px;font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:1px;font-weight:600;" align="center">Qty</td>
      <td style="padding:10px 16px;font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:1px;font-weight:600;" align="right">Amount</td>
    </tr>
    <tr>
      <td style="padding:14px 16px;font-size:14px;color:${TEXT};border-top:1px solid ${BORDER};">Verigent Verification Test</td>
      <td style="padding:14px 16px;font-size:14px;color:${TEXT};border-top:1px solid ${BORDER};" align="center">${p.uses}</td>
      <td style="padding:14px 16px;font-size:14px;color:${TEXT};border-top:1px solid ${BORDER};" align="right">${amount}</td>
    </tr>
    <tr style="${DM_GUARD}background-color:${SURFACE};">
      <td colspan="2" style="padding:12px 16px;font-size:14px;color:${TEXT};font-weight:700;border-top:1px solid ${BORDER};">Total</td>
      <td style="padding:12px 16px;font-size:18px;color:${TEXT};font-weight:700;border-top:1px solid ${BORDER};" align="right">${amount}</td>
    </tr>
  </table>
</td></tr>

<tr><td style="padding:0 40px 24px;">
  <p style="margin:0 0 8px;font-size:11px;color:${MUTED};font-weight:600;text-transform:uppercase;letter-spacing:1px;">Your Test Key${keys.length > 1 ? 's' : ''}</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDER};border-radius:8px;overflow:hidden;">
    ${keys.map((k, i) => `<tr${i > 0 ? ` style="border-top:1px solid ${BORDER};"` : ''}>
      <td style="padding:12px 16px;background:${SURFACE};">
        <code style="font-size:16px;color:${TEXT};font-weight:700;font-family:${MONO};letter-spacing:1px;">${k}</code>
      </td>
    </tr>`).join('')}
  </table>
  <p style="margin:8px 0 0;font-size:12px;color:${MUTED};">Each key is single-use &middot; Valid for 90 days</p>
</td></tr>

<tr><td style="padding:0 40px 24px;" align="left">
  ${gradButton('https://verigent.ai/setup', 'Set up a test now')}
  <p style="margin:12px 0 0;font-size:12px;color:${MUTED};">Copy one of your keys above, then follow the setup steps on the start page.</p>
</td></tr>

<tr><td style="padding:0 40px 24px;">
  <div style="border:1px solid ${BORDER};border-radius:8px;padding:14px 16px;${DM_GUARD}background-color:${SURFACE};">
    <p style="margin:0 0 6px;font-size:12px;font-weight:600;color:${TEXT};">If the test doesn&rsquo;t complete</p>
    <p style="margin:0;font-size:12px;color:${MUTED};line-height:1.5;">
      <strong style="color:${TEXT};">Transient errors</strong> (timeout, network) &mdash; your key stays valid. Restart immediately at no extra cost.<br>
      <strong style="color:${TEXT};">Structural errors</strong> (infrastructure bug) &mdash; email <a href="mailto:verify@verigent.ai" style="color:${ACCENT};text-decoration:none;">verify@verigent.ai</a> with your test key and we&rsquo;ll re-issue.
    </p>
  </div>
</td></tr>

${footer(`<p style="margin:0;font-size:12px;color:${MUTED};">Questions? <a href="mailto:verify@verigent.ai" style="color:${ACCENT};text-decoration:none;">verify@verigent.ai</a> &middot; verigent.ai</p>`)}
`);
}

function buildPurchasePlainText(p: PurchaseEmailPayload): string {
  const amount = p.amountCents > 0 ? `USD $${(p.amountCents / 100).toFixed(2)}` : 'Free';
  const keys = p.testKeys && p.testKeys.length > 0 ? p.testKeys : [p.testKey];
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const invNum = p.invoiceId || `VG-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${p.testKey.slice(-6).toUpperCase()}`;
  return `VERIGENT — INVOICE

Invoice: ${invNum}
Date: ${dateStr}

─────────────────────────────────
Item                         Qty    Amount
Verigent Verification Test   ${p.uses}      ${amount}
─────────────────────────────────
Total                               ${amount}

YOUR TEST KEY${keys.length > 1 ? 'S' : ''}:
${keys.map((k, i) => `  ${i + 1}. ${k}`).join('\n')}
Each key is single-use · Valid for 90 days

Set up a test: https://verigent.ai/setup
Copy one of your keys above, then follow the setup steps on the start page.

IF THE TEST DOESN'T COMPLETE:
- Transient errors (timeout, network): your key stays valid — restart at no extra cost.
- Structural errors (infrastructure bug): email verify@verigent.ai with your test key — we'll re-issue.

Questions? verify@verigent.ai · verigent.ai
Verigent — Independent AI Agent Verification
`;
}

export async function sendPurchaseEmail(p: PurchaseEmailPayload, mailer: Mailer): Promise<{ ok: boolean; error?: string }> {
  if (!p.to) return { ok: false, error: 'Missing email' };
  return deliverEmail(mailer, {
    from: 'Verigent <verify@verigent.ai>',
    to: [p.to],
    subject: p.testKeys && p.testKeys.length > 1
      ? `Verigent Invoice — ${p.testKeys.length} Test Keys`
      : `Verigent Invoice — Test Key ${p.testKey}`,
    html: buildPurchaseHTML(p),
    text: buildPurchasePlainText(p),
    templateId: 'purchase',
  });
}

// ─── ADMIN NOTIFICATION EMAIL ───

interface AdminNotificationPayload {
  subject: string;
  body: string;
}

export async function sendAdminNotificationEmail(p: AdminNotificationPayload, mailer: Mailer): Promise<{ ok: boolean; error?: string }> {
  return deliverEmail(mailer, {
    from: 'Verigent <verify@verigent.ai>',
    to: ['verify@verigent.ai'],
    subject: `[Admin] ${p.subject}`,
    text: p.body,
    templateId: 'admin-notification',
  });
}

// ─── EMAIL 2: RUN EXPIRED ───

interface RunExpiredPayload {
  to: string;
  agentName: string;
  runToken: string;
  tasksGraded: number;
  totalTasks: number;
}

function buildExpiredHTML(p: RunExpiredPayload): string {
  return wrap(`
${header('Test Incomplete', DANGER)}

<tr><td style="padding:32px 40px;">
  <p style="margin:0 0 8px;font-size:14px;color:${MUTED};">Verification for</p>
  <p style="margin:0 0 24px;font-size:20px;color:${TEXT};font-weight:600;">${p.agentName}</p>

  <table width="100%" cellpadding="0" cellspacing="0" style="background:${SURFACE};border-radius:8px;border:1px solid ${DANGER};">
    <tr><td style="padding:20px;">
      <p style="margin:0 0 8px;font-size:14px;color:${DANGER};font-weight:600;">Test did not complete</p>
      <p style="margin:0;font-size:13px;color:${TEXT};line-height:1.6;">Your agent completed <strong>${p.tasksGraded} of ${p.totalTasks}</strong> tasks before the ${TEST_WINDOW_MINUTES}-minute session window expired. This can happen if the agent disconnected, timed out, or encountered an error during the test.</p>
    </td></tr>
  </table>
</td></tr>

<tr><td style="padding:0 40px 24px;">
  <p style="margin:0 0 12px;font-size:12px;color:${MUTED};font-weight:600;text-transform:uppercase;letter-spacing:1px;">Your key is still valid</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${SURFACE};border-radius:8px;border:1px solid ${BORDER};">
    <tr><td style="padding:20px;">
      <p style="margin:0 0 8px;font-size:14px;color:${TEXT};font-weight:600;">You haven't been charged a use</p>
      <p style="margin:0;font-size:13px;color:${TEXT};line-height:1.6;">Incomplete runs don't count against your test key. Give your agent the same instruction again to retry — your key will work exactly as before.</p>
    </td></tr>
  </table>
</td></tr>

<tr><td style="padding:0 40px 24px;">
  <p style="margin:0 0 12px;font-size:12px;color:${MUTED};font-weight:600;text-transform:uppercase;letter-spacing:1px;">Tips for next time</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${SURFACE};border-radius:8px;border:1px solid ${BORDER};">
    <tr><td style="padding:16px 20px;">
      <p style="margin:0 0 8px;font-size:13px;color:${TEXT};">Make sure your agent has network access to reach verigent.ai</p>
      <p style="margin:0 0 8px;font-size:13px;color:${TEXT};">The test takes ${TEST_DURATION_LABEL} — ensure your agent's session won't time out</p>
      <p style="margin:0;font-size:13px;color:${TEXT};">Be present during the test — you may need to approve actions or reply to a verification email</p>
    </td></tr>
  </table>
</td></tr>

<tr><td style="padding:0 40px 32px;" align="left">
  ${gradButton('https://verigent.ai/setup', 'Retry your verification')}
</td></tr>

${footer(`<p style="margin:0;font-size:12px;color:${MUTED};">Need help? <a href="mailto:support@verigent.ai" style="color:${ACCENT};text-decoration:none;">support@verigent.ai</a></p>`)}
`);
}

function buildExpiredPlainText(p: RunExpiredPayload): string {
  return `VERIGENT — Test Incomplete

Verification for "${p.agentName}" did not complete.

Your agent completed ${p.tasksGraded} of ${p.totalTasks} tasks before the ${TEST_WINDOW_MINUTES}-minute session window expired.

YOUR KEY IS STILL VALID:
You haven't been charged a use. Incomplete runs don't count against your test key. Give your agent the same instruction again to retry — your key will work exactly as before.

TIPS FOR NEXT TIME:
- Make sure your agent has network access to reach verigent.ai
- The test takes ${TEST_DURATION_LABEL} — ensure your agent's session won't time out
- Be present during the test — you may need to approve actions or reply to a verification email

Retry: https://verigent.ai/setup

Need help? support@verigent.ai
Verigent — Independent AI Agent Verification
`;
}

export async function sendExpiredEmail(p: RunExpiredPayload, mailer: Mailer): Promise<{ ok: boolean; error?: string }> {
  if (!p.to) return { ok: false, error: 'Missing email' };
  return deliverEmail(mailer, {
    from: 'Verigent <verify@verigent.ai>',
    to: [p.to],
    subject: `Test incomplete — ${p.agentName} verification expired`,
    html: buildExpiredHTML(p),
    text: buildExpiredPlainText(p),
    templateId: 'run-expired',
  });
}

// ─── EMAIL 3b: DECAY NUDGE — moved to the admin-template pipeline (2026-07-08) ───
// The decay trio now sends through functions/lib/email-template-loader.ts (template ids
// 'ageing'/'stale', edited live in /email-preview). The old NUDGE_COPY block and
// sendDecayNudgeEmail were deleted with the move — decay-nudge.ts is the only caller.

// Public shell for emails that need arbitrary BODY html (e.g. a table of keys) on the shared dark
// wrapper — so they don't hand-roll their own <html>/palette and drift. Exposes the same
// header/footer/wrap as every other transactional email. Returns full HTML. `bodyHtml` is dropped
// into the padded card cell as-is (already-styled block content like a <table> is fine here).
export function renderEmailShell(opts: { badge: string; bodyHtml: string; ctaText?: string; ctaUrl?: string }): string {
  return wrap(`
${header(opts.badge)}
<tr><td style="padding:32px 40px;background-color:${CARD};">${opts.bodyHtml}</td></tr>
${opts.ctaText && opts.ctaUrl ? `<tr><td style="padding:0 40px 28px;" align="left">
  <a href="${opts.ctaUrl}" style="display:inline-block;padding:12px 28px;background:${GRAD};background-color:#b9a8ee;color:#2a2b37;font-size:14px;font-weight:700;text-decoration:none;border-radius:8px;">${opts.ctaText}</a>
</td></tr>` : ''}
${footer()}`);
}
// re-export the core palette tokens for any body html built by callers (kept in step with the shell).
export const EMAIL_COLORS = { BG, CARD, SURFACE, TEXT, MUTED, ACCENT, BORDER, MONO };

// ─── TEST-KEY EMAIL (redesign, Ant 2026-07-04) ───
// ONE clear primary action with the KEY ON THE BUTTON (kills "copy or click?"): the button label +
// the key are stacked inside the button, and its href (/start?key=…) carries the key so guided setup
// opens pre-filled. That IS the setup entry (My-Agents is not). No separate key chip — the copyable
// key still lives in the power-user paste line. Old "Two ways / 1·2" framing gone. Power-user (MCP
// paste line) is a SEPARATE, clearly-secondary call-out card. Track link is /track?key=… (below) so
// the human can watch by the key from the email whether guided or power-user. §16.3 distinction line
// ("not a sign-in code") + shared dark shell retained.
export function buildTestKeyEmailHTML(p: { code: string; guidedUrl: string; trackUrl: string; mcpPrompt: string }): string {
  // New flow (Ant 2026-07-07): the EMAIL is the process — no guided /start page. Two steps: paste the
  // KEYLESS prompt to the agent; hand over the key when the agent asks. The old guided key-on-button CTA
  // and the "Power user?" card are both removed (Ant: step everyone through the normal path). The keyless
  // prompt is the anti-injection fix — the agent vets the spec, then asks for the key, and the operator
  // handing it over IS the authorisation. Track link REMOVED here (Ant 2026-07-08): nothing to track until
  // the run begins, so tracking lives in the "test started" email instead. (trackUrl param kept for the
  // caller signature; unused here.)
  const promptBox = `<div style="font-family:${MONO};font-size:12.5px;color:#cdd6f4;background:${BG};border:1px solid ${BORDER};border-radius:8px;padding:14px 16px;line-height:1.6;">${p.mcpPrompt}</div>`;
  const body = `
  <p style="margin:0 0 24px;font-size:15px;color:${TEXT};line-height:1.6;">Three steps and your agent runs the diagnostic itself.</p>
  <p style="margin:0 0 10px;font-size:14px;font-weight:700;color:${TEXT};">1 &middot; Paste this to your agent</p>
  ${promptBox}
  <p style="margin:12px 0 28px;font-size:13px;color:${MUTED};line-height:1.6;">It reads the spec, decides if it&rsquo;s happy to run, and asks you for a key.</p>
  <p style="margin:0 0 12px;font-size:14px;font-weight:700;color:${TEXT};">2 &middot; Give it your test key when it asks</p>
  ${codeChip(p.code)}
  <p style="margin:14px 0 28px;font-size:13px;color:${MUTED};line-height:1.6;">Valid 24 hours, one use. It&rsquo;s a test key, not a sign-in code.</p>
  <p style="margin:0 0 10px;font-size:14px;font-weight:700;color:${TEXT};">3 &middot; Watch it live</p>
  <p style="margin:0 0 30px;font-size:13px;color:${MUTED};line-height:1.6;">Wait for your agent&rsquo;s &ldquo;test has started&rdquo; email, then use the link in it to watch the run live.</p>
  <p style="margin:26px 0 0;font-size:13.5px;color:${MUTED};line-height:1.6;">The full result &mdash; VG key, on-chain attestation, public registry listing &mdash; lands within about an hour, emailed when it&rsquo;s ready. All free.</p>`;
  return wrap(`${header('Test key')}
<tr><td style="padding:32px 40px;background-color:${CARD};">${body}</td></tr>
${footer()}`);
}

export async function sendTestKeyEmail(p: { to: string; code: string; guidedUrl: string; trackUrl: string; mcpPrompt: string }, mailer: Mailer): Promise<{ ok: boolean; error?: string }> {
  if (!p.to) return { ok: false, error: 'Missing email' };
  const html = buildTestKeyEmailHTML(p);
  const text = `Three steps to run your Verigent test.\n\n1. Paste this to your agent:\n${p.mcpPrompt}\n\n2. Give it your test key when it asks: ${p.code} (valid 24h, one use; not a sign-in code).\n\n3. Watch it live: wait for your agent's "test has started" email, then use the link in it to watch the run live.\n\nVerigent — Independent AI Agent Verification\n`;
  return deliverEmail(mailer, { from: 'Verigent <verify@verigent.ai>', to: [p.to], subject: 'Your Verigent test key — set up your test', html, text, templateId: 'test-key' });
}

// ─── Generic transactional notification (receipt, wallet-low, referral, tier-upgrade) ───

interface NotificationPayload {
  to: string;
  subject: string;
  badge: string;
  badgeColor?: string;
  leadHtml: string;       // the main paragraph (may contain <strong> etc.)
  ctaText?: string;
  ctaUrl?: string;
}

function buildNotificationHTML(p: NotificationPayload): string {
  return wrap(`
${header(p.badge, p.badgeColor || ACCENT)}
<tr><td style="padding:32px 40px;${DM_GUARD}background-color:${CARD};">
  <p style="margin:0;font-size:15px;color:${TEXT};line-height:1.6;">${p.leadHtml}</p>
</td></tr>
${p.ctaText && p.ctaUrl ? `<tr><td style="padding:0 40px 28px;" align="left">
  ${gradButton(p.ctaUrl, p.ctaText)}
</td></tr>` : ''}
${footer()}`);
}

export async function sendNotificationEmail(p: NotificationPayload, mailer: Mailer): Promise<{ ok: boolean; error?: string }> {
  if (!p.to) return { ok: false, error: 'Missing email' };
  return deliverEmail(mailer, {
    from: 'Verigent <verify@verigent.ai>',
    to: [p.to],
    subject: p.subject,
    html: buildNotificationHTML(p),
    text: p.leadHtml.replace(/<[^>]+>/g, '') + (p.ctaUrl ? `\n\n${p.ctaText || 'Open'}: ${p.ctaUrl}` : '') + '\n\nVerigent — Independent AI Agent Verification\n',
    templateId: 'notification',
  });
}

// ─── REFERRAL EMAILS (5n) ───
// Positive functional framing only (copy firewall). All three go to the REFERRER.

async function sendResend(to: string, subject: string, html: string, text: string, mailer: Mailer, templateId?: string): Promise<{ ok: boolean; error?: string }> {
  if (!to) return { ok: false, error: 'Missing email' };
  return deliverEmail(mailer, { from: 'Verigent <verify@verigent.ai>', to: [to], subject, html, text, templateId });
}

function proseBlock(leadHtml: string, ctaText?: string, ctaUrl?: string, note?: string): string {
  return `<tr><td style="padding:32px 40px;${DM_GUARD}background-color:${CARD};">
  <p style="margin:0;font-size:15px;color:${TEXT};line-height:1.6;">${leadHtml}</p>
</td></tr>
${ctaText && ctaUrl ? `<tr><td style="padding:0 40px 24px;" align="left">
  <a href="${ctaUrl}" style="display:inline-block;padding:12px 28px;background:${GRAD};background-color:#b9a8ee;color:#2a2b37;font-size:14px;font-weight:700;text-decoration:none;border-radius:8px;">${ctaText}</a>
</td></tr>` : ''}
${note ? `<tr><td style="padding:0 40px 24px;"><p style="margin:0;font-size:12px;color:${MUTED};line-height:1.6;">${note}</p></td></tr>` : ''}`;
}

// The referral quartet (invite / invite-confirmation / signed-up / credit-landed) and the weekly
// "Monday registry update" moved to the admin-template pipeline 2026-07-08 — sent via
// email-template-loader.ts (template ids 'referee-invite', 'referrer-invite-confirmation',
// 'referrer-referee-signed-up', 'referrer-credit-landed', 'weekly-registry'), copy edited live in
// /email-preview. Their hardcoded builders were deleted with the move.

// ─── FIRST-OF-CATEGORY SOVEREIGNTY HEADS-UP (Ant 2026-07-07) ───
// When a real-action Sovereignty challenge category fires for the FIRST time for an owner (they
// authorised Sovereignty testing in owner controls), send ONE calm, informative note — then silence
// forever (the challenge_notices ledger enforces once-ever). Positive functional framing (copy
// firewall): this is the "nothing is a surprise" promise from the free-run education section, kept.
// Categories: financial | identity | infrastructure | channel.
export type ChallengeCategory = 'financial' | 'identity' | 'infrastructure' | 'channel';

const CHALLENGE_HEADSUP_COPY: Record<ChallengeCategory, { label: string; what: string }> = {
  financial: {
    label: 'financial check',
    what: 'It made a tiny micro-payment (sats-level) from a wallet it controls, to prove genuine economic self-custody. The exact amount is always shown on your report page.',
  },
  identity: {
    label: 'identity check',
    what: 'It produced a cryptographic signature over a one-time challenge — proof it holds a key only your agent controls.',
  },
  infrastructure: {
    label: 'infrastructure check',
    what: "It answered a live check against an endpoint it runs, proving the infrastructure is really its own.",
  },
  channel: {
    label: 'channel check',
    what: 'It sent a verification email to prove it can reach you outside the test chat.',
  },
};

interface ChallengeHeadsUpPayload { to: string; agentName: string; category: ChallengeCategory; handle: string; }
export async function sendChallengeHeadsUpEmail(p: ChallengeHeadsUpPayload, mailer: Mailer): Promise<{ ok: boolean; error?: string }> {
  const c = CHALLENGE_HEADSUP_COPY[p.category];
  const url = `https://verigent.ai/agent/${p.handle}`;
  const html = wrap(`${header('Heads-up')}
${proseBlock(
  `As part of <strong>${p.agentName}</strong>'s continuous verification, its first <strong>${c.label}</strong> just ran. ${c.what} You authorised this kind of check in your owner controls, and the amounts and details are always on your report page.`,
  'See it on your report', url,
  `You'll only get this note once per kind of check — from here on it just runs quietly in the background.`,
)}
${footer()}`);
  const text = `As part of ${p.agentName}'s continuous verification, its first ${c.label} just ran. ${c.what} You authorised this kind of check in your owner controls; amounts and details are always on your report page.\n\nSee it on your report: ${url}\n\nYou'll only get this note once per kind of check — from here on it runs quietly in the background.\n\nVerigent — Independent AI Agent Verification\n`;
  return sendResend(p.to, `${p.agentName} just ran its first ${c.label}`, html, text, mailer, 'challenge-headsup');
  // (subject reads e.g. "Aria just ran its first financial check")
}

// ─── WEEKLY SCORECARD (teaser + private signed link) ───
// Per-attested-agent weekly nudge (Ant 2026-07-04). The scorecard is agent fuel the operator COPIES
// from their report page into their agent — NOT a document to view. So this email carries NO scorecard
// content and NO scorecard-page link; it just bounces the operator back to their REPORT (/agent/<handle>)
// to grab (copy) the refreshed scorecard. Keeps only the public standing as the progress hook; subject
// carries the delta so the inbox line reads as progress.

interface ScorecardEmailPayload {
  to: string;
  handle: string;
  composite: number;
  tier?: string;
  deltaLabel: string;   // e.g. "+1.38" or "—"
  reportUrl: string;    // https://verigent.ai/agent/<handle> — where the operator COPIES the scorecard
  weekLabel: string;    // e.g. "Week of 2026-07-04"
}

export async function sendScorecardEmail(p: ScorecardEmailPayload, mailer: Mailer): Promise<{ ok: boolean; error?: string }> {
  const standing = `<strong>${p.tier ? `${p.tier} · ` : ''}${p.composite.toFixed(1)}</strong>`;
  const html = wrap(`${header('Scorecard refreshed')}
${proseBlock(
  `<strong>${p.handle}</strong> stands ${standing} this week — your scorecard has just refreshed.`,
  'Open your report to copy it', p.reportUrl,
  `Your scorecard is agent-readable. Open your report, copy it, and paste it into your agent — then ask it how to improve.`,
)}
${footer()}`);
  const text = `${p.handle} stands ${p.tier ? `${p.tier} · ` : ''}${p.composite.toFixed(1)} this week — your scorecard has just refreshed.

Open your report to copy your scorecard: ${p.reportUrl}
Paste it into your agent and ask how to improve.

Verigent — Independent AI Agent Verification
`;
  const subject = `Your Verigent scorecard has refreshed — ${p.weekLabel} (${p.deltaLabel})`;
  return sendResend(p.to, subject, html, text, mailer, 'scorecard');
}

// ─── EMAIL 4: TEST STARTED ───

interface TestStartedPayload {
  to: string;
  agentName: string;
  testKey: string;
  runToken: string;
  trackToken: string;   // PUBLIC read-only watch token — the /track link uses THIS, never run_token (Codex C2/C3)
  expiresAt: string;
}

// Short "your agent just started" nudge (Ant 2026-07-04) — mainly for power users who paste-and-
// walk-away. ONE primary action: "Watch the test live →" → the run's live 7-stage tracker
// (/track?run=<token>, most direct since the run_token exists at creation). Dark brand shell.
function buildTestStartedHTML(p: TestStartedPayload): string {
  return wrap(`
${header('Test started')}
<tr><td style="padding:32px 40px;${DM_GUARD}background-color:${CARD};">
  <p style="margin:0;font-size:15px;color:${TEXT};line-height:1.6;">
    ${p.agentName ? `Your agent <strong>${p.agentName}</strong> just kicked off its` : "Your agent just kicked off its"} Verigent test — you can watch it run live.
  </p>
</td></tr>
<tr><td style="padding:0 40px 10px;">
  <p style="margin:0;font-size:12.5px;color:${MUTED};line-height:1.6;">
    Heads up: you won&rsquo;t be signed in on the live page — that&rsquo;s for your security. You&rsquo;ll log in at the end to see your full results.
  </p>
</td></tr>
<tr><td style="padding:0 40px 24px;" align="left">
  <a href="https://verigent.ai/track?t=${p.trackToken}" style="display:inline-block;padding:12px 28px;background:${GRAD};background-color:#b9a8ee;color:#2a2b37;font-size:14px;font-weight:700;text-decoration:none;border-radius:8px;">Watch the test live →</a>
</td></tr>
<tr><td style="padding:0 40px 24px;">
  <p style="margin:0;font-size:13px;color:${MUTED};line-height:1.6;">
    The full result lands in about an hour — we&rsquo;ll email it to you the moment it&rsquo;s ready. You don&rsquo;t need to do anything.
  </p>
</td></tr>
${footer()}`);
}

function buildTestStartedPlainText(p: TestStartedPayload): string {
  return `${p.agentName ? `Your agent ${p.agentName} just kicked off its` : "Your agent just kicked off its"} Verigent test — you can watch it run live.

Heads up: you won't be signed in on the live page — that's for your security. You'll log in at the end to see your full results.

Watch the test live: https://verigent.ai/track?t=${p.trackToken}

The full result lands in about an hour — we'll email it to you the moment it's ready. You don't need to do anything.

Verigent — Independent AI Agent Verification
`;
}

export async function sendTestStartedEmail(p: TestStartedPayload, mailer: Mailer): Promise<{ ok: boolean; error?: string }> {
  if (!p.to) return { ok: false, error: 'Missing email' };
  return deliverEmail(mailer, {
    from: 'Verigent <verify@verigent.ai>',
    to: [p.to],
    subject: "Your agent's test has started",
    html: buildTestStartedHTML(p),
    text: buildTestStartedPlainText(p),
    templateId: 'test-started',
  });
}

// ─── EMAIL 5: CHANNEL VERIFICATION ───

interface ChannelVerifyPayload {
  to: string;
  code: string;
  agentName: string;
}

function buildChannelVerifyHTML(p: ChannelVerifyPayload): string {
  const mailtoLink = `mailto:verify@test.verigent.ai?subject=${encodeURIComponent(p.code)}`;
  return wrap(`
${header('Channel Verification')}

<tr><td style="padding:32px 40px;">
  <p style="margin:0 0 8px;font-size:14px;color:${MUTED};">Verification code from</p>
  <p style="margin:0 0 24px;font-size:20px;color:${TEXT};font-weight:600;">${p.agentName}</p>

  <p style="margin:0 0 20px;font-size:14px;color:${TEXT};line-height:1.6;">Your agent has sent you a verification code as part of the Verigent channel reach test. To confirm you received it, just click the button below — it will open a new email with the code already filled in. Hit send and you're done.</p>

  <p style="margin:0 0 10px;font-size:11px;color:${MUTED};font-weight:600;text-transform:uppercase;letter-spacing:1px;">Verification code</p>
  ${codeChip(p.code)}
</td></tr>

<tr><td style="padding:24px 40px 32px;" align="left">
  ${gradButton(mailtoLink, 'Confirm — send verification email')}
  <p style="margin:12px 0 0;font-size:12px;color:${MUTED};">Opens your email client with the code pre-filled. Just hit send.</p>
</td></tr>

<tr><td style="padding:0 40px 24px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${SURFACE};border-radius:8px;border:1px solid ${BORDER};">
    <tr><td style="padding:16px 20px;">
      <p style="margin:0 0 8px;font-size:13px;color:${TEXT};font-weight:600;">If the button doesn't work:</p>
      <p style="margin:0 0 4px;font-size:13px;color:${MUTED};">1. Compose a new email to <strong style="color:${TEXT};">verify@test.verigent.ai</strong></p>
      <p style="margin:0 0 4px;font-size:13px;color:${MUTED};">2. Put the code <strong style="color:${TEXT};">${p.code}</strong> in the subject line</p>
      <p style="margin:0;font-size:13px;color:${MUTED};">3. Hit send — the body can be empty</p>
    </td></tr>
  </table>
</td></tr>

${footer(`<p style="margin:0;font-size:12px;color:${MUTED};">This is part of the Verigent verification test for ${p.agentName}. The code confirms your agent can reach you outside the test chat.</p>`)}
`);
}

function buildChannelVerifyPlainText(p: ChannelVerifyPayload): string {
  return `VERIGENT — Channel Verification

Your agent "${p.agentName}" has sent you a verification code as part of the Verigent channel reach test.

VERIFICATION CODE: ${p.code}

To confirm you received it, send an email to:
  verify@test.verigent.ai

Put the code ${p.code} in the subject line and hit send. The body can be empty.

This confirms your agent can reach you outside the test chat.

Verigent — Independent AI Agent Verification
`;
}

export async function sendChannelVerifyEmail(p: ChannelVerifyPayload, mailer: Mailer): Promise<{ ok: boolean; error?: string }> {
  if (!p.to) return { ok: false, error: 'Missing email' };
  return deliverEmail(mailer, {
    from: 'Verigent <verify@verigent.ai>',
    to: [p.to],
    subject: `Channel verification — confirm code ${p.code}`,
    html: buildChannelVerifyHTML(p),
    text: buildChannelVerifyPlainText(p),
    templateId: 'channel-verify',
  });
}

// ─── EMAIL 5: TEST COMPLETE ───

interface EmailPayload {
  to: string;
  agentHandle: string;
  displayName: string;
  vgCode: string;
  tier: string;
  composite: number;
  dimensionScores: Record<string, number>;
  classScores: Record<string, number>;
  primaryClass: string;
  runToken: string;
  isFree: boolean;
  // The run's one-use test key (coupons.code). When present, the "view report" CTA routes through
  // /track?key=… so the owner lands SIGNED IN (the /track page POSTs the key to
  // /api/owner/session-from-key, minting the owner session) instead of arriving as a public visitor.
  // Absent on keyless/wallet runs — those fall back to the plain /agent/<handle> link.
  couponCode?: string;
  // Free continuous window armed at completion (72h standard / 7d referred — startFreeContinuousWindow).
  // When present the email carries the probe-pull setup as TWO short copy boxes (MCP config entry +
  // grant-and-go paste — Ant 2026-07-14, de-overwhelm redesign): continuous is agent-PULL, so the
  // window is only worth anything if the agent is actually set up to pull (Ant 2026-07-08 — never
  // leave the customer hanging wondering why nothing is probing). Mechanics live in agents.txt §5f,
  // which the pasted instruction points the agent at — the email stopped being documentation.
  freeWindow?: { hours?: number; days?: number; setup_paste: string };
}

const TIER_LABELS: Record<string, string> = {
  V1: 'Verified', V2: 'Capable', V3: 'Proficient',
  V4: 'Distinguished', V5: 'Elite', V6: 'Apex',
};

function buildHTML(p: EmailPayload): string {
  const tierLabel = TIER_LABELS[p.tier] || p.tier;
  // Owner-signed-in report link: route through the one-use key so /track signs the owner in
  // (session-from-key) and shows the completed state with a "View your report →" click-through.
  // Fall back to the plain profile link when the run carried no key (wallet/keyless path).
  const reportUrl = p.couponCode
    ? `https://verigent.ai/track?key=${encodeURIComponent(p.couponCode)}`
    : `https://verigent.ai/agent/${p.agentHandle}?welcome=1`;

  return wrap(`
${header('Verification Complete')}

<tr><td style="padding:32px 40px;">
  <p style="margin:0 0 4px;font-size:14px;color:${MUTED};">Agent verified:</p>
  <p style="margin:0 0 24px;font-size:20px;color:${TEXT};font-weight:600;">${p.displayName}</p>

  <table width="100%" cellpadding="0" cellspacing="0" style="background:${SURFACE};border-radius:8px;border:1px solid ${BORDER};">
    <tr>
      <td style="padding:12px 20px;" align="center">
        <p style="margin:0 0 4px;font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:1px;">Composite</p>
        <p style="margin:0;font-size:28px;color:${TEXT};font-weight:700;">${p.composite.toFixed(1)}</p>
      </td>
      <td style="padding:12px 20px;border-left:1px solid ${BORDER};" align="center">
        <p style="margin:0 0 4px;font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:1px;">Tier</p>
        <p style="margin:0;font-size:28px;color:${TEXT};font-weight:700;">${p.tier}</p>
        <p style="margin:2px 0 0;font-size:12px;color:${MUTED};">${tierLabel}</p>
      </td>
      <td style="padding:12px 20px;border-left:1px solid ${BORDER};" align="center">
        <p style="margin:0 0 4px;font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:1px;">Class</p>
        <p style="margin:0;font-size:28px;color:${TEXT};font-weight:700;">${p.primaryClass}</p>
      </td>
    </tr>
  </table>
</td></tr>

<tr><td style="padding:0 40px 32px;" align="left">
  ${gradButton(reportUrl, 'View your full report')}
  <p style="margin:8px 0 0;font-size:12px;color:${MUTED};">Every dimension, the soft spots, and the on-chain proof.</p>
</td></tr>

${p.freeWindow ? `
<tr><td style="padding:0 40px 32px;">
  <p style="margin:0 0 8px;font-size:12px;color:${ACCENT};font-weight:700;text-transform:uppercase;letter-spacing:1px;">Your free continuous testing is on — ${p.freeWindow.days ? `${p.freeWindow.days} days` : `${p.freeWindow.hours} hours`}</p>
  <p style="margin:0 0 12px;font-size:14px;color:${TEXT};line-height:1.6;">Your agent pulls its own challenges. One paste and it takes over from there:</p>
  <div style="font-family:${MONO};font-size:12px;color:#cdd6f4;background:${BG};border:1px solid ${BORDER};border-radius:8px;padding:13px 15px;line-height:1.6;">${p.freeWindow.setup_paste}</div>
  <p style="margin:10px 0 0;font-size:12.5px;color:${MUTED};line-height:1.6;">Setup and probing status also live in your Owner Controls on the report page — it flips to <strong>active</strong> after the first two successful pulls.</p>
</td></tr>` : ''}

<tr><td style="padding:0 40px 32px;">
  <p style="margin:0 0 8px;font-size:12px;color:${MUTED};font-weight:600;text-transform:uppercase;letter-spacing:1px;">Your VG Key</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${SURFACE};border-radius:8px;border:1px solid ${BORDER};">
    <tr><td style="padding:16px 20px;">
      <code style="font-size:14px;color:${TEXT};font-family:${MONO};word-break:break-all;line-height:1.5;">${p.vgCode}</code>
    </td></tr>
  </table>
  <p style="margin:8px 0 0;font-size:12px;color:${MUTED};">Paste it into your agent's system prompt or personality file once — anyone can then verify the score is real at <a href="https://verigent.ai/agent/${p.agentHandle}" style="color:${ACCENT};text-decoration:none;">verigent.ai/agent/${p.agentHandle}</a>.</p>
</td></tr>

<tr><td style="padding:24px 40px;border-top:1px solid ${BORDER};">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td>
        <p style="margin:0 0 2px;font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:1px;">Receipt</p>
        <p style="margin:0;font-size:13px;color:${MUTED};">Run: ${p.runToken.slice(0, 12)}...</p>
      </td>
      <td align="right">
        <p style="margin:0 0 2px;font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:1px;">Billing</p>
        <p style="margin:0;font-size:13px;color:${TEXT};font-weight:600;">${p.isFree ? 'Free — founding cohort' : 'Drawn from your prepaid wallet'}</p>
      </td>
    </tr>
  </table>
</td></tr>

${footer(`<p style="margin:0 0 4px;font-size:12px;color:${MUTED};">Verify this result: <a href="https://verigent.ai/api/verify/${p.agentHandle}" style="color:${ACCENT};text-decoration:none;">verigent.ai/api/verify/${p.agentHandle}</a></p>
  <p style="margin:0 0 4px;font-size:12px;color:${MUTED};">Agent profile: <a href="https://verigent.ai/agent/${p.agentHandle}" style="color:${ACCENT};text-decoration:none;">verigent.ai/agent/${p.agentHandle}</a></p>`)}
`);
}

function buildPlainText(p: EmailPayload): string {
  const tierLabel = TIER_LABELS[p.tier] || p.tier;
  // See buildHTML: key-routed /track link signs the owner in; fall back to /agent/<handle> keyless.
  const reportUrl = p.couponCode
    ? `https://verigent.ai/track?key=${encodeURIComponent(p.couponCode)}`
    : `https://verigent.ai/agent/${p.agentHandle}?welcome=1`;

  return `VERIGENT — Verification Complete

Agent: ${p.displayName}
Composite: ${p.composite.toFixed(1)} | Tier: ${p.tier} (${tierLabel}) | Class: ${p.primaryClass}

View your full report: ${reportUrl}
(Every dimension, the soft spots, and the on-chain proof.)
${p.freeWindow ? `
YOUR FREE CONTINUOUS TESTING IS ON — ${p.freeWindow.days ? `${p.freeWindow.days} DAYS` : `${p.freeWindow.hours} HOURS`}:
Your agent pulls its own challenges. One paste and it takes over from there:

${p.freeWindow.setup_paste}

Setup and probing status also live in your Owner Controls on the report page —
it flips to "active" after the first two successful pulls.
` : ''}
YOUR VG KEY:

${p.vgCode}

Paste it into your agent's system prompt or personality file once — anyone can then
verify the score is real at https://verigent.ai/agent/${p.agentHandle}

BILLING:
Run: ${p.runToken}
${p.isFree ? 'Free — founding cohort.' : 'Drawn from your prepaid wallet.'}

Verify: https://verigent.ai/api/verify/${p.agentHandle}

Verigent — Independent AI Agent Verification
`;
}

export async function sendResultEmail(p: EmailPayload, mailer: Mailer): Promise<{ ok: boolean; error?: string }> {
  if (!p.to) return { ok: false, error: 'Missing email' };
  return deliverEmail(mailer, {
    from: 'Verigent <verify@verigent.ai>',
    to: [p.to],
    ...(p.isFree ? { bcc: ['verigent@verigent.ai'] } : {}),
    subject: `Verification complete — ${p.displayName} scored ${p.tier} (${p.composite.toFixed(1)})`,
    html: buildHTML(p),
    text: buildPlainText(p),
    templateId: 'result',
  });
}
