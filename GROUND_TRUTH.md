# savageaistudios-site — Ground Truth

**Last verified:** 2026-11-05 (Tights first-hand: API state, merge + tree proofs, suite + snippet audit on the exact merged tree)
**Canonical branch:** main @ 6929543f5088d6836202621e28c8e8bd30d48a93 (PR #23 merge; this file's own commit sits on top)

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

## 2026-11-05 update — Stripe repoint (PR #20) + catalog publishing (PR #22)

- **PR #20 (Stripe repoint)** merged 2026-11-05 (main `cdaabc9b28b7`): every buy link on the site now points at the NEW Stripe account (`acct_1UYG8zCG8Je0vWdb`) per `~/workspace/stripe-rewire-2026-11-04/DOOR-REGISTRY.json` (76 live doors); the 43 old-account URLs recorded in the 2026-11-04 section above are gone. Five flagship doors (Faultline $499/$999, CEROS Report $999, MoneyEngine $79, Starr Signature Genome $299) are PUBLIC per Savage's 2026-11-05 ruling.
- **PR #22 (catalog publishing)** merged 2026-11-05 (merge commit `7bb9e8dbe29e`; merged tree `897253261ed` byte-identical to the verified PR head tree; **111 blobs**, base 91 + 20 new): 19 new product pages under `products/<catalog-slug>/` for every previously pageless PUBLIC door (both Reversal doors, 3 gateway credit packs, 3 spec-ad tiers, FR-Invoice Bridge, both Faultline tiers, CEROS Report, MoneyEngine, Starr Signature Genome, Regulatory Delta Report, Regulatory Change Monitor, MCP Conformance Audit, Competitive Dominance Audit, coloring-books bundle) + `catalog/index.html` listing all **62 PUBLIC** products by family with their registry buy links. Test inventories updated (44→64 pages; 43→63 motion-checked). PARKED (12) and GATED (2) records carry no page and no listing, per the master catalog's own do-not-list marking (Founding $249 quoted-only; AgentPay license floor manual-only).
- **Tights' verification of record (own runs on the exact tree):** suite **82/82** (`npm test`); all **62** distinct buy.stripe.com URLs on the site match DOOR-REGISTRY.json exactly by SKU; **zero** of the 44 old-account URLs present anywhere; catalog index carries exactly the 62 PUBLIC URLs once each; catalog↔registry cross-check zero disagreements across all 76 records.
- Known follow-ups (not done here): wire `catalog/` into site nav; refresh the now-stale FR-Invoice Bridge card copy on `work.html` (test-pinned); 24 pre-existing PUBLIC pages live at legacy short slugs rather than catalog slugs (the catalog index links to the pages that exist).

## 2026-11-05 update — PostHog analytics wired (PR #23)

- Savage reconnected PostHog himself (Project 667701, US Cloud; organization ID on file in the wiring report) and supplied the project token — PostHog's public write-only key, designed to ship in public pages. **PR #23 merged 2026-11-05**: the official PostHog web snippet (loader + init, `api_host: https://us.i.posthog.com`, `defaults: '2026-05-30'`, `person_profiles: 'identified_only'`, options unaltered) inserted into the `<head>` of all **64 HTML pages** — the site has no build step or shared template, so each standalone page carries it directly; pages copied from existing ones will inherit it.
- **Tights' verification of record (own runs):** every PR file is +8/−0 with the added block byte-identical across all 64 files; 64 files contain the snippet, exactly 64 `posthog.init` calls site-wide; suite **82/82** on the exact merged tree (zero test changes); merged tree byte-identical to the verified PR head tree; blob count unchanged at 111 (modifications only).
- The token is a public client key by design (PostHog's settings page states it is safe for public apps); it is not a secret and needs no vault handling. Event ingestion is a live-account read on PostHog's side — page fetches that don't execute JS fire no events, so first confirmation comes from real visitor traffic or an account-side check.

## 2026-11-09 update — automated fulfillment built (not deployed)

- Base for this update: `main` at `7357864e2fae02a4479873121287d495ec168db4`.
- New capability in-repo: `api/fulfillment.mjs` (automated delivery
  engine), `api/fulfillment-manifest.mjs` (the single declared SKU ->
  deliverable mapping), and `docs/AUTOMATED_FULFILLMENT.md` (design,
  scope truth, and the operator go-live checklist). `server.mjs` wires
  the engine only when a configured offer is `fulfillmentMode:
  "automated"` and the private goods, ledger, and email environment is
  present.
- The production manifest wires exactly the five Glitch coloring-book
  SKUs and `COLORING-BOOKS-BUNDLE-29`. Deliverable SHA-256 values and
  byte counts come from `sa6ag9/glitch-books-private/SHA256-MANIFEST.json`;
  the PDFs themselves remain in that private repository and are loaded at
  deploy time from `SAVAGE_FULFILLMENT_GOODS_DIR`. Every file is
  byte-count and SHA-256 checked before an email payload is produced.
- Delivery is idempotent at two layers: the existing purchase ledger
  allows one durable record per checkout session (duplicate webhook
  deliveries never reach the sender), and the new hash-chained delivery
  log treats a `delivered` record as terminal for its Stripe event. The
  delivery log stores the event ID, session ID, SKU, deliverable hashes,
  a hash of the recipient address, and a hash of the recipient domain —
  never the full buyer email.
- Fail-closed, each with a logged refusal: bad Stripe signature (rejected
  by the pre-existing verifier before fulfillment), unknown SKU, either
  held SKU (FacturForge Pro
  `COMM-20260908-MARKETPLACE-FACTURFORGE-PRO-PACK-49`; CEROS Cockpit UI
  Pack `SIAV6-EA-CEROS-COCKPIT-UI-PACK-49`), a non-automated offer, a
  missing deliverable, and a deliverable hash mismatch.
- Verification executed on the build tree: site suite **110/110 before
  -> 118/118 after** (`npm test`; the 8 new tests cover PDF and
  digital-pack happy paths, duplicate event, bad signature, unknown SKU,
  held SKU, tampered deliverable, the HTTP sender contract, and the
  production manifest). The Glitch fulfillment verifier passes against
  the new tree: **26/26 checks** (goods in `glitch-books-private`,
  storefront in this repo's `coloring-books/`).
- Copy consequence: the coloring-books pages for the wired SKUs now say
  the PDFs are "delivered by email automatically on payment." No other
  offer's delivery wording was changed; offers without a verified
  manifest entry remain manual, and no package was invented for
  FacturForge, Monetized MCP, Phase-Space Navigator, or Symplectic WASM
  SDK.
- **What is NOT true:** this fulfillment is not live. The webhook
  endpoint has not been deployed by this change, no Stripe endpoint was
  registered, no sender was configured, no real or test-mode Stripe
  checkout was run, and no email was sent. The public apex remains static
  hosting, which cannot execute `server.mjs`. Automated delivery becomes
  live only after every step in the operator checklist in
  `docs/AUTOMATED_FULFILLMENT.md` has been executed and proven.
