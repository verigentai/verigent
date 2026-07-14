// POST /api/contribute-challenge — community challenge submissions (constitution §2.3 "the exam
// hall, not the examiner"; Ant approved 2026-07-05). PUBLIC: no auth — contributing a challenge is
// open to anyone, human or agent. The submission goes into review; accepted challenges earn the
// contributor a month of standard verification credit (granted from the authed admin endpoint,
// /api/admin/challenges — never from here) and public credit when the challenge enters the battery.
//
// PRIVACY / INTEGRITY: this endpoint NEVER echoes other submissions — the response is only
// { ok, id } for YOUR row. Submissions never expose live exam content in the other direction
// either: a contribution is raw intake, reviewed and rewritten before anything enters the battery.
//
// Rate limit: max 5/day per email AND per IP (SHA-256 ip_hash — no raw IP stored), enforced by a
// COUNT on recent rows, mirroring the owner_login_codes pattern in /api/owner/request-code.

interface Env { DB: D1Database; }

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204, headers: CORS });

const MAX_PER_DAY = 5;
const CHALLENGE_MIN = 40;
const CHALLENGE_MAX = 4000;
const RATIONALE_MAX = 2000;

async function sha256Hex(s: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const headers = { 'Content-Type': 'application/json', ...CORS };

  let body: any;
  try { body = await request.json(); } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400, headers });
  }

  const email = (body.email || '').toString().trim().toLowerCase();
  const handle = (body.handle || '').toString().trim().slice(0, 80);
  const dimension = (body.dimension || '').toString().trim().slice(0, 64);
  const challenge = (body.challenge || '').toString().trim();
  const rationale = (body.rationale || '').toString().trim();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return Response.json({ error: 'A valid email is required — it’s how the credit reaches you if your challenge is accepted.' }, { status: 400, headers });
  }
  if (challenge.length < CHALLENGE_MIN || challenge.length > CHALLENGE_MAX) {
    return Response.json({ error: `The challenge needs to be ${CHALLENGE_MIN}–${CHALLENGE_MAX} characters.` }, { status: 400, headers });
  }
  if (rationale.length > RATIONALE_MAX) {
    return Response.json({ error: `Rationale is capped at ${RATIONALE_MAX} characters.` }, { status: 400, headers });
  }

  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  const ipHash = await sha256Hex(ip);

  // Rolling-day rate limit — per email and per IP-hash, counted on this table's own recent rows.
  const perEmail = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM challenge_submissions WHERE contributor_email = ? AND submitted_at > datetime('now', '-1 day')",
  ).bind(email).first<{ n: number }>();
  const perIp = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM challenge_submissions WHERE ip_hash = ? AND submitted_at > datetime('now', '-1 day')",
  ).bind(ipHash).first<{ n: number }>();
  if ((perEmail?.n ?? 0) >= MAX_PER_DAY || (perIp?.n ?? 0) >= MAX_PER_DAY) {
    return Response.json({ error: 'Daily submission limit reached — come back tomorrow.' }, { status: 429, headers });
  }

  const res = await env.DB.prepare(
    `INSERT INTO challenge_submissions (contributor_email, contributor_handle, ip_hash, dimension_suggestion, challenge_text, rationale, status)
     VALUES (?, ?, ?, ?, ?, ?, 'received') RETURNING id`,
  ).bind(email, handle || null, ipHash, dimension || null, challenge, rationale || null).first<{ id: number }>();

  return Response.json({ ok: true, id: res?.id ?? null }, { headers });
};
