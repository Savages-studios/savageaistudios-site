# Cross-offer commercial fulfillment dispatch (review-only)

## What actually runs
`npm run dispatch:commerce -- --plan` reads the **real private purchase ledger and FacturForge provisioning markers** through the existing `reconcileCommercialFulfillment` implementation. It validates original signed-webhook purchase bindings and trusted offer terms, groups work by SKU, and identifies (1) queued FacturForge purchases awaiting independent Stripe provider verification, (2) local grants still awaiting buyer receipt, and (3) offers without a supported provisioning adapter.

The default mode is **read-only**. No payments, grants, notifications, credentials, invoice operations or Stripe API calls are made by the planner. Unknown products remain blocked instead of being silently routed to the $19 FacturForge pack.

## Explicit operator execution, not performed by this PR
Only an authorized operator with the correct seller-account configuration, existing trusted catalog, compiled Marketplace CLI, private storage directories and real Stripe read credentials may run:

```
SAVAGE_ALLOW_EXISTING_PAYMENT_FULFILLMENT=YES npm run dispatch:commerce -- --execute
```

Execution invokes **the existing** `provisionPendingFacturForgeSales` once for all eligible queued FacturForge purchases. That worker independently queries the authenticated Stripe provider using the actual configured selling account and records grants only after the Marketplace CLI verifies the paid Checkout. This dispatch layer does not fabricate payment results or implement a second payment verifier.

Afterward the dispatcher re-reads the actual private ledger and marker store. It refuses missing or changed purchase identities, incomplete queued-to-provisioned transitions, and unexpected state changes. Unsupported offers remain blocked, including the $49 Pro Pack until its distinct provider objects and actual fulfillment semantics are independently verified. The command exits 2 when unsupported offers remain.

The dispatcher **does not** deliver buyer credentials, send emails, prove buyer possession, create invoices, debit quotas, or handle refunds. Local `provisioned_pending_buyer_receipt` is not customer delivery. A crash during the existing Marketplace CLI can leave a valid grant without a site marker; the existing idempotent CLI/reconciliation must recover it. The dispatcher does not provide a distributed transaction or prevent non-cooperating concurrent writers; unexpected changes fail closed.

## Evidence and release gates
The tests are offline code-contract and actual CLI refusal tests; they never assert a fabricated successful provider response. An executed `npm test` on the exact source SHA is required before a passing test count is claimed. The separate site #10/#11/#12 and Marketplace #155/#165/#166 stacks remain unmerged.

Commercial acceptance still requires the authenticated seller account owning the 43 storefront links, verified account-scoped `plink_` and `price_` identifiers, actual paid Checkout from that account, independently authenticated buyer receipt, genuine invoice/quota 100→99, restart/replay, refund/dispute revocation and independent external acceptance. The currently connected Stripe account and the Marketplace-reported selling account differ; never substitute one for the other.

AgentPay enterprise OEM licensing remains a **separate Tights decision gate**. This dispatch slice is a previously authorized Phase 2 commercial integration, not approval to alter the proprietary enterprise licensing architecture. No merge, deployment, payment creation, Stripe reconnection, spending, fund movement, customer contact or Genesis edits are authorized.
