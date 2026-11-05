# Actual FacturForge invoice generation across website and Marketplace (review-only)

This branch builds on website PR #15. It upgrades the existing two-repository offline contract from a synthetic debit callback to **actual compiled FacturForge EN16931 invoice generation**. The website's real purchase ledger and Marketplace's real private prepaid grant still interact through the existing grant-status CLI. The generator is imported from the *same compiled Marketplace build* as the prepaid store and inspector.

The harness uses the checked-in `products/facturforge/fixtures/invoice-en16931.json` fixture, **not a customer invoice**. It verifies successful real XML generation and digest, one durable 100→99 quota debit, byte-identical idempotent replay after restarting the prepaid store without re-invoking the generator, and zero additional quota debit for an invalid invoice rejected by the real generator. It also retains buyer-binding, local credential-possession acknowledgment, revocation and redaction checks.

## Required operator environment

Build the actual Marketplace source with `npm ci && npm run build`. Set four absolute paths (all from the **same** checked-out Marketplace revision):

- `SAVAGE_MARKETPLACE_PREPAID_MODULE`: `products/facturforge/dist/prepaid.js`
- `SAVAGE_MARKETPLACE_GRANT_STATUS_CLI`: `products/facturforge/dist/inspect-commerce-grant.js`
- `SAVAGE_MARKETPLACE_INVOICE_MODULE`: `products/facturforge/dist/index.js`
- `SAVAGE_MARKETPLACE_INVOICE_FIXTURE`: `products/facturforge/fixtures/invoice-en16931.json`

Then run `npm run verify:cross-repo:offline` from the website checkout. The harness rejects missing or mismatched compiled paths before creating any grant. A separately stacked Marketplace CI workflow must pin this website review head and execute on both native Linux and Windows, with the raw exact-head job logs attached to Savage Assistants issue #7.

## Commercial acceptance boundary

This is **real invoice generator execution against an offline invoice fixture**, not a genuine customer's invoice, an authenticated Stripe transaction, buyer-controlled delivery, production refund handling or a paid customer acceptance. The purchase evidence is explicitly marked `test-fixture`; the provider is never contacted. The harness prints `productionAccepted:false` and `invoiceDeliveredToRealCustomer:false`. No external service, Stripe credentials or customer contact are needed.

The separate enterprise AgentPay OEM architecture remains gated on Tights' recorded approval and IP/branch ownership. No merge, deployment, spending, payment creation, fund transfer, Stripe reconnection or Genesis change is authorized by this branch.
