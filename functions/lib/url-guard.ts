// functions/lib/url-guard.ts — SSRF guard for operator-supplied endpoint URLs.
//
// A registered `endpoint_url` is untrusted input we POST challenges to (sovereignty / administered
// probes). Two layers, so a bad URL is caught even if it was stored before this guard existed or set
// via another path:
//   1. assertPublicHttpsUrl — https-only, bounded length, and the host is not a literal
//      private/reserved IP or an obvious internal name. Applied at STORE time (owner sets it) AND
//      again at RESOLVE time (right before the POST).
//   2. resolvedHostIsPrivate — a DoH (1.1.1.1) A/AAAA lookup to catch DNS-REBIND: a public hostname
//      that later resolves to a private IP. **Fail-OPEN** (a resolver error never blocks) so a flaky
//      lookup can't lock out legit agents — the Cloudflare Workers runtime is the primary backstop
//      (it will not route fetch to RFC1918). Blocks only on a CONFIRMED private resolution.
//      ⚠️ Ant/Professor call: fail-open is the deliberate v1 choice; fail-closed is stricter but
//      false-blocks real endpoints whenever DoH is unavailable.

// Is a literal IP (v4 or v6) private / reserved / loopback / link-local?
export function isBlockedIp(ip: string): boolean {
  const s = ip.toLowerCase().trim();
  if (s.includes(':')) {                                   // IPv6
    if (s === '::1' || s === '::') return true;            // loopback / unspecified
    if (s.startsWith('fe80')) return true;                 // link-local
    if (s.startsWith('fc') || s.startsWith('fd')) return true; // unique-local fc00::/7
    const m = s.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/); // IPv4-mapped
    if (m) return isBlockedIp(m[1]);
    return false;
  }
  const parts = s.split('.');                              // IPv4
  if (parts.length !== 4) return false;
  const n = parts.map(p => Number(p));
  if (n.some(x => !Number.isInteger(x) || x < 0 || x > 255)) return false;
  const [a, b] = n;
  if (a === 0) return true;                                // 0.0.0.0/8
  if (a === 10) return true;                               // 10/8
  if (a === 127) return true;                              // loopback
  if (a === 169 && b === 254) return true;                 // link-local + cloud metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true;        // 172.16/12
  if (a === 192 && b === 168) return true;                 // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true;       // CGNAT 100.64/10
  return false;
}

// Blocked hostname: internal name, or a literal IP that isBlockedIp rejects.
export function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');         // strip a trailing dot
  if (/^\d+$/.test(h) || /^0x[0-9a-f]+$/i.test(h)) return true; // bare-decimal / hex IP literal (2130706433, 0x7f000001)
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.endsWith('.internal') || h.endsWith('.local')) return true;
  const bare = h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h; // [::1] → ::1
  return isBlockedIp(bare);
}

// https-only, bounded, public-host. Returns the normalized URL string or an error.
export function assertPublicHttpsUrl(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const s = String(raw ?? '').trim();
  if (s === '') return { ok: false, error: 'endpoint_url is empty' };
  if (s.length > 512) return { ok: false, error: 'endpoint_url too long' };
  let u: URL;
  try { u = new URL(s); } catch { return { ok: false, error: 'endpoint_url must be a valid URL' }; }
  if (u.protocol !== 'https:') return { ok: false, error: 'endpoint_url must be https' };
  if (isBlockedHostname(u.hostname)) return { ok: false, error: 'endpoint_url must be a public host' };
  return { ok: true, value: u.toString() };
}

// Resolve-time DNS-rebind check. TRUE only when a resolved A/AAAA record is a private/reserved IP.
// Fail-open on any resolver error (see header note).
export async function resolvedHostIsPrivate(hostname: string): Promise<boolean> {
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  if (isBlockedIp(bare)) return true;                      // literal IP (defensive; usually pre-caught)
  try {
    for (const type of ['A', 'AAAA']) {
      const r = await fetch(`https://1.1.1.1/dns-query?name=${encodeURIComponent(bare)}&type=${type}`, {
        headers: { accept: 'application/dns-json' },
        signal: AbortSignal.timeout(3000),
      });
      if (!r.ok) continue;
      const j = await r.json().catch(() => null) as any;
      for (const ans of (j?.Answer ?? [])) {
        // type 1 = A, 28 = AAAA; ans.data is the IP string
        if ((ans?.type === 1 || ans?.type === 28) && typeof ans?.data === 'string' && isBlockedIp(ans.data)) {
          return true;
        }
      }
    }
  } catch { /* fail-open — resolver error never blocks */ }
  return false;
}
