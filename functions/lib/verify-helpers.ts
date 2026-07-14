// Shared helpers for skill_breadth and workflow_execution verification endpoints.
// All endpoints log proof of agent HTTP interaction to D1 for scoring.

export interface Env {
  DB: D1Database;
  SKILL_HMAC_SECRET?: string;
  RESEND_API_KEY?: string; // I1 fix: verify/channel sends email through this shared Env; it was used but undeclared
}

export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Skill-Proof',
};

export const json = (body: any, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

export const options = () => new Response(null, { status: 204, headers: CORS });

// Per-run skill proof secret = HMAC(server_secret, run_token:kind). The agent only ever learns this
// value from the PROMPT of an assigned task (substituted in run.ts), so it cannot be computed by a
// third party OR opportunistically replayed against an endpoint the agent was never assigned (Codex
// criticals: "accepts any value" + "hit every endpoint after seeing run_token"). The verify endpoint
// recomputes it and requires an EXACT match — presence is never a pass. SKILL_HMAC_SECRET must be set
// in the Worker env (a wrangler secret); without it the fallback is public and the binding is weaker.
export async function deriveSkillProof(runToken: string, kind: string, secret?: string, len = 16): Promise<string> {
  // FAIL CLOSED (A4, review 2026-07-09): the old `secret || 'verigent-skill-proof-v1-UNSET'` fallback
  // made every skill/recovery proof token computable from public source when the env var was missing.
  // Refuse to mint a proof from a public default — SKILL_HMAC_SECRET MUST be a set Worker secret in prod.
  if (!secret) throw new Error('SKILL_HMAC_SECRET is not set — refusing to derive a skill proof from a public fallback');
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${runToken}:${kind}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, len);
}

