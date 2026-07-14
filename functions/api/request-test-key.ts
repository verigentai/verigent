// POST /api/request-test-key — Request a free test key via email.
// Rate limited: 1 per email per 7 days for ANONYMOUS requests (anti-farming). AUTHENTICATED OWNERS
// are EXEMPT from the cap when adding an agent (decision B, spec §6) — they've proven the inbox.
// COLD PATH (§6): an anonymous email that already owns agent(s) gets an EXISTING_OWNER signal so the
// UI can offer "sign in to your directory" or "add another agent", instead of silently issuing.
// 24-hour key expiry.

import { verifyOwnerSession, getOwnerTokenFromCookie } from '../lib/owner-auth';
import { mailerFromEnv } from '../lib/email-send';
import { sendTestKeyEmail } from '../lib/email';
import { runGateState } from '../lib/node-gate';
import { freeCapReached, joinFreeCapWaitlist, FREE_CAP_MESSAGE } from '../lib/free-cap';
import { isDisposableEmailDomain } from '../lib/email-validation';

interface Env {
  DB: D1Database;
  RESEND_API_KEY?: string;
  OWNER_AUTH_SECRET?: string;
  CLN_API_URL?: string;
  CLN_RUNE?: string;
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function generateCode(): string {
  // CSPRNG + rejection sampling (S1, 2026-07-07) — a test key gates the free test AND can mint an owner
  // session (session-from-key), so a predictable Math.random() key was a theft/takeover vector. Same
  // pattern as run.ts:generateToken. Format UNCHANGED: VG- + 8 chars from the 31-char alphabet.
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

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const headers = { 'Content-Type': 'application/json', ...CORS };

  let body: { email?: string } = {};
  try { body = await request.json(); } catch {}

  const email = (body.email || '').toString().trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return new Response(JSON.stringify({ ok: false, error: 'Valid email is required.' }), { status: 400, headers });
  }

  const db = env.DB;

  // RUN GATE (2026-07-04 incident, Ant) — don't even ISSUE a key while the node's down; a key with no
  // runnable test just frustrates. Log the would-be email so we can auto-notify them "back up" on
  // recovery (item 6), then return the maintenance message (nothing charged/issued).
  {
    const gate = await runGateState(env);
    if (!gate.open) {
      try {
        await db.prepare(
          "INSERT INTO outage_waitlist (email, requested_at) VALUES (?, datetime('now')) " +
          "ON CONFLICT(email) DO UPDATE SET requested_at = excluded.requested_at, notified_at = NULL"
        ).bind(email).run();
      } catch { /* table not migrated yet — never block the maintenance response on the log */ }
      return new Response(JSON.stringify({ ok: false, error: 'MAINTENANCE', maintenance: true, detail: gate.message }), { status: 503, headers });
    }
  }

  // Is the requester an AUTHENTICATED OWNER of this email? (valid vg_owner cookie whose owner row
  // carries this email). Authenticated owners are EXEMPT from the 7-day cap (decision B) — this is the
  // ONLY way to add a subsequent agent (from inside the /agents directory, cookie in hand).
  const token = getOwnerTokenFromCookie(request.headers.get('Cookie'));
  const sessionOwnerId = await verifyOwnerSession(token, env.OWNER_AUTH_SECRET);
  let isAuthedOwnerOfEmail = false;
  if (sessionOwnerId) {
    const o = await db.prepare('SELECT email FROM owners WHERE owner_id = ?').bind(sessionOwnerId).first<{ email: string | null }>();
    isAuthedOwnerOfEmail = !!(o?.email && o.email.trim().toLowerCase() === email);
  }

