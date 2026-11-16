# savageaistudios-site — Ground Truth

**Last verified:** 2026-11-11 (Knights, fixes #101 + #102 session: API state re-read, tree materialized with every blob SHA-1 verified, suite and censuses run on the exact tree)
**Canonical branch:** main @ `4efd64869a0ced6c4f9bf046b629e09417dba6d7` (this refresh lands on top of that head in its fix PR)

**Verification basis for every current-state figure below:** `GET /repos/Savages-studios/savageaistudios-site/git/ref/heads/main` (head above); recursive tree of that commit = 178 entries / **122 blobs**, each blob fetched and git-SHA-1 verified (122/122); `npm test` and the census commands named in each section, all run on the materialized tree this session. The dated sections after the Historical record banner are retained verbatim from earlier verifications and describe their own dates; where they conflict with the current-state sections, the current-state sections govern.

## What this repo is

The public website for Savage AI Studios (savageaistudios.com,
served by GitHub Pages since the 2026-11-03 DNS flip; the in-tree
`CNAME` is `savageaistudios.com`). A static site — 64 HTML pages, no
build step — plus the estate's commerce machinery in `api/` (Stripe
webhook, purchase ledger, fulfillment engine), which runs only where
an operator deploys `server.mjs`; the public apex is static hosting
and executes none of it. (Overmind's site is ovmtruth.com, a
different surface.)

## Verified current state (2026-11-11)

- **Head / tree:** main @ `4efd64869a0ced6c4f9bf046b629e09417dba6d7`,
  122 blobs — **verified** (API re-read + SHA-1-verified
  materialization, this session).
