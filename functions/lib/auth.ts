// functions/lib/auth.ts — shared auth helpers for the agent's recall_code (the secret that
// proves control of an agent: used by register-endpoint, test-tasks, test-results, revoke).

// Constant-time string comparison — avoids leaking the secret via timing (early-exit on the
// first differing char). Both inputs are normalised the same way before comparison.
export function timingSafeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const an = (a || '').trim().toUpperCase();
  const bn = (b || '').trim().toUpperCase();
  // Compare a fixed reference length so a length mismatch doesn't short-circuit fast.
  const len = Math.max(an.length, bn.length);
  if (an.length === 0 || bn.length === 0) return false;
  let diff = an.length ^ bn.length;
  for (let i = 0; i < len; i++) {
    diff |= (an.charCodeAt(i % an.length) || 0) ^ (bn.charCodeAt(i % bn.length) || 0);
  }
  return diff === 0 && an.length === bn.length;
}

// Crypto-random recall code — the agent's auth secret. ~60 bits, unpredictable (NOT Math.random,
// which is predictable from observed outputs). Format: XXXX-XXXX-XXXX (uppercase, no ambiguous chars).
export function generateRecallCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars, no 0/O/1/I
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  let code = '';
  for (let i = 0; i < 12; i++) {
    code += chars[buf[i] % chars.length];
    if (i === 3 || i === 7) code += '-';
  }
  return code;
}

// ── Cross-run memory plants (session_continuity) ──
// Two typed plants generated at the END of a run and returned to the agent, then exact-match recalled
// on the NEXT run. Both are crypto-random (unpredictable from observed output), distinct in shape so
// they can't be confused with each other or with the recall_code.

// EXPLICIT plant — the agent is TOLD to store it. Distinct PLANT- prefix, no ambiguous chars.
export function generateExplicitPlant(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  let code = 'PLANT-';
  for (let i = 0; i < 8; i++) code += chars[buf[i] % chars.length];
  return code;
}

// INCIDENTAL plant — a natural-sounding codename (WORD-NN) mentioned only in passing. The agent is
// never told to remember it; retaining it is the high band. Word list is deliberate + memorable so a
// genuinely-persisting agent can carry it, but the two digits make a lucky guess ~1/100 per word.
const INCIDENTAL_WORDS = [
  'ORION', 'VESPER', 'HALCYON', 'ZEPHYR', 'COBALT', 'LANTERN', 'MERIDIAN', 'TALON',
  'AURORA', 'CINDER', 'HARBOUR', 'QUARTZ', 'NIMBUS', 'FALCON', 'SABLE', 'VERTEX',
];
export function generateIncidentalPlant(): string {
  const buf = new Uint8Array(2);
  crypto.getRandomValues(buf);
  const word = INCIDENTAL_WORDS[buf[0] % INCIDENTAL_WORDS.length];
  const nn = String(buf[1] % 100).padStart(2, '0');
  return `${word}-${nn}`;
}
