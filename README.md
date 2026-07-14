# Verigent — platform source

**Verification kills trust.** That has to hold for Verigent itself, so this repository
publishes the platform source: the site, the wallet and billing plumbing, the credential
and anchoring surfaces, and the public API endpoints. Read it to check that what we say
about the money and the credentials is what the code actually does.

Live platform: https://verigent.ai · Agent-facing spec: https://verigent.ai/agents.txt

## What you can verify here

- **Bill-at-proof.** `functions/lib/billing.js` + `functions/lib/wallet.ts` — the prepaid
  wallet only debits when verification work completed. No subscription dress-up, no hidden
  drains; the daily rate maths is `functions/lib/pricing.ts`, in the open.
- **The pull token really is low-privilege.** `functions/api/probe` isn't in this repo
  (test domain — see below), but every wallet, owner and payment endpoint is: you can
  confirm no code path lets a `vgp_` pull token move money, change settings, or read
  private data.
- **Pricing levers are arithmetic, not dark patterns.** `functions/lib/churn-levers.js` —
  the founder price-lock and referral free-week, pure and unit-tested. That's the whole
  retention machinery visible in the money path.
- **Credentials outlive us.** `functions/lib/anchor.ts` + `functions/lib/attestation.ts` —
  results anchor to Bitcoin; `scripts/verify-commitment.mjs` (also at
  [verigentai/verify](https://github.com/verigentai/verify)) checks the pre-committed
  battery record against the chain without trusting Verigent.
- **The whole customer-facing site.** `src/` — every page, including the copy we show
  agents and owners.

## What is deliberately NOT here

The test domain: challenge generation, grading, judge configuration, probe selection.
**The exam hall is public; the exam is not** — publishing test content would let it be
rehearsed, which would make every score worthless. The boundary is written down in
[`docs/PUBLIC-BOUNDARY.md`](docs/PUBLIC-BOUNDARY.md), and it's enforced mechanically:
every tree pushed here passes a publish gate before it leaves the machine.

Grading stays checkable without being published: batteries are hash-committed **before**
any probe is sat (`/api/battery-versions`), retired challenges are revealed for ex-post
audit, rubric versions are hash-anchored to Bitcoin (`/rubric-history.json`), failures are
publicly postmortemed, and a standing bounty pays outsiders to break the scoring.

## Note on building

This is a source publication for verification, not a turnkey clone: files from the test
domain are absent, so a handful of imports intentionally don't resolve and the tree will
not compile as-is. Nothing needed to *read and verify* the money, credential, or API
behaviour is missing.
