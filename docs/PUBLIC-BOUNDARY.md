# PUBLIC-BOUNDARY — what may ever leave this repo

**The rule (Ant, 2026-07-05): the exam hall is public; the exam is not.** Protocols,
verifiers, commitments, postmortems, scores — public. Testing processes, test questions,
generation templates, rubrics/judge anchors, test structure and selection internals —
proprietary IP, never published. This is enforced by `tools/publish-guard.mjs`
(mechanical, constitution §5.3 gates-over-vigilance), which MUST pass on the exact tree
being pushed before ANY push to a public repository — including the launch open-sourcing
and every push after it.

## Categories

**PUBLIC NOW** (already published, keep in sync):
- `scripts/verify-commitment.mjs` (the byte contract IS the public spec) → github.com/verigentai/verify + served at /verify-commitment.mjs
- `public/battery-commitments*.json`, `/ots/*.ots`, agent-facing files, all public APIs

**PUBLIC AT LAUNCH** (the "full platform source opens at launch" claim, curated):
- Site frontend (`src/`), public API endpoints (`functions/api/` — excluding the deny-list
  below), wallet/billing plumbing, docs that describe *protocols* (DESERVING-DOCTRINE
  rungs, methodology)
- The launch push is a **curated export run through the guard** — never `git push` of the
  working repo (history carries everything ever committed).

**PROPRIETARY — NEVER PUBLISHED:**
- The Professor domain: `professor/` (emitters and gates may be summarised in docs, the
  battery machinery itself stays private), `bench/` (task generators, scenario templates,
  run harnesses), anything matching `*task-generator*`, `*scenario-template*`,
  `TASK_TEMPLATES`, test-manifest internals
- Rubrics and judge anchors: judge `SYSTEM_PROMPT`s, per-dimension scoring anchors,
  deterministic scoring signatures in `grade-batch.ts`, validator thresholds
- Probe selection internals: weighted-selection logic, injection selection, seeds/salts
- Salts and commitments pre-images (live OUTSIDE the repo: `~/agents/the-professor/commitments/`)
- Internal strategy docs: GTM-DIRECTIVE, STRATEGY, COORDINATION, UNIT-ECONOMICS,
  COMPETITOR-WATCH (competitor intel — never public), retention doctrine (constitution §2.7 copy firewall)
- Credentials, `.env*`, wrangler secrets, DB backups, admin tooling

## Resolved (Ant amendment, 2026-07-05 evening)
Constitution §2.2 now reads "grading is checkable without being published" — commit-reveal,
retired-probe reveals, postmortems and the bounty deliver ex-post verifiability while probe
content and rubrics stay proprietary. This doc is the boundary's SoT; the tension is closed.

## Consumers
- `tools/publish-guard.mjs` — run against any tree before a public push (exit 1 = blocked)
- The launch open-sourcing task MUST reference this doc + run the guard
