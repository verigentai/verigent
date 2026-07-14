// functions/lib/email-template-loader.ts — the admin-edited email_templates table is the LIVE copy
// source (Ant ruling 2026-07-08: "of course I want the email templates editable in the backend").
// Live senders load copy through here; Ant tweaks wording in /email-preview without a build.
//
// Contract:
//   • loadTemplate(db, id)  → {subject, body[], cta} from the email_templates row, falling back to
//     EMAIL defaults (email-templates-defaults.ts) when the row is missing OR effectively blank —
//     an emptied row must never send a blank email.
//   • renderTemplate(t, vars) → substitution pass. The stored copy uses the SAME sample literals the
//     defaults bake in (the preview page shows them): "Atlas" stands for the agent's name, and the
//     {{SCORECARD}} marker stays a structural block. vars maps each literal token → its live value,
//     e.g. { Atlas: 'bishop-0A', '3 days': '2 days' }. Tokens are replaced everywhere they appear
//     (subject, body paragraphs, cta) via split/join — no regex, no escaping surprises.
//   • sendTemplateEmail(db, mailer, id, {to, vars, ctaUrl, card}) → load + substitute + render on
//     the SAME shell the admin preview uses (renderLifecycleEmail + the saved header_color), send via
//     Resend. What Ant previews is exactly what customers receive.
//
// Structural emails (test-key chips, result score tables, setup prompts) stay code-owned — templates
// govern prose only (handoff 2026-07-08 §1).

import { DEFAULT_TEMPLATES, renderLifecycleEmail, scoreCardHtml } from './email-templates-defaults';
import { type Mailer, deliverEmail } from './email-send';

export interface LoadedTemplate {
  subject: string;
  body: string[];
  cta: string;
  /** true = live admin-edited row; false = compiled default fallback */
  from_table: boolean;
}

function defaultsFor(id: string): LoadedTemplate | null {
  const d = DEFAULT_TEMPLATES.find((t) => t.id === id);
  return d ? { subject: d.subject, body: d.body, cta: d.cta, from_table: false } : null;
}

export async function loadTemplate(db: D1Database, id: string): Promise<LoadedTemplate | null> {
  let row: any = null;
  try {
    row = await db.prepare('SELECT subject, body, cta FROM email_templates WHERE id = ?').bind(id).first();
  } catch (e) {
    // Table missing/unreadable → defaults keep the mail flowing; the send must not die on copy.
    console.error(`email template read failed (${id}) — using defaults:`, e);
  }
  if (!row) return defaultsFor(id);

  let body: string[] = [];
  try { body = JSON.parse(row.body || '[]'); } catch {}
  body = (Array.isArray(body) ? body : []).filter((p) => typeof p === 'string' && p.trim() !== '');

  const subject = (row.subject || '').toString().trim();
  // Blank row (subject or all paragraphs emptied in the editor) ⇒ defaults — never a blank email.
  if (!subject || body.length === 0) return defaultsFor(id);

  return { subject, body, cta: (row.cta || '').toString(), from_table: true };
}

// HTML-escape an untrusted value (agent display_name, referee/referrer email) before it becomes a
// substitution var — the rendered body is injected as raw HTML into the email shell, so an agent
// named `<img src=x onerror=…>` would otherwise land executable/phishing markup in verify@ mail.
// Code-authored HTML values (e.g. weekly-registry's `<strong>…</strong>`) are passed pre-escaped by
// their call site and must NOT be double-escaped, so escaping is the caller's job at the source.
export function escHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function renderTemplate(
  t: LoadedTemplate,
  vars: Record<string, string> = {},
): { subject: string; body: string[]; cta: string } {
  // SINGLE-PASS substitution (Ant launch-eve review fix): replace every token in ONE scan, longest
  // token first, so an injected VALUE can never be re-matched by a later token. The old sequential
  // split/join let a credit formatted as '$25.00' get re-replaced by the '$25.00'→balance pass,
  // producing a WRONG DOLLAR AMOUNT on real receipts. A regex alternation over the escaped tokens
  // touches each source position exactly once.
  const tokens = Object.keys(vars).filter((k) => k.length > 0).sort((a, b) => b.length - a.length);
  if (tokens.length === 0) return { subject: t.subject, body: [...t.body], cta: t.cta };
  const re = new RegExp(tokens.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  const sub = (s: string) => s.replace(re, (m) => vars[m] ?? m);
  return { subject: sub(t.subject), body: t.body.map(sub), cta: sub(t.cta) };
}

// Plain-text fallback from the rendered HTML body — every deleted hardcoded sender shipped a text
// MIME part alongside the HTML; HTML-only mail scores worse on spam and breaks text-only clients.
// Structural markers ({{SCORECARD}}) and tags are stripped; entities decoded to readable text.
export function bodyToText(body: string[]): string {
  return body
    .filter((p) => p.trim() !== '{{SCORECARD}}')
    .map((p) => p.replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&rarr;/g, '→').replace(/&mdash;/g, '—'))
    .join('\n\n');
}

export interface SendTemplateOpts {
  to: string;
  vars?: Record<string, string>;
  /** CTA button destination — defaults to https://verigent.ai */
  ctaUrl?: string;
  /** live scorecard figures for templates carrying the {{SCORECARD}} block */
  card?: Parameters<typeof scoreCardHtml>[0];
  /** subject prefix (e.g. '[TEST] ') — used by the send-test endpoint */
  subjectPrefix?: string;
  /** CODE-OWNED structural paragraphs appended after the template prose (setup pastes, key chips) —
   *  never sourced from the table; the admin editor owns prose only. Raw inline-safe HTML. */
  appendBodyHtml?: string[];
}

export async function sendTemplateEmail(
  db: D1Database,
  mailer: Mailer,
  id: string,
  opts: SendTemplateOpts,
): Promise<{ ok: boolean; from_table?: boolean; error?: string }> {
  if (!opts.to) return { ok: false, error: 'Missing recipient' };
  const t = await loadTemplate(db, id);
  if (!t) return { ok: false, error: `No template or default for id '${id}'` };

  const r = renderTemplate(t, opts.vars || {});

  let headerColor: string | undefined;
  try {
    const s = await db.prepare("SELECT value FROM email_settings WHERE key = 'header_color'").first() as any;
    headerColor = s?.value || undefined;
  } catch { /* default header colour */ }

  const html = renderLifecycleEmail(
    { subject: r.subject, body: [...r.body, ...(opts.appendBodyHtml || [])], cta: r.cta, card: opts.card, ctaUrl: opts.ctaUrl },
    headerColor,
  );

  // Plain-text part: rendered prose + any appended structural blocks, tags stripped. Restores the
  // multipart html+text every migrated sender used to ship (deliverability).
  const text = bodyToText([...r.body, ...(opts.appendBodyHtml || [])]) +
    (r.cta ? `\n\n${r.cta}: ${opts.ctaUrl || 'https://verigent.ai'}` : '') +
    '\n\nVerigent — independent verification for AI agents.';

  const sent = await deliverEmail({ ...mailer, db: mailer.db || db }, {
    from: 'Verigent <verify@verigent.ai>',
    to: [opts.to],
    subject: `${opts.subjectPrefix || ''}${r.subject}`,
    html,
    text,
    templateId: id,
  });
  return sent.ok ? { ok: true, from_table: t.from_table } : sent;
}
