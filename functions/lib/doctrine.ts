// functions/lib/doctrine.ts — THE owning module for every Deserving Doctrine machine fact.
// (Deserving Doctrine = the trust ladder on /methodology: Now → Accountable → Replicable → Trustless.)
//
// ONE OWNER PER FACT (constitution §2.10): pages, docs and endpoints DERIVE these values — never
// restate them. Pinned by docs/CANONICAL.md + professor/canonical-check.mjs (prebuild gate).
// Programme SoT (rungs, decisions, change points): docs/DESERVING-DOCTRINE.md.
//
// The COMMITMENT BYTE CONTRACT (sha256(utf8(salt + probe_content)) → lowercase hex) is owned by
// scripts/verify-commitment.mjs — the public verifier an outsider runs is the canonical spec; the
// Professor emitter must match IT, not the other way round. Not restated here.

// ── Rung 1 · commit-then-reveal ─────────────────────────────────────────────
// A retired probe's (content, salt) is published only after the probe is fully rotated out of the
// live battery PLUS this lag — secrecy is temporal, not permanent. Probes retired FOR DEMONSTRATION
// (never drawn again, publicly labelled as such) may reveal immediately; the lag protects live draws.
export const REVEAL_LAG_DAYS = 14;

// ── Rung 2 · integrity bounty (STANDING — Ant signed off 2026-07-05) ─────────────────────────────
// Status gates the copy: 'draft' surfaces a "terms being finalised" label. Flipped to 'standing'
// on Ant's sign-off 2026-07-05 — credit awards stand NOW; the cash-equivalent option opens once
// the network is live (capped below).
//
// SCALABLE TERMS (Ant directive 2026-07-05): awards are denominated in MONTHS of standard
// continuous-verification credit, not fixed dollars — the award tracks the service's real value as
// the network and pricing grow, and carries no cash liability while the network is small. Dollar
// equivalents shown on the site DERIVE from pricing.STANDARD_PRICE_CENTS at render time. A cash
// equivalent may be offered once the network is live, capped as a % of trailing-30-day
// verification revenue — the cash side scales with actual usage, never a fixed promise.
export const BOUNTY_STATUS: 'draft' | 'standing' = 'standing';
// 4-tier ladder (1/3/6/12), Ant 2026-07-06 — scrunched from 3/12/24 so the offer costs deferred
// credit proportional to the severity actually found, capped at a year of service.
export const BOUNTY_SITE_CREDIT_MONTHS = 1;      // functional/display bug in the service (non-scoring): broken flow, endpoint error, wrong copy
export const BOUNTY_MINOR_CREDIT_MONTHS = 3;     // reproducible defect that misstates a published score
export const BOUNTY_MAJOR_CREDIT_MONTHS = 6;     // reproducible gaming vector: inflates a score without the capability
export const BOUNTY_CRITICAL_CREDIT_MONTHS = 12; // integrity break: reveal fails its pre-commitment / battery changed after commit (24→12, Ant 2026-07-06: scrunched — a year of service is the ceiling)
// Cash-equivalent ceiling (Ant refinement 2026-07-05): the LOWER of (a) this % of trailing-30-day
// verification revenue and (b) the claimed tier's credit face value (months × standard price).
// Self-tapering by construction: while the network is tiny the revenue-% binds (protects cash);
// as revenue grows the face-value ceiling binds, so the EFFECTIVE percentage of revenue shrinks
// automatically — no schedule to maintain. Credit awards themselves are uncapped by revenue.
export const BOUNTY_CASH_CAP_PCT_REVENUE = 25;

// ── Rung 3 · replication ────────────────────────────────────────────────────
// Public verifier script (in-repo, runnable by anyone): scripts/verify-commitment.mjs.
// Reveals endpoint: /api/battery-reveal · Commitments endpoint: /api/battery-versions.

// ── Rung 4 · Bitcoin anchor (OpenTimestamps) ────────────────────────────────
// battery_versions.ots_status lifecycle. 'pending' = stamped, awaiting calendar aggregation into a
// Bitcoin block; 'anchored' = attestation upgraded with a block reference (ots upgrade succeeded).
export const OTS_STATUSES = ['none', 'pending', 'anchored'] as const;
export type OtsStatus = (typeof OTS_STATUSES)[number];
// Public .ots proof files are served at this path prefix, named <battery_hash>.ots:
export const OTS_PROOF_PATH = '/ots/';

// ── Community contributions (docs/CONTRIBUTE-SPEC.md) ────────────────────────
// Accepted community submissions earn continuous-verification credit, auto-applied to the submitter's
// wallet. Denominated in DAYS (bug reports reuse the bounty MONTH tiers above). One owner per fact:
// the /contribute page + admin accept path derive these — never restate the day counts.
export const CONTRIBUTE_QUESTION_CREDIT_DAYS = 7;   // 1 week — accepted test question
export const CONTRIBUTE_DIMENSION_CREDIT_DAYS = 30; // 1 month — accepted new dimension
