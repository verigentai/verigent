#!/usr/bin/env node
// verify-commitment.mjs — PUBLIC, in-repo verifier for Verigent's commit-then-reveal battery
// transparency (Deserving Doctrine Stage 1). Anyone can run this to confirm Verigent pre-committed to
// each retired challenge BEFORE revealing it — i.e. the test wasn't changed after the fact.
//
// For every revealed retired challenge (/api/battery-reveal) it recomputes SHA-256(salt || probe_content)
// and checks that hash appears in that version's PRE-committed list (/api/battery-versions). If every
// revealed challenge matches a prior commitment, test integrity is proven without trusting Verigent.
//
// Usage:
//   node scripts/verify-commitment.mjs                       # verify against https://verigent.ai
//   node scripts/verify-commitment.mjs --base https://…      # a different host
//   node scripts/verify-commitment.mjs --versions v.json --reveals r.json   # offline, from saved JSON
//
// COMMITMENT ENCODING: SHA-256 over the UTF-8 bytes of (salt + probe_content), hex lowercase. This MUST
// match the Professor's commitment emitter exactly — it is the seam contract. If a match fails only on
// encoding, align this function with the emitter (documented in docs/verigent-commit-reveal-scope.md).

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// ── COMMITMENT BYTE CONTRACT (the emitter MUST match this exactly, or reveals won't verify) ──
//   commitment = SHA-256( UTF-8( salt + probe_content ) ), output = lowercase hex.
//   • Concatenation ORDER: salt FIRST, then probe_content. No separator/delimiter between them.
//   • salt: the exact string published in the reveal's `salt` field (used verbatim, no decode/transform).
//   • probe_content: the exact string in the reveal's `probe_content` field (verbatim, no trim/normalise).
//   • Encoding: JS String#+ then UTF-8 bytes (Node update(str,'utf8')). No hashing of hex/base64 forms.
// If the Professor emitter differs on ANY of these (order, separator, salt encoding, trimming), align it
// to this — this public script is the canonical contract an outsider runs.
function commit(salt, content) {
  return createHash('sha256').update(salt + content, 'utf8').digest('hex');
}

function arg(name) { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; }

async function load() {
  const vFile = arg('--versions'), rFile = arg('--reveals');
  if (vFile && rFile) {
    return { versions: JSON.parse(readFileSync(vFile, 'utf8')), reveals: JSON.parse(readFileSync(rFile, 'utf8')) };
  }
  const base = arg('--base') || 'https://verigent.ai';
  const [v, r] = await Promise.all([
    fetch(`${base}/api/battery-versions`).then((x) => x.json()),
    fetch(`${base}/api/battery-reveal`).then((x) => x.json()),
  ]);
  return { versions: v, reveals: r };
}

const { versions, reveals } = await load();

// Build version_id → Set(committed hashes) from the versions payload.
const committed = new Map();
for (const v of versions.versions || []) {
  committed.set(v.version_id, new Set(v.probe_commitments || []));
}

const rows = reveals.reveals || [];
if (rows.length === 0) {
  console.log('No revealed challenges yet — nothing to verify (commitments are published; reveals follow on retirement).');
  process.exit(0);
}

let ok = 0, bad = 0;
for (const rev of rows) {
  const recomputed = commit(rev.salt, rev.probe_content);
  const set = committed.get(rev.version_id);
  const matchesRecompute = recomputed === rev.commitment_hash;
  const wasPreCommitted = !!set && set.has(rev.commitment_hash);
  const pass = matchesRecompute && wasPreCommitted;
  console.log(`${pass ? 'OK  ' : 'FAIL'}  ${rev.version_id}  ${rev.commitment_hash.slice(0, 16)}…  recompute=${matchesRecompute ? 'match' : 'MISMATCH'}  pre-committed=${wasPreCommitted ? 'yes' : 'NO'}`);
  pass ? ok++ : bad++;
}

console.log(`\n${bad === 0 ? '✅' : '❌'}  ${ok}/${rows.length} revealed challenges verified against their pre-commitment${bad ? ` — ${bad} FAILED` : ''}.`);
process.exit(bad === 0 ? 0 : 1);
