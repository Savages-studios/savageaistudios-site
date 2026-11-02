# FacturForge revenue bridge: Site sale to Marketplace grant to buyer redemption

**Review-only implementation. No deployment, Stripe reconnection, payments, test payments, fund movement, customer contact, or automatic launch.**

## Functional contract

The site already verifies raw Stripe Checkout webhooks, account/mode, Payment Link, Price, amount, SKU and quantity, and durably records the sale plus pending fulfillment. This change adds a separate operator-only worker:

1. Read the private site sale ledger. Recheck event-keyed filename, exact FacturForge offer, checkout session, buyer email, account, mode, amount/currency, fulfillment status, and original purchase binding.
2. For each eligible pending purchase without a valid immutable provisioning marker, invoke the **actual compiled** Marketplace FacturForge provision-paid-checkout.js CLI via Node, with no shell.
3. Marketplace independently makes authenticated read-only Stripe GETs for account, Payment Link, paid Checkout Session, line items, captured PaymentIntent, and unrefunded/undisputed charge. It issues the actual 100-invoice grant only after provider verification, and writes the credential to a separate private handoff. The companion Marketplace revenue-bridge PR checks FACTURFORGE_EXPECTED_BUYER_EMAIL against the Stripe-authenticated buyer **before** provisioning.
4. Only after the real Marketplace process returns a validated success does the site worker create a private exclusive fsynced marker keyed to the original event. Its status is provisioned_pending_buyer_receipt, never delivered or bank-settled. Marketplace's grant claim/lock protects against duplicate issuance after worker crashes.
5. Marketplace's buyer-controlled HTTPS credential receipt, invoice generation/quota, and revocation are downstream services. This worker **does not** email buyers, hand out credentials, generate invoices, revoke on refunds, or assert customer receipt.

AgentPay's IOU/capture rails remain a **separate financial product**. This bridge connects website Stripe Checkout sales to Marketplace fulfillment, not AgentPay IOU settlement. A captured Stripe charge is not proof of bank payout.

## Operator prerequisites (no automatic execution)

Build Marketplace at the matching revenue-bridge branch commit using its documented Node/npm build. Provide private persistent preexisting 0700 (POSIX) directories, not public static hosting or ephemeral storage. Set:

- SAVAGE_PURCHASE_LEDGER_DIR: existing durable site sale queue, absolute private directory.
- SAVAGE_FULFILLMENT_RECEIPT_DIR: separate absolute private directory for provisioning markers.
- SAVAGE_STRIPE_PRODUCTS_JSON: actual verified offer catalog. The worker accepts exactly one FacturForge 100-pack entry, SKU COMM-20260908-MARKETPLACE-FACTURFORGE-PACK100, 1900 minor USD, and actual account/mode/plink_/price_ identifiers. Never guess IDs from public URLs.
- FACTURFORGE_PROVISION_CLI: absolute path to the compiled Marketplace dist/provision-paid-checkout.js built from the revenue-bridge branch. No locally invented provider verification.
- FACTURFORGE_PREPAID_DIR and FACTURFORGE_PRIVATE_DELIVERY_DIR: two other separate private persistent directories used by Marketplace.
- FACTURFORGE_STRIPE_READ_KEY: existing account-scoped Stripe restricted read key for the same account/mode. Used by Marketplace for authenticated GETs. Never commit or log.
- Optional SAVAGE_CHECKOUT_SESSION_ID: restrict the worker to one previously verified checkout session.

After independent approval of runtime configuration, run npm run fulfill:facturforge from the site repo. It returns counts only: processed, already, skipped, and customerDeliveryVerified:false. It does **not** run during site startup or webhook handling. The worker is a separate reviewable operator action, not authorization to contact Stripe in this campaign.

The site webhook currently records fulfillmentMode:manual and the original append-only sale remains pending. The worker's separate marker is the provisioning progress record, not a delivery receipt.

## Verified boundaries and unverified acceptance

npm test runs actual local filesystem queue tests, original site HTTP tests, and negative worker process tests. The new worker tests deliberately use an **offline-labeled purchase fixture** and an actual failing child process. They never fake successful Stripe verification, create payments, or claim a successful customer transaction. The positive provider-to-grant path requires a real preexisting paid Checkout and independent acceptance.

Before production acceptance: verify exact branch SHAs and Linux/Windows behavior; independently map real site buy links and Stripe offer IDs; deploy an authorized HTTPS webhook with persistent storage; run authenticated read-only provider verification against a preexisting paid checkout; prove actual buyer possession acknowledgment through the Marketplace HTTPS service; generate a real invoice with 100 to 99 quota, retry idempotently, and verify refund/dispute revocation. An independent observer must accept the entire flow. Reconcile Marketplace pricing PR #155 and stacked buyer/TLS PRs #156–#165 without regressions.

This is a functional integration milestone, **not** commercial completion.
