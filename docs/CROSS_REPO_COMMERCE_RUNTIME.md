# Executable site ↔ Marketplace commercial runtime proof

## Why this matters

The website's read-only buyer-grant reconciliation and Marketplace's compiled
FacturForge grant-status CLI have each passed separate repository tests. Those
results **do not prove the two programs can run together**. This review-only
integration adds a single executable contract that loads the actual compiled
Marketplace prepaid store, creates a genuine local private grant, writes an
actual site PurchaseLedger sale and provision marker, and runs the site's real
reconciliation command against the real Marketplace child-process CLI.

The test proves local code interoperability, **not a Stripe payment**. It
deliberately uses a named `test-fixture` purchase, an invalid-domain buyer
email, no provider keys, and no payment network calls. The invoice debit uses
an explicitly offline callback, **not** the real invoice generator.

## What the executable verifies

1. The actual compiled Marketplace module and status CLI are from the same
   build directory. Missing or mismatched paths refuse execution.
2. An actual private prepaid grant, site purchase ledger entry, and site
   provisioning marker preserve the same Checkout, buyer, account, SKU, mode,
   grant ID and purchase binding.
3. The site's real reconciliation launches Marketplace's compiled status CLI
   and reports the original grant as awaiting buyer possession.
4. A real local HMAC credential-possession challenge/acknowledgment changes
   the site report to `local_buyer_possession_acknowledged_unverified`.
5. A real local prepaid-store debit updates the reported allowance 100 → 99.
6. Revocation takes precedence over acknowledgment and quota.
7. The site's report never exposes the buyer email or API credential and
   always states independent payment and buyer receipt verification are false.

This test does **not** use a fake Stripe HTTP response. The local receipt is
explicitly a fixture, not a claim that a provider accepted payment.

## Running with two authorized local checkouts

Build the exact Marketplace review stack including PR #167:

`npm ci && npm run build`

From the website review branch, configure absolute paths to the compiled
Marketplace `products/facturforge/dist/prepaid.js` and
`products/facturforge/dist/inspect-commerce-grant.js`:

- `SAVAGE_MARKETPLACE_PREPAID_MODULE`
- `SAVAGE_MARKETPLACE_GRANT_STATUS_CLI`

Then execute `npm run verify:cross-repo:offline`. The command uses only
temporary local directories, cleans them up, and prints a redacted JSON
result with `productionAccepted:false`. It refuses absent Marketplace
builds instead of skipping the integration. Do not supply a Stripe key.

The PR's automatic Linux/Windows source workflow checks syntax and executes
the site's full test suite, including actual CLI refusal behavior. **These
source tests are not successful cross-repository runtime execution.**

A separate, explicitly triggered workflow job checks out the exact pinned
Marketplace PR #167 head `cf1aa583f1cec050851056da32ef0f5a514a31a7`,
installs/builds it, then executes the integration. It requires a separately
authorized read-only `SAVAGE_MARKETPLACE_READ_TOKEN` repository secret.
Without that access it fails visibly, rather than silently passing.
A workflow_dispatch may require the workflow to be available on the default
branch; do not merge this review PR solely to run it. Alternatively execute
the command on an authorized machine with both checkouts.

## Acceptance still missing

A successful **offline** integration proves only that the two real source
components agree on their local contract. It does not establish seller-account
ownership, a provider-authenticated real paid Checkout, independently observed
buyer-held TLS credential receipt, an actual generated invoice, production
quota/replay behavior, refund/dispute revocation, or independent customer
acceptance. The previously documented 43-link seller-account mismatch remains
open. This work is part of the existing Phase 2 commercial integration, **not
an approval of the separately gated AgentPay OEM licensing architecture**.

No merges, deployments, spend, money movement, Stripe reconnection, test
payments, customer contact, or Genesis edits are authorized here.
