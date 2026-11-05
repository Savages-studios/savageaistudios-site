# savageaistudios-site — Ground Truth

**Last verified:** 2026-11-04 (Tights first-hand: API state, merge + tree proofs)
**Canonical branch:** main @ 967235e6a20e21e13374f1bd003244f6c79224a7 (post-merge-wave landing; this file's own commit sits on top)

**2026-11-04 merge wave:** site stack PRs #10–#16 landed on main in order (merges 15e7c95041→967235e6a2), then savage-marketplace PR #170. Published pages byte-identical: old→new delta = 25 files (24 added, package.json modified), **zero HTML files changed**; the 43 buy.stripe.com URLs on the live pages are unchanged (all old-account — replacing them is the Stripe live-rewire job, untouched by this wave).

## What this repo is

The public website for Savage AI Studios (savageaistudios.com,
served by GitHub Pages since the 2026-11-03 DNS flip; Vercel
abandoned). Round 2 is live: professional copy with no
stats/count-based proof, contact + legal + Faultline pages.
(Overmind's site is ovmtruth.com, a different surface.)

## Verified current state

- **Head:** `a574a47809` (merge of PR #18). Tree = 66 blobs
  (blob-identical to the verified PR tree).
- **Tests:** `node --test tests/*.test.mjs` — **45/45** by Tights'
  local run on the exact merged tree (2026-11-03); baseline at the
  parent head `2c44f688` was 35/35 by the same method.
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

Drafts #10–#16 (site sales ↔ Stripe provisioning/reconciliation
chain) remain open drafts, gated on the Stripe proof chain. PR #18
merged 2026-11-03 (below).

## Where it is going

No D1–D12 ruling covers this repo. Standing site direction
(campaign record): no stats/count-based proof anywhere on the
site; professional register. The #4 proof debt is the repo's first
Phase 2 obligation.

## Estate rule

Update this file after any significant repo change. No claims without verification.

## 2026-11-02 proposed security increment (branch-only, unmerged)

[PR #8](https://github.com/sa6ag9/savageaistudios-site/pull/8) contains private-ledger directory and symlink hardening and descriptor-bound replay-file validation, on isolated `gpt/purchase-ledger-integrity-20261102`. The original code remains on main until review/merge. CI checked exact earlier PR head `95a221abea092291055e7a180cb192562cbee7af`: [run 41466251718](https://github.com/sa6ag9/savageaistudios-site/actions/runs/41466251718) passed Ubuntu (27/27, zero skips) and Windows (25 passed, 2 POSIX-only skipped) with raw logs inspected. [Homepage run 41466251715](https://github.com/sa6ag9/savageaistudios-site/actions/runs/41466251715) also passed. Updating this ground-truth note and the Phase 2 documentation will require fresh exact-head CI before any merge.

Remaining gates are **independent security review, actual website webhook deployment and private persistent storage, Windows ACLs, Stripe test-mode checkout verified against correct account/price IDs, buyer fulfillment, refunds/recovery and reconciliation**. No test-mode provider call, customer delivery, production deployment, or funds movement occurred here. Do not claim revenue or launch completion.

## Update 2026-11-03 — PR #17 + PR #18 (Tights, verified first-hand)

- **PR #17 (Issue #9, duplicate-checkout fulfillment)** merged 2026-11-03 (merge commit 2c44f688): two distinct Stripe events for one checkout session now produce exactly one fulfillment record. Suite at that merge: 35/35 (baseline 27/27). The verified ledger code is deployed on the Oracle box (hooks.savageaistudios.com) in fail-closed state, awaiting the webhook signing secret + read key before it can take live events; the old log-only endpoint remains the production endpoint until then.
- **PR #18 (T5 gap — refunds never revoked)** merged 2026-11-03 (merge commit a574a478): the gap was found by Hunter's Ring 1 rehearsal — signed charge.refunded events were acknowledged and recorded nothing, and the ledger had no revoked state. The fix: charge.refunded is verified (signature + account/mode binding), resolved to its claim through the paymentIntentId stored at checkout, and transitions the claim in place to a terminal REVOKED state (original record never deleted; fulfillment marked revoked; duplicate refunds idempotent; unmatched refunds record nothing; a later checkout redelivery cannot resurrect a revoked claim). Verification of record (Tights, local runs on pulled trees): baseline 35/35 on 2c44f688; PR tree 45/45 (35 unregressed + 10 new revocation tests); tree proof 66/66 blobs, 0 mismatches; the Ring 1 T5 fixture replayed against the fixed code passes 11/11 offline clauses. Stripe-side delivery of a real test-mode refund remains Ring 2 (no test-mode credential exists yet).


## 2026-11-05 update — France invoice readiness inquiry page

- Site PR [#19](https://github.com/sa6ag9/savageaistudios-site/pull/19) merged to `main` as `22bffb088791a8af6b6700d6f377d9c8030c98a8`. It adds `invoice-readiness.html` and the FacturForge catalog link. This is an inquiry page for the proposed $1,500 pilot; there is no checkout URL or invoice upload, and the existing contact form instructs visitors not to submit production invoice data.
- PR #19 CI passed on Ubuntu and Windows. The three Vercel checks reported success/ready deployments; those are deployment checks and do not, by themselves, prove the custom-domain production page was fetched successfully. The source repository's hosting record above says GitHub Pages serves the site; this PR did not change DNS or hosting configuration.
- The page source is present on `main`. Public production reachability of `https://savageaistudios.com/invoice-readiness.html` was not independently verified in this update. Do not describe it as a completed production deployment until a direct live fetch succeeds.
- The $1,500 figure remains proposed. Stripe checkout, correct account and price binding, webhook-to-fulfillment behavior, refunds, and customer data transfer remain unverified.