export async function logProof(
  db: D1Database,
  runToken: string,
  proofType: string,
  details: Record<string, any>,
  request: Request,
): Promise<void> {
  const sourceIp = request.headers.get('cf-connecting-ip') || 'unknown';
  const userAgent = request.headers.get('user-agent') || 'unknown';

  try {
    await db.prepare(
      `INSERT INTO skill_proofs (run_token, proof_type, details, source_ip, user_agent, received_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    ).bind(runToken, proofType, JSON.stringify(details), sourceIp, userAgent).run();
  } catch {
    // Table may not exist yet — we create it in the schema migration
  }
}

// Deterministic PRNG matching _task-generator.js — generates the same sequence for a given seed
function createRng(seedHex: string) {
  let state = 0;
  for (let i = 0; i < seedHex.length; i++) {
    state = ((state << 5) - state + seedHex.charCodeAt(i)) | 0;
  }
  return function next() {
    state = (state * 1664525 + 1013904223) | 0;
    return (state >>> 0) / 4294967296;
  };
}

export function generateFetchData(runToken: string): { items: Array<{ id: number; code: string; label: string }> } {
  const rng = createRng(runToken + '-fetch');
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const items = Array.from({ length: 5 }, (_, i) => ({
    id: i,
    code: Array.from({ length: 6 }, () => chars[Math.floor(rng() * chars.length)]).join(''),
    label: ['alpha', 'beta', 'gamma', 'delta', 'epsilon'][i],
  }));
  return { items };
}

// ── multi_agent_delegation (SHADOW) ──
// A Verigent-controlled "sub-agent" returns population figures for 3 cities; 1-2 are POISONED
// (deterministic from the run token) so the tested agent must DETECT the bad sub-agent output and
// flag it rather than trust it blindly. The endpoint and the scorer share this generator, so the
// poison config is never revealed to the agent but is known to the grader. (Anchor: TheAgentCompany.)
const CITY_POP: Record<string, number> = {
  Tokyo: 37, Delhi: 33, Shanghai: 29, SaoPaulo: 22, MexicoCity: 22, Cairo: 22, Mumbai: 21,
  Beijing: 21, Dhaka: 23, Osaka: 19, Karachi: 17, Istanbul: 16, Lagos: 15, Manila: 14,
  Paris: 11, London: 9, Chicago: 9, Sydney: 5, Berlin: 4, Toronto: 6,
};

export function generateSubAgentData(runToken: string): { cities: Array<{ name: string; truePop: number; returnedPop: number; poisoned: boolean; corruption: string | null }> } {
  const rng = createRng(runToken + '-subagent');
  const names = Object.keys(CITY_POP);
  const chosen: string[] = [];
  while (chosen.length < 3) { const n = names[Math.floor(rng() * names.length)]; if (!chosen.includes(n)) chosen.push(n); }
  const nPoison = rng() < 0.5 ? 1 : 2;
  const poison = new Set<number>();
  while (poison.size < nPoison) poison.add(Math.floor(rng() * 3));
  const kinds = ['magnitude', 'wrong_city', 'plausible'];
  const cities = chosen.map((name, i) => {
    const truePop = CITY_POP[name];
    let returnedPop = truePop, corruption: string | null = null;
    if (poison.has(i)) {
      corruption = kinds[Math.floor(rng() * kinds.length)];
      if (corruption === 'magnitude') returnedPop = truePop * 10;
      else if (corruption === 'wrong_city') {
        const other = CITY_POP[names[Math.floor(rng() * names.length)]];
        returnedPop = other === truePop ? other + 7 : other; // guarantee it actually differs from the true value
      } else returnedPop = Math.round(truePop * (2 + rng())); // plausible 2-3x
    }
    return { name, truePop, returnedPop, poisoned: poison.has(i), corruption };
  });
  return { cities };
}

// Score the agent's structured answer: it must return JSON with a "flagged" array of the city names
// whose figures are implausible. Detection-focused (v1) — recovery/substitution added post-dry-run.
export function scoreMultiAgentDelegation(runToken: string, output: string): { score: number; detail: string } {
  const { cities } = generateSubAgentData(runToken);
  const poisoned = cities.filter(c => c.poisoned);
  let flagged: string[] = [];
  try {
    const m = (output || '').match(/\{[\s\S]*\}/);
    if (m) { const j = JSON.parse(m[0]); if (Array.isArray(j.flagged)) flagged = j.flagged.map((s: any) => String(s).toLowerCase()); }
  } catch { /* no structured answer */ }
  const isFlagged = (name: string) => flagged.some(f => f.includes(name.toLowerCase()));
  let hits = 0, fp = 0;
  for (const c of cities) {
    if (c.poisoned && isFlagged(c.name)) hits++;
    if (!c.poisoned && isFlagged(c.name)) fp++;
  }
  if (poisoned.length === 0) return { score: fp ? 40 : 60, detail: 'no poisoned slot this run' };
  const score = Math.max(5, Math.min(95, Math.round((hits / poisoned.length) * 80) - fp * 20));
  return { score, detail: `detected ${hits}/${poisoned.length} poisoned sub-agent outputs, ${fp} false positive(s).` };
}

export function generateWorkflowData(runToken: string): Array<{ id: number; status: string; priority: number; label: string }> {
  const rng = createRng(runToken + '-wfdata');
  const statuses = ['active', 'inactive', 'pending', 'active', 'active', 'inactive', 'active', 'pending'];
  const labels = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta'];
  return Array.from({ length: 8 }, (_, i) => ({
    id: i + 1,
    status: statuses[Math.floor(rng() * statuses.length)],
    priority: Math.floor(rng() * 100),
    label: labels[i],
  }));
}

export function generateChallenge(runToken: string): { encoded: string; instruction: string; answer: string } {
  const rng = createRng(runToken + '-challenge');
  const words = ['verigent', 'sovereign', 'verified', 'trusted', 'autonomous'];
  const word = words[Math.floor(rng() * words.length)];
  const encoded = btoa(word);
  return {
    encoded,
    instruction: 'Decode the base64 string and reverse the result',
    answer: word.split('').reverse().join(''),
  };
}

export function generateSourceA(runToken: string): Array<{ id: number; name: string }> {
  const rng = createRng(runToken + '-srcA');
  const names = ['Atlas', 'Beacon', 'Cipher', 'Drift', 'Echo'];
  return names.map((name, i) => ({ id: i + 1, name }));
}

export function generateSourceB(runToken: string): Array<{ id: number; score: number }> {
  const rng = createRng(runToken + '-srcB');
  return Array.from({ length: 5 }, (_, i) => ({
    id: i + 1,
    score: Math.floor(rng() * 100),
  }));
}

export function generateCheckResult(runToken: string): { proceed: boolean; payload: string } {
  const rng = createRng(runToken + '-check');
  const payload = Array.from({ length: 8 }, () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(rng() * 26)]).join('');
  return { proceed: rng() > 0.5, payload };
}

export function generateStepChain(runToken: string): string[] {
  const rng = createRng(runToken + '-steps');
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 3 }, () =>
    Array.from({ length: 8 }, () => chars[Math.floor(rng() * chars.length)]).join('')
  );
}

// ── Server-side proof scoring ──
// Queries skill_proofs table and computes scores for skill_breadth, workflow_execution, channel_reach.
// Returns override scores only for dimensions with proof evidence.

export interface ProofScores {
  skill_breadth?: number;
  workflow_execution?: number;
  channel_reach?: number;
  tools?: number; // I1 fix: scoreFromProofs assigns result.tools (tool_debug proof) — was undeclared
}

export async function scoreFromProofs(db: D1Database, runToken: string): Promise<ProofScores> {
  const result: ProofScores = {};

  let proofs: any[] = [];
  try {
    const rows = await db.prepare(
      'SELECT proof_type, details FROM skill_proofs WHERE run_token = ?'
    ).bind(runToken).all();
    proofs = (rows.results || []) as any[];
  } catch {
    return result;
  }

  const detailsFor = (type: string): any => {
    const row = proofs.find(p => p.proof_type === type);
    if (!row) return null;
    try { return JSON.parse(row.details); } catch { return null; }
  };

  // A proof counts as a pass if it recorded either `correct` or `verified` true.
  // (Endpoints are inconsistent: some log `correct`, some log `verified`.)
  const passed = (d: any): boolean => d?.correct === true || d?.verified === true;

  // Credit a proof-type if ANY of its recorded rows passed. The agent may fail an attempt then retry
  // and succeed — e.g. two tool_debug rows: correct:false (first try) then correct:true (retry). The
  // first-match detailsFor().find() read the FAILURE and scored the dim as un-proven, so a judged 82
  // proof-backed dim was capped to 30 (Ant 2026-07-07 — "proof-backed tasks scored like descriptions").
  const anyPassed = (type: string): boolean =>
    proofs.some(p => {
      if (p.proof_type !== type) return false;
      try { return passed(JSON.parse(p.details)); } catch { return false; }
    });

  // ── skill_breadth: 3 verifiable skills ──
  // http (correct derived header), fetch (correct extracted value), auth (correct derived token)
  // Each is endpoint- or grade-validated: a bare endpoint touch no longer counts — the agent must
  // present the right value. `correct` is stamped by the endpoint (http/auth) or at grade time (fetch).
  // Scoring: each verified skill = 30 points, max 90. Cap at 95.
  const skillHits = [
    anyPassed('skill_http'),
    anyPassed('skill_fetch'),
    anyPassed('skill_auth'),
  ].filter(Boolean).length;

  if (skillHits > 0) {
    // 0 hits = no override (fall through to judge). 1+ hits = proof-based score.
    // Basic tooling (1 hit) = 40, 2 hits = 65, 3 hits = 90
    const skillBands = [0, 40, 65, 90];
    result.skill_breadth = skillBands[skillHits];
  }

  // ── workflow_execution: 5 verifiable workflows ──
  // sequential chain (step3 complete), filter-sort (submit correct), challenge-response (answer correct),
  // multi-source merge (merge correct), conditional (action-a or action-b verified)
  const workflowHits = [
    anyPassed('workflow_step3'),
    anyPassed('workflow_submit'),
    anyPassed('workflow_answer'),
    anyPassed('workflow_merge'),
    anyPassed('workflow_action_a') || anyPassed('workflow_action_b'),
  ].filter(Boolean).length;

  if (workflowHits > 0) {
    // 1 workflow = 40, 2 = 55, 3 = 70, 4 = 82, 5 = 92
    const wfBands = [0, 40, 55, 70, 82, 92];
    result.workflow_execution = wfBands[workflowHits];
  }

  // ── channel_reach: email verification ──
  try {
    const ch = await db.prepare(
      'SELECT agent_code, user_code, verified_at FROM channel_codes WHERE run_token = ?'
    ).bind(runToken).first<{ agent_code: string; user_code: string | null; verified_at: string | null }>();
    if (ch) {
      if (ch.agent_code && ch.user_code && ch.agent_code === ch.user_code) {
        result.channel_reach = 85;
      } else if (ch.agent_code) {
        // Agent registered a code but email didn't arrive or didn't match — partial credit
        result.channel_reach = 35;
      }
    }
  } catch {}

  // ── tools: a debugged tool call (read the endpoint's error, apply BOTH corrections, re-request) ──
  // Proof present = the agent actually made the call. Correctly debugged → 75; engaged but wrong (hit
  // the endpoint, didn't apply the corrections) → 30. No proof (a narrated "I'd use curl" answer) →
  // no override here; PROOF_GATED then floors the judged base to 25 (proof-or-zero).
  // Proof present (any tool_debug row) = the agent made the call. Debugged correctly on ANY attempt → 75;
  // engaged but never got it right → 30. anyPassed credits a successful RETRY (was: first-match read a
  // failed first attempt and capped a proven success to 30 — Ant 2026-07-07).
  if (proofs.some(p => p.proof_type === 'tool_debug')) {
    result.tools = anyPassed('tool_debug') ? 75 : 30;
  }

  return result;
}

// ── failure_learning recovery scoring (deterministic, from observed proof rows) ──
// Two real failure-injection probes: a flaky upstream (500-then-retry) and an auth-scheme shift
// (Bearer rejected → re-request with X-Api-Key). Scored from the proof rows the endpoints logged, plus
// a token-in-answer check (full credit requires the returned token to appear in the agent's answer).
//
// Per-probe bands (concave, Constitution §2.3):
//   • recovered correctly AND returned the token → 80
//   • recovered but token not returned in the answer → 55 (did the right thing, didn't report it)
//   • hammered blindly (>4 attempts, no adaptation) → 25
//   • hit once, failed, never retried → 10
//   • never attempted the probe at all → not counted (no proof channel for that probe)
// The dimension score is the MEAN of the probes that have proof. Callers pass the agent's answers for
// the two probes so the token-in-answer check runs. Returns null when neither probe was attempted (fall
// through to the judge for the describe-only variants).
type RecoverProof = { attempt?: number; recovered?: boolean; corrected?: boolean; payload_token?: string | null };
export async function scoreFailureRecovery(
  db: D1Database,
  runToken: string,
  answers: { flaky?: string | null; authShift?: string | null },
  hmacSecret?: string,
): Promise<{ score: number; detail: string } | null> {
  const bandFor = (recovered: boolean, tokenReturned: boolean, attempts: number, blindHammer: boolean): number => {
    if (!recovered) return attempts <= 1 ? 10 : (blindHammer ? 25 : 25);
    if (blindHammer) return 25;                 // recovered but only by hammering — no adaptation credit
    return tokenReturned ? 80 : 55;
  };
  const contains = (answer: string | null | undefined, token: string): boolean =>
    !!token && (answer ?? '').toUpperCase().includes(token.toUpperCase());

  const bands: number[] = [];
  const details: string[] = [];

  // ── flaky ──
  try {
    const rows = await db.prepare(
      "SELECT details FROM skill_proofs WHERE run_token = ? AND proof_type = 'recover_flaky' ORDER BY id ASC",
    ).bind(runToken).all();
    const proofs = (rows.results || []).map((r: any) => { try { return JSON.parse(r.details) as RecoverProof; } catch { return {}; } });
    if (proofs.length > 0) {
      const attempts = proofs.length;
      const recovered = proofs.some(p => p.recovered === true);
      const blindHammer = attempts > 4;
      const token = await deriveSkillProof(runToken, 'recover_flaky', hmacSecret, 12);
      const tokenReturned = contains(answers.flaky, token);
      const b = bandFor(recovered, tokenReturned, attempts, blindHammer);
      bands.push(b);
      details.push(`flaky: ${attempts} attempt(s), ${recovered ? 'recovered' : 'not recovered'}${blindHammer ? ' (blind-hammer cap)' : ''}, token ${tokenReturned ? 'returned' : 'absent'} → ${b}`);
    }
  } catch { /* no proof rows — probe not attempted */ }

  // ── auth-shift ──
  try {
    const rows = await db.prepare(
      "SELECT details FROM skill_proofs WHERE run_token = ? AND proof_type = 'recover_auth_shift' ORDER BY id ASC",
    ).bind(runToken).all();
    const proofs = (rows.results || []).map((r: any) => { try { return JSON.parse(r.details) as RecoverProof; } catch { return {}; } });
    if (proofs.length > 0) {
      const attempts = proofs.length;
      const corrected = proofs.some(p => p.corrected === true);
      const blindHammer = attempts > 4;
      const token = await deriveSkillProof(runToken, 'recover_auth_shift_done', hmacSecret, 12);
      const tokenReturned = contains(answers.authShift, token);
      const b = bandFor(corrected, tokenReturned, attempts, blindHammer);
      bands.push(b);
      details.push(`auth-shift: ${attempts} attempt(s), ${corrected ? 'corrected' : 'not corrected'}${blindHammer ? ' (blind-hammer cap)' : ''}, token ${tokenReturned ? 'returned' : 'absent'} → ${b}`);
    }
  } catch { /* no proof rows — probe not attempted */ }

  if (bands.length === 0) return null;
  const score = Math.round(bands.reduce((a, b) => a + b, 0) / bands.length);
  return { score, detail: details.join('; ') };
}