  // COLD PATH (§6 REVISED, Ant 2026-07-04): an ANONYMOUS email that already owns agent(s) is ALWAYS
  // bounced — NO silent 2nd key from the anonymous /start box. We return EXISTING_OWNER; the /start UI
  // then signs them in (email→code) and lands them on /agents to add another from their directory. The
  // add_another shortcut is gone — the ONLY route to a subsequent key is an authenticated owner.
  if (!isAuthedOwnerOfEmail) {
    const owned = await db.prepare(
      `SELECT COUNT(*) AS n FROM agents a JOIN owners o ON o.owner_id = a.owner_id WHERE o.email = ?`
    ).bind(email).first<{ n: number }>();
    if ((owned?.n ?? 0) > 0) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'EXISTING_OWNER',
        agent_count: owned!.n,
        detail: `You already have ${owned!.n} agent${owned!.n === 1 ? '' : 's'} under this email. Sign in to add another.`,
      }), { status: 409, headers });
    }
  }

  // ONE free test key per email — EVER (Ant 2026-07-10; was 1-per-7-days, anonymous-only). Applies to
  // EVERYONE, authenticated owners included: the free tier is a one-time per-email trial, so a second
  // agent is the paid path (top up a wallet), never another free key. Any prior benchmark-1 key blocks.
  {
    const existing = await db.prepare(
      "SELECT code FROM coupons WHERE email = ? AND tier = 'benchmark-1' LIMIT 1"
    ).bind(email).first();
    if (existing) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'RATE_LIMITED',
        detail: "You've already used your one free test on this email. Top up a wallet any time to verify another agent.",
      }), { status: 429, headers });
    }
  }

  // Free weekly-cap gate (build-handoff item 1): the COGS seatbelt bites at key-request too, so a human
  // is turned away here — not left holding a key that fails at run. ANONYMOUS free path only; authed
  // owners are exempt (keyed/paid path untouched). On cap, hold their place FIFO on the waitlist and
  // return the quality-control message; node-status emails them when next week's window opens.
  if (!isAuthedOwnerOfEmail && (await freeCapReached(db))) {
    // §5.4 review: same disposable-domain block as the free path — don't waitlist throwaway domains.
    const canWaitlist = !isDisposableEmailDomain(email);
    if (canWaitlist) await joinFreeCapWaitlist(db, email);
    return new Response(JSON.stringify({
      ok: false,
      error: 'WEEKLY_FREE_CAP_REACHED',
      waitlisted: canWaitlist,
      detail: FREE_CAP_MESSAGE,
    }), { status: 429, headers });
  }

  // Generate free test key (24h expiry). The free FIRST test attests on-chain + lists in the
  // registry — it's the hook / the real cert experience (5gg, Ant-ruled). includes_attestation=1.
  const code = generateCode();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await db.prepare(
    `INSERT INTO coupons (code, tier, uses_allowed, uses_used, includes_attestation, expires_at, note, email)
     VALUES (?, 'benchmark-1', 1, 0, 1, ?, ?, ?)`
  ).bind(code, expires, `Free test key requested by ${email}`, email).run();

  // Send the TEST KEY on the shared dark shell (redesign, Ant 2026-07-04): ONE primary action —
  // a "Set up your test →" button beside a downplayed key, its href carrying the key so the guided
  // setup opens pre-filled (that IS the setup entry, not My-Agents). Power-user MCP paste line is a
  // separate, clearly-secondary call-out below. §16.3 "not a sign-in code" + track link retained.
  if (env.RESEND_API_KEY) {
    // Carry the owner email so the guided flow PRE-FILLS step 4's verification field (start-view reads
    // ?email=). The key alone doesn't identify the human client-side; baking the email in restores the
    // prefill that regressed when the redesigned guided link dropped it.
    const guided = `https://verigent.ai/start?key=${encodeURIComponent(code)}&email=${encodeURIComponent(email)}`;
    // Track by KEY (Ant 2026-07-04): the human always has the key from this email, so the watch-live
    // link resolves the run from the key — works pre-start (waiting state) and for guided + power users.
    const track = `https://verigent.ai/track?key=${encodeURIComponent(code)}`;
    // KEYLESS prompt (Ant 2026-07-07): no key, no email, no reassurances — those read as an injection
    // funnel and spook well-secured agents. The agent vets the spec read-only, then asks the operator
    // for a key; the operator handing it over is the authorisation. Kept deliberately brief.
    const mcpPrompt = `Take a look at the Verigent diagnostic — an independent, third-party benchmark of what an agent can actually do across its capability dimensions. The spec's at https://verigent.ai/agents.txt. Have a read, and if it's something you're happy to run, ask me and I'll hand you a test key to start.`;
    await sendTestKeyEmail({ to: email, code, guidedUrl: guided, trackUrl: track, mcpPrompt }, mailerFromEnv(env)).catch(() => {});
  }

  return new Response(JSON.stringify({
    ok: true,
    message: 'Test key sent to your email.',
    note: 'This is a free test key — valid for 24 hours, one use. Your result is attested on-chain and listed in the registry: the full cert experience, free.',
  }), { status: 200, headers });
};
