# Automated fulfillment — built in-repo, not deployed

## What was built

The site now contains an automated delivery engine for verified Stripe
purchases whose deliverable is a real, hash-declared file:

- `api/fulfillment-manifest.mjs` is the single declared SKU -> deliverable
  mapping. The production manifest wires the five Glitch coloring-book SKUs
  and the all-five bundle. Each entry names the private PDF file, its byte
  count, content type, and SHA-256 from
  `sa6ag9/glitch-books-private/SHA256-MANIFEST.json`.
- `api/fulfillment.mjs` implements:
  - manifest validation (unique SKUs, safe relative paths, valid hashes,
    held SKUs forbidden from the automated manifest);
  - deliverable loading from a private goods directory, with byte-count
    and SHA-256 verification before any email is produced;
  - a pluggable email sender: `CaptureEmailSender` for tests/development
    and `HttpEmailSender` for an HTTPS JSON email API configured by
    environment;
  - a hash-chained append-only delivery log (`delivery-log.jsonl`) whose
    records include the Stripe event ID, checkout session ID, SKU,
    deliverable hashes, a hash of the recipient address, and a hash of the
    recipient domain. The full buyer email is never written to the log.
- `api/stripe-webhook.mjs` still verifies the raw Stripe signature and the
  trusted offer (account, mode, payment link, price, amount, currency,
  SKU, quantity, paid status, and buyer) through the existing verifier
  before fulfillment can run. Automated delivery is attempted only when
  the existing purchase ledger creates the session's one durable record;
  duplicate events therefore cannot send a second copy.
- `server.mjs` constructs the fulfillment engine only when at least one
  configured offer declares `fulfillmentMode: "automated"` and the
  required private goods, ledger, and email environment is present.

## Fail-closed behavior

No delivery is produced when:

- the Stripe signature is invalid, stale, or otherwise rejected by the
  existing verifier;
- the purchased SKU is absent from the automated manifest;
- the SKU is held — FacturForge Pro
  (`COMM-20260908-MARKETPLACE-FACTURFORGE-PRO-PACK-49`) or the CEROS
  Cockpit UI Pack (`SIAV6-EA-CEROS-COCKPIT-UI-PACK-49`);
- the offer was not configured as `automated`;
- a deliverable file is missing, has the wrong byte count, or fails its
  manifest SHA-256;
- the delivery log's hash chain does not verify.

Refusals and sender failures are recorded in the delivery log. A sender
failure returns HTTP 503 to Stripe so the event can be retried; the log's
explicit `failed` record closes the reservation and permits that retry,
while a `delivered` record is terminal for the event.

## Scope truth

The production manifest wires only SKUs with a verified deliverable file:
the coloring books and their bundle. The engine is generic — another SKU
can be wired only by adding a manifest entry whose deliverable file and
SHA-256 have first been verified. Offers without such an entry remain
manual. In particular, this build does not invent packages for
FacturForge, Monetized MCP, Phase-Space Navigator, or Symplectic WASM SDK,
and it does not wire either held SKU.

The coloring-books copy now says the wired PDFs are "delivered by email
automatically on payment." That sentence describes what this code does
once the operator checklist below has been executed. It is not a claim
that the endpoint is live today.

## Deployment truth

**The webhook endpoint is not live.** The public apex is static hosting;
the Vercel mirrors do not execute this Node route. No automated delivery
can happen until an operator deploys `server.mjs` (or an equivalent host
for `createStripeWebhookRoute`) with its environment and registers the
endpoint with Stripe. Money and delivery remain exactly as manual as
before until then.

## Operator go-live checklist

1. Provision a private, persistent Node 22+ host for `server.mjs` behind an HTTPS reverse proxy that forwards the unmodified raw request body and the `Stripe-Signature` header to `/api/stripe/webhook`. Do not use GitHub Pages or the static Vercel mirrors for this route.
2. Place the five PDFs from `sa6ag9/glitch-books-private` in a private goods directory under the exact filenames declared in `api/fulfillment-manifest.mjs`; before starting, verify every file against that repo's `SHA256-MANIFEST.json` and run its `tools/verify_fulfillment.py` against the new site tree.
3. Create a private, process-owned, persistent purchase-ledger directory (POSIX mode `0700`) and set `SAVAGE_PURCHASE_LEDGER_DIR`; set `SAVAGE_DELIVERY_LOG_DIR` to a private persistent directory (or omit it to use the `delivery-log` subdirectory of the purchase ledger).
4. Build `SAVAGE_STRIPE_PRODUCTS_JSON` from Stripe dashboard records for the one selling account and mode: exact `accountId`, `paymentLinkId`, `priceId`, `amountTotal`, `currency`, and `sku` for every offer on the endpoint. Set the six coloring SKUs to `fulfillmentMode: "automated"`; never set either held SKU to `automated`; keep every other offer `manual` unless its own verified manifest entry exists.
5. Set `STRIPE_WEBHOOK_SECRET` to the secret of the Stripe endpoint created in step 9 and `STRIPE_API_READ_KEY` to a server-only restricted read key for the same account and mode.
6. Set `SAVAGE_FULFILLMENT_GOODS_DIR` to the private goods directory from step 2.
7. Configure the production email sender: `FULFILLMENT_EMAIL_SENDER=http`, `FULFILLMENT_EMAIL_API_URL` set to the provider's HTTPS JSON endpoint, `FULFILLMENT_EMAIL_API_KEY` set to its server-only credential, and `FULFILLMENT_EMAIL_FROM` set to the studio mailbox. `capture` is for tests and development only and must not be used in production.
8. Start the service with `npm run start:webhook` under a supervisor; confirm startup completes without a configuration error and that the proxy reaches the service healthily on the configured `HOST` and `PORT`.
9. In Stripe, register the endpoint URL `https://<your-host>/api/stripe/webhook` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `charge.refunded`; put that endpoint's signing secret in step 5's variable and restart the service.
10. Prove test mode first with a test-mode catalog and secrets: buy one coloring book, confirm exactly one email with the hash-correct PDF arrives, replay the same event and confirm no second email, then refund and confirm the purchase claim is revoked. Inspect the purchase ledger and the hash-chained delivery log after each step.
11. Only after the test-mode proof passes, replace the catalog and secrets with the live account's records, restart, and repeat one controlled live verification before promoting the automatic-delivery copy as operationally live.
12. Monitor the delivery log for `refused` and `failed` outcomes and the purchase ledger for purchases without a matching delivery record; treat either as an operator incident, not as a completed sale.

## Offline verification

```sh
npm test
python3 /path/to/glitch-books-private/tools/verify_fulfillment.py \
  --goods /path/to/glitch-books-private \
  --storefront ./coloring-books
```

The Node tests use locally signed Stripe-shaped fixtures, a capture
sender, and an injected fetch double. They make no Stripe calls, charge
no card, and send no email.
