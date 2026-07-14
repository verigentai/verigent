// functions/api/owner/session-from-key.ts — RETIRED (Codex C2 class, Ant 2026-07-10).
//
// This minted an owner session from a verification key. But the key is also the AGENT's credential to
// start the test, and it rode the completion email's /track?key= link — same class of hole as
// session-from-run: a forwarded link could sign a stranger in as the account owner. Owner sign-in now
// comes ONLY from a real session cookie or the email+code login (request-code → verify-code). No link
// or key mints a session. Fails closed.

interface Env { DB: D1Database; OWNER_AUTH_SECRET?: string }

export const onRequestPost: PagesFunction<Env> = async () => {
  return Response.json(
    { ok: false, error: 'retired', message: 'Sign in with your email — the key-link login was retired for security.' },
    { status: 410 },
  );
};
