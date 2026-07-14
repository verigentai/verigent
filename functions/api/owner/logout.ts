// POST /api/owner/logout — clear the vg_owner session cookie. Idempotent: always returns ok and
// clears the cookie whether or not a valid session was present.

import { clearOwnerSession } from '../../lib/owner-auth';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204, headers: CORS });

export const onRequestPost: PagesFunction = async () => {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearOwnerSession(),
      ...CORS,
    },
  });
};
