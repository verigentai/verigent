// Agent handle suffix system
// Format: digit + letter (0A, 1A, 2A... 0B, 1B... 9Z = 260 per name)
// Extends to digit + 2 letters (0AA... 9ZZ = 6,760) when exhausted

const DIGITS = '0123456789';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function indexToSuffix(index: number): string {
  if (index < 260) {
    const digit = DIGITS[index % 10];
    const letter = LETTERS[Math.floor(index / 10)];
    return `${digit}${letter}`;
  }
  // 3-char extension: digit + 2 letters
  const i = index - 260;
  const digit = DIGITS[i % 10];
  const letter1 = LETTERS[Math.floor(i / 10) % 26];
  const letter2 = LETTERS[Math.floor(i / 260) % 26];
  return `${digit}${letter1}${letter2}`;
}

// Lower-cased, alphanumerics + interior hyphens (2026-07-08, nameless call-signs): hyphens survive
// so "UNIT-K7M4" → "unit-k7m4" → handle "unit-k7m4-0A" (Ant's specced form), and a hyphenated
// display name keeps its shape. Runs collapse ("a--b" → "a-b"); leading/trailing hyphens trim.
// Handles have always contained a hyphen (name-0A) — nothing parses them by splitting on '-'.
export function normaliseName(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .slice(0, 16)
    .replace(/^-+|-+$/g, ''); // trim AFTER slice — else slice(0,16) can re-expose a trailing hyphen
}

export function buildHandle(name: string, suffix: string): string {
  return `${normaliseName(name)}-${suffix}`;
}

// ── Nameless-agent call-signs (Ant ruling 2026-07-08 — un-deferred) ──────────────────────────────
// An agent activated with NO display name gets a readable random call-sign (e.g. "UNIT-K7M4")
// instead of a machine-id-derived handle. Alphabet drops lookalikes (0/O, 1/I/L) so the code reads
// unambiguously; 4 chars over 31 symbols ≈ 923k combos, and the suffix system still disambiguates
// any collision (two UNIT-K7M4s become unit-k7m4-0A / unit-k7m4-1A). Owner can rename via support.
const CALLSIGN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateCallSign(): string {
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  let code = '';
  for (const b of buf) code += CALLSIGN_ALPHABET[b % CALLSIGN_ALPHABET.length];
  return `UNIT-${code}`;
}

// True when a stored display name is effectively NO name: empty/symbols-only, or the machine
// agent_id placeholder that agent creation used to backfill (display_name = agent_id).
export function isPlaceholderName(name: string | null | undefined, agentId: string): boolean {
  const n = (name || '').toString().trim();
  if (!normaliseName(n)) return true;
  return n.toLowerCase() === String(agentId || '').toLowerCase();
}

async function assignSuffixForBase(db: D1Database, base: string): Promise<string> {
  // Count only EXACT-base handles `base-<suffix>` (suffix has no hyphen), NOT longer bases that
  // share this prefix — otherwise a real agent named "Unit" (base 'unit') would count every nameless
  // call-sign 'unit-k7m4-0A' and start at an inflated suffix (Ant review fix). The NOT LIKE excludes
  // any handle with a further hyphen after the base.
  const result = await db.prepare(
    "SELECT COUNT(*) as count FROM agents WHERE handle LIKE ? || '-%' AND handle NOT LIKE ? || '-%-%'"
  ).bind(base, base).first() as any;
  return indexToSuffix(result?.count ?? 0);
}

export async function assignSuffix(db: D1Database, displayName: string): Promise<string> {
  return assignSuffixForBase(db, normaliseName(displayName));
}

// ONE mint path for agent handles (used by attestation + eval-turn — previously duplicated).
// Nameless/placeholder agents get a call-sign minted AND stamped as their display_name so every
// label surface (emails, report, drawer) shows the same readable name the handle derives from.
export async function mintHandleForAgent(
  db: D1Database,
  agentId: string,
  rawDisplayName: string | null | undefined,
): Promise<{ handle: string; suffix: string; display_name: string }> {
  // Only a genuinely BLANK/symbols-only name earns a call-sign at mint — NOT a name that merely
  // equals the agent_id (Ant review fix: run.ts's creation rule says "an agent that deliberately
  // sends its id as its name made a choice"; overwriting that chosen name mid-lifecycle, into the
  // on-chain-anchored cert, is wrong). isPlaceholderName's equals-id branch is for an explicit
  // legacy-data migration, never for live minting.
  let name = (rawDisplayName || '').toString().trim();
  if (!normaliseName(name)) {
    name = generateCallSign();
    await db.prepare('UPDATE agents SET display_name = ? WHERE agent_id = ?').bind(name, agentId).run();
  }
  const base = normaliseName(name);
  const suffix = await assignSuffixForBase(db, base);
  const handle = `${base}-${suffix}`;
  await db.prepare('UPDATE agents SET handle = ?, suffix = ? WHERE agent_id = ?').bind(handle, suffix, agentId).run();
  return { handle, suffix, display_name: name };
}
