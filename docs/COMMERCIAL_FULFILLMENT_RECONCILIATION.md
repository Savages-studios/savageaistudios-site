# Commercial fulfillment reconciliation: operator evidence, not payment proof

**Review-only, stacked on site PR #10.** No deployment, merge, payment, Stripe reconnect, test charge, customer contact or Genesis change.

## Commercial problem

The signed-webhook sale ledger and the Marketplace FacturForge provisioning worker keep separate durable records. Operators previously had no single machine-readable view of which recorded purchases were queued, had a local provisioning marker but lacked buyer receipt, or belonged to an offer with no supported fulfillment adapter. Without that visibility, a product catalog expansion can silently accumulate unfulfilled purchases.

## Implemented operator workflow

Run `npm run audit:commerce` with the same existing **pre-created absolute private** `SAVAGE_PURCHASE_LEDGER_DIR` and `SAVAGE_FULFILLMENT_RECEIPT_DIR` used by the site bridge, plus `SAVAGE_STRIPE_PRODUCTS_JSON` containing verified trusted offers.

The command is **read-only**. It never starts Marketplace, calls Stripe, provisions a grant, contacts a buyer, or creates a payment. It reads real local sale and marker files with the existing descriptor-verified private reader. It validates the event-keyed file names, original purchase binding, trusted offer terms, and marker-to-sale relationship, and refuses tampering, orphan markers, duplicate catalog SKUs, or unsafe storage.

It emits deterministic JSON with hashed event identifiers, SKU, per-purchase stage, aggregate stage counts, and a SHA-256 **content fingerprint** for comparing report bytes. The fingerprint is **not a signature** and is not an independent authenticity certificate. It does not emit buyer emails, credential tokens or Stripe read keys.

Stages:
- `queued_for_independent_provider_verification`: a locally recorded FacturForge 100-pack sale has no provisioning marker.
- `local_provision_marker_awaiting_buyer_receipt`: a marker consistent with the sale exists, but the audit cannot independently establish that the buyer received the credential.
- `no_supported_provisioning_adapter`: the recorded SKU has no implemented provider-verified fulfillment adapter. This includes the $49 Pro Pack until its real product semantics and authenticated Stripe identifiers are implemented.

All reports explicitly set `independentlyVerifiedProviderPayment:false`, `customerDeliveryVerified:false`, and `bankSettlementVerified:false`. These fields describe **this audit's evidence**, not whether a provider payment happened in the world.

## Real tests and acceptance gates

`npm test` includes real local `PurchaseLedger.record` writes, the actual command as a child process, conflicting markers, orphan markers, corrupted purchase binding, mismatched offer price, duplicate catalog SKU, missing storage, and a second unsupported SKU. A test writes an explicitly local fixture marker to exercise report classification; **it is not represented as a Stripe-confirmed payment or a real provisioned customer**.

This module is operational evidence for the already authorized Phase 2 site-to-Marketplace bridge, **not** a substitute for Tights' pending enterprise/OEM architecture decision.

Next commercial gates: verify exact site buy-link to Stripe account/link/price IDs, wire the $49 and other catalog offers to actual provider-authenticated fulfillment, independently observe buyer-controlled HTTPS credential receipt, generate an invoice with quota decrement, reconcile refunds/disputes, and independently accept a genuine customer flow. Do not claim those gates passed from local audit counts.