- **Tests:** `npm test` (`node --test tests/*.test.mjs`, 16 test
  files) — **118/118 pass, 0 fail, 0 skipped** on the exact tree
  above (Knights' local run, Node v24.22.1) — **verified**. The
  previous GT head figures (suite 82/82, 43 links) and the audit-era
  re-measurement (93/93, 62) are both superseded by this section.
- **Pages:** **64 HTML pages** — 11 at root, 45 under
  `products/<slug>/`, plus `products/index.html`,
  `catalog/index.html`, and 6 under `coloring-books/` — **verified**
  (`find . -name '*.html'`). `tests/all-pages-links.test.mjs` pins
  the inventory at exactly 64 and verifies every local href/src path
  and fragment target across all of them.
- **Analytics:** the PostHog snippet (`posthog.init`; the project
  key is a public client key by design) is present in **64/64
  pages** — **verified** (`grep -rl posthog.init --include='*.html'`).
  Whether events are currently being ingested is an account-side
  read — **not established** from this repo.
- **Commerce surface (inventory only):** **19 distinct
  `buy.stripe.com` checkout URLs** in the HTML — 45 page-link pairs
  across 15 files — **verified** with the repo's own collector
  (`collectStorefrontCheckoutLinks` in
  `scripts/audit-stripe-storefront.mjs`, the same inventory the
  suite runs against the real tree). Inventory is not liveness:
  nothing in this repo establishes that any given link currently
  renders or charges (see "What is NOT true").
- **Contact:** the site takes inquiries by **mailto** —
  `mailto:savagnic@gmail.com` appears **200 times across 59 HTML
  files** (waitlist buttons, direct-contact lines) — **verified**.
  There is **no web form anywhere in the tree** (zero `<form`
  elements, zero formsubmit references) since fix #101, below —
  **verified**.
- **Fulfillment:** `api/` holds 5 modules (fulfillment engine,
  fulfillment manifest, purchase ledger, Stripe verifier, Stripe
  webhook). The production manifest wires exactly **6 automated
  SKUs** — the five Glitch coloring-book SKUs and
  `COLORING-BOOKS-BUNDLE-29` — with a held-SKU refusal set —
  **verified** from `api/fulfillment-manifest.mjs`. Deployment
  state: **built, NOT deployed** — no Stripe endpoint registration,
  sender configuration, or live checkout is evidenced anywhere in
  this repo, and the operator checklist in
  `docs/AUTOMATED_FULFILLMENT.md` remains the go-live path —
  claim-state: **reported (standing record), consistent with all
  in-tree evidence**.
- **Open PRs:** **18** — **verified** via the API this session:
  PR #54 (Klaviyo capture, non-draft, titled DO NOT MERGE until the
  dashboard form exists; untouched by fixes #101/#102) and 17 draft
  commerce-chain PRs (#25–#53 range).
- **CI on the main head:** 7 check-runs on `4efd6486` — 5 success,
  1 skipped (`Adjust Configuration`), **1 failure
  (`homepage-static`)** — **verified** via the check-runs API; the
  failure is recorded here as fact and is out of scope for fixes
  #101/#102. Of the 7 workflow files, 3 are branch-locked to
  2026-11 `gpt/*` feature branches (`commerce-reconciliation`,
  `commercial-dispatch-source`, `storefront-offer-audit`),
  `site-refresh` runs on pushes to main, `phase2-stripe-webhook`
  on pull requests to main, and 2 are path-filtered pull-request
  workflows — **verified** from the workflow files.

## Fix #101 (2026-11-11) — the contact form is gone; here is the evidence

Until this fix, `contact.html` carried the site's only form: a POST
to `https://formsubmit.co/savagnic@gmail.com` (raw-email endpoint;
`_next` → `contact-thanks.html`; `_captcha` on; `_honey`
honeypot). That endpoint's FormSubmit activation was **never
established**: no delivery evidence exists in this repo, and
Knights' 2026-11-11 probe could not establish it either — a GET to
the endpoint and a GET to a never-activated control address
returned byte-identical generic "Form should POST" pages (HTTP
200, differing only in per-request CSRF/Cloudflare tokens), so the
non-submission probe does not discriminate activated from
unactivated endpoints. Per queue row 54's own target, the form was
therefore **replaced with the mailto pattern used across the rest
of the site** (the bare `mailto:savagnic@gmail.com` anchor, as in
the waitlist buttons and direct-contact lines). No test submission
was sent: replacement loses no capability the site demonstrably
relies on — there is no record of a form delivery ever arriving —
so the row's probe-and-replace branch governs, not its
last-resort-submission branch. Corrections that rode along:
`legal.html` no longer describes a FormSubmit form; `about.html`'s
CTA no longer says "Use the contact form";
`invoice-readiness.html` now says "Do not attach invoice files to
your email." `contact-thanks.html` remains in the tree (the
suite's page inventory pins it), but nothing routes to it any
longer.

## What is NOT true (current, 2026-11-11)

- Automated fulfillment is **not live**: no webhook-endpoint
  deployment, Stripe endpoint registration, or sender configuration
  is evidenced; delivery for the 6 wired SKUs remains manual until
  the operator checklist in `docs/AUTOMATED_FULFILLMENT.md` is
  executed and proven.
- The 19 checkout URLs are an **inventory, not a liveness claim**:
  per-link rendering/charge state is not established by anything in
  this repo (buy.stripe.com rendering has been observed to flicker
  independently of a link's active flag; re-check at promotion
  time).
- The FormSubmit endpoint's activation was **never proven** — and
  the question is now moot: the form no longer exists.
- **No completed live sale is evidenced in this repo.** The
  purchase-ledger machinery records sales when deployed; nothing
  here proves one has occurred.
- PR #54 (Klaviyo capture) is **not merged**; no Klaviyo form
  exists on main and onsite email capture is **not established**.
- Main is **not all-green**: the `homepage-static` check-run on the
  current head is failing (see CI above).

## Estate rule

Update this file after any significant repo change. No claims without verification.

## Historical record (retained verbatim; each entry describes its own date)


**2026-11-04 merge wave:** site stack PRs #10–#16 landed on main in order (merges 15e7c95041→967235e6a2), then savage-marketplace PR #170. Published pages byte-identical: old→new delta = 25 files (24 added, package.json modified), **zero HTML files changed**; the 43 buy.stripe.com URLs on the live pages are unchanged (all old-account — replacing them is the Stripe live-rewire job, untouched by this wave).

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
