# savageaistudios-site — Ground Truth

**Last verified:** 2026-11-01 (live API state; audit evidence 2026-10-29; merge-train evidence 2026-11-01)
**Canonical branch:** main @ 4b7687aaa3

## What this repo is

The public website for Savage AI Studios (savageaistudios.com,
deployed via Vercel). Round 2 is live: professional copy with no
stats/count-based proof, contact + legal + Faultline pages.
(Overmind's site is ovmtruth.com, a different surface.)

## Verified current state

- **Head:** `4b7687aaa3` (the train's merge of PR #1, this file's
  predecessor). Tree = 68 blobs.
- **Tests (audit-run, Lane E, at `310f33bd`):** `node --test`
  **22/22**, exit 0; no build step; the live homepage matched head
  at audit time.
- The site carries the estate's customer-grade offers: Faultline
  Exposure Audit **$199**, GitHub Forensic Audit **$299**, the
  Glitch coloring books **$9**, and the FacturForge pack **$19**
  (live Payment Link, fulfillment historically manual).

## The fulfillment gap — stated precisely

At the audit freeze this site had **no webhook and no fulfillment
machinery at all** (corrections appendix (3) governs: the defect is
absence, not a buggy webhook). Stripe could take payment across
the offers with nothing recording the sale or triggering delivery.

Post-audit merges by the account itself (before the train existed):

- **#2** — Relume upgrade, merged 2026-10-26 (`b4d5611b64`).
- **#4** — FacturForge Stripe webhook, merged 2026-10-30
  (`5d40f90fae`). The lane filing marked it DO NOT MERGE pending a
  **real Stripe checkout/fulfillment proof — which is still
  outstanding**. That is a verification debt on already-merged live
  code, carried as a Phase 2 item (a test-mode proof plan exists
  in the campaign record). The webhook's presence on main is a
  fact; its end-to-end behaviour is UNVERIFIED.

## Merged in the 2026-11-01 train

#1 — this file's predecessor GROUND_TRUTH refresh. (The train took
no other action here; #2/#4 above predate it.)

## Parked PRs

None — no open PRs.

## Where it is going

No D1–D12 ruling covers this repo. Standing site direction
(campaign record): no stats/count-based proof anywhere on the
site; professional register. The #4 proof debt is the repo's first
Phase 2 obligation.

## Estate rule

Update this file after any significant repo change. No claims without verification.
