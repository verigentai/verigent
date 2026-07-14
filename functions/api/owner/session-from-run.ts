// functions/api/owner/session-from-run.ts — RETIRED (Codex C2, Ant 2026-07-10).
//
// This endpoint minted an owner session from a bare run_token. But run_token is ALSO the agent's submit
// credential and used to ride the shareable /track "watch live" link — so a forwarded link could log a
// stranger in as the account owner. The token split (v51) makes the watch link carry a read-only
// track_token instead, and owner sign-in now comes ONLY from a real session cookie or the email+code
// login (request-code → verify-code). No link mints a session. Fails closed.

interface Env { DB: D1Database; OWNER_AUTH_SECRET?: string }

export const onRequestPost: PagesFunction<Env> = async () => {
  return Response.json(
    { ok: false, error: 'retired', message: 'Sign in with your email — this run-link login was retired for security.' },
    { status: 410 },
  );
};
