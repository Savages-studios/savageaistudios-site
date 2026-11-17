# Savage AI Studios — Homepage Refresh Release Gate
> **Claim state: unproven** — claim-gate labeling (evolution tranche 5, 2026-11-16).
> The flagged figure is a pre-release checklist requirement — a browser zoom level the refresh must be checked at — not a measured result.
> The same record lists its verification steps as outstanding before any merge or publication; GROUND_TRUTH.md governs the site's verified state.
>

**Date:** October 22, 2026 (America/Los_Angeles)  
**Status:** Implementation committed on isolated feature branch. No Relume import or production deployment established.

## Changes completed in branch
- New responsive homepage header with keyboard-operable mobile menu and prominent contact CTA
- Premium dark/copper/cyan editorial hero and three buyer pathways: software, audits, experimental systems
- Visible next-action CTAs leading to existing catalog/product and audit pages
- No JS framework, external font or payment/deployment dependency
- Preserved original source links to five Bubble apps, studio destinations and business contact
- Isolated `site-refresh.css` overrides: secondary pages keep original stylesheet
- Removed outdated numeric marketing claims and the conflicting first-person founder biography from this homepage
- SEO meta title, description, canonical URL and social preview metadata

## Source and evidence
- Site repo: `sa6ag9/savageaistudios-site`
- Branch: `feature/relume-style-upgrade-20261022`
- Public website: https://savageaistudios.com/
- GitHub's `main` homepage does not match the currently deployed public homepage. Never assume a branch push deploys to production.
- Public homepage biography differs from `main`; product readiness/counts also disagree. Before release, reconcile claims with owner and current product/customer-journey evidence.
- Relume MCP not discoverable as an available tool in this ChatGPT context; the available browser attempts failed at connection level (not authentication). No claim of Relume project creation.

## Phase 2: catalog modernization
- Reworked `work.html` catalog hero, section jump menu, product cards and buyer-facing copy.
- Preserved 14 original Stripe purchase URLs (same sequence and targets); renamed 15 catalog purchase/product buttons for accessible product context. These are **source checks, not live payment acceptance checks**.
- Removed older unsupported counts from the catalog, retained distinct “in the lab” products without checkout claims.
- Reused isolated responsive styling and accessible mobile menu.

## Phase 3: comprehensive page motion
- Inventoried 39 HTML pages in the source repository (6 top-level, 33 nested products/coloring-book pages).
- Top-level pages retain their established `motion.js` particle/reveal/page transition engine.
- All 33 nested pages now load `motion-universal.css` and `motion-universal.js` with correct relative paths; scroll reveals, hover response and a low-power decorative particle layer work without intercepting links.
- Honors `prefers-reduced-motion`, data saving, background-tab pausing and offscreen pausing; the site remains legible without JS.
- Existing Stripe purchase URLs were source-preserved through each nested page edit (no purchase execution asserted).
- Runtime browser, mobile, keyboard, assistive technology and performance verification remain mandatory; source tests alone do not prove WCAG compliance or animation quality.

## Automated regression gate
```bash
node --check motion.js
node --check motion-universal.js
node --test tests/*.test.mjs
```
The test suite is dependency-free and covers source links, headings, navigation semantics, retained destinations, claim hygiene, responsive/reduced-motion declarations and page file references. It is **static analysis only**. A passed static test does not certify the website's accessibility or confirm third-party service/checkout functionality.

## Phases 4–5: sitewide consistency and actual verification
- Shared visual identity and responsive mobile/desktop navigation now applied to the About, Overmind, Creative Lab and Coding Blind pages as well as the upgraded homepage and catalog.
- Adjusted the About page to remove unsupported numerical counter claims; clarified pending work versus shipping capabilities without inventing product numbers.
- All 33 nested product and coloring-book pages have a keyboard skip link and `main` target.
- All 31 actions across the SIA-V6 and coloring-book catalogs have product-specific accessible names, preserving original Stripe URLs and "coming soon"/waitlist actions.
- Fixed root `motion.js` to stop rendering offscreen/background/reduced-motion, cap expensive frames, and never intercept external links or checkout navigation. Node VM tests cover these behaviors.

## On-device evidence (October 22, 2026)
**Execution platform:** Authorized Android Termux device through Remote Desktop Commander 0.3.1, Node 24.18.0, no paid tooling.
- Latest source snapshot loaded from public GitHub feature branch, both motion scripts passed `node --check`, and `node --test tests/*.test.mjs` returned **22 passed, 0 failed, exit code 0**.
- Full website audit: **39 HTML pages, zero broken local href/src targets or fragment links** in current source snapshot. This check is now automated in `tests/all-pages-links.test.mjs`.
- Live network HEAD probes from the user's phone: **14 of 14 original Stripe URLs** and **5 of 5 Bubble app homepage URLs** returned HTTP 200. The Bubble BalloonBoard destination redirected to an authentication screen, a normal navigation behavior; do not interpret this as customer functionality verified.
- HTTP probes verify reachability only. No account logins, Stripe purchases, real fulfillment, visual browser rendering, screen-reader acceptance tests or Relume project import were performed as part of this evidence.
- `https://www.relume.ai/app` returned HTTP 200 from Termux but authenticated trial/URL import access is still unknown.

## Mandatory before merging to main or publishing
1. Review an actual rendered mobile and desktop preview, visual contrast and responsive navigation at 320px through desktop and browser zoom to 400%.
2. Keyboard-only walkthrough, screen-reader headings/landmarks, focused mobile menu, skip-to-content and reduced-motion behavior.
3. Run Lighthouse or comparable measurable performance/a11y tools on built preview; capture actual scores with date and environment rather than predicting.
4. Check every relevant external live app, Stripe checkout and leads/contact action against the current business ledger (owner approval required for payment tests).
5. Reconcile live website vs GitHub content, especially business identity, actor count, product availability and legal status; no published false claims.
6. Check hosting build/preview deployment pipeline and check for accidental domain/DNS changes.
7. Record rollback commit/branch and get human sign-off before public publication.

## Relume integration once access works
Import the existing production URL into a separate unpublished Relume Publish/Claude project, ideally using Relumify. Compare the generated layout and components with the branch draft, extract usable design decisions and permitted code/assets, and fold back into this source branch. No automatic subscription charges or DNS changes; verify export rights and trial expiry.

## Rollback
Current `main` is untouched. If the refresh is eventually merged and a production release fails, restore the previous known-good homepage source and stylesheet and verify the working links and deployment; avoid deleting the old stylesheet or `motion.js`.

## Measurement
Actual conversions and sales should be assessed after deployment with user-approved analytics and measurable purchase/lead events. No generated visuals or improved CTA copy alone prove revenue growth.
