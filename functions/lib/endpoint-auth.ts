// functions/lib/endpoint-auth.ts — encrypt/decrypt probe-endpoint auth secrets at rest.
//
// Agents that protect their probe endpoint give us a real secret (a bearer token or a custom
// header value). We NEVER store it in plaintext: it's AES-GCM encrypted with a server key
// (env.ENDPOINT_AUTH_KEY, base64 32 bytes) and only decrypted in-memory at probe time to build
// the request header. If the key is unset, auth storage degrades to "none" (we just don't auth).

interface KeyEnv { ENDPOINT_AUTH_KEY?: string }

export interface ProbeAuth { authHeader: string; authHeaderName: string }

function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(keyB64: string): Promise<CryptoKey> {
  const raw = b64decode(keyB64);
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// Returns "iv:ct" (both base64), or null if no server key is configured.
export async function encryptSecret(plaintext: string, env: KeyEnv): Promise<string | null> {
  if (!env.ENDPOINT_AUTH_KEY) return null;
  const key = await importKey(env.ENDPOINT_AUTH_KEY);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return `${b64encode(iv)}:${b64encode(new Uint8Array(ct))}`;
}

export async function decryptSecret(enc: string, env: KeyEnv): Promise<string | null> {
  if (!env.ENDPOINT_AUTH_KEY || !enc || !enc.includes(':')) return null;
  try {
    const [ivB64, ctB64] = enc.split(':');
    const key = await importKey(env.ENDPOINT_AUTH_KEY);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64decode(ivB64) }, key, b64decode(ctB64));
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

// Build the auth header for a probe from the agent's stored scheme + encrypted secret.
export async function resolveProbeAuth(
  agent: { endpoint_auth_scheme?: string | null; endpoint_auth_header?: string | null; endpoint_auth_secret_enc?: string | null },
  env: KeyEnv,
): Promise<ProbeAuth | null> {
  const scheme = agent.endpoint_auth_scheme;
  if (!scheme || scheme === 'none' || !agent.endpoint_auth_secret_enc) return null;
  const secret = await decryptSecret(agent.endpoint_auth_secret_enc, env);
  if (!secret) return null;
  if (scheme === 'bearer') return { authHeaderName: 'Authorization', authHeader: `Bearer ${secret}` };
  if (scheme === 'header') return { authHeaderName: agent.endpoint_auth_header || 'Authorization', authHeader: secret };
  return null;
}
