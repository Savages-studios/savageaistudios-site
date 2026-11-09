# Savage AI Studios — site

The public Savage AI Studios website (static HTML served from this
repository) plus the server-side Stripe purchase webhook in `server.mjs`.

**Read [GROUND_TRUTH.md](GROUND_TRUTH.md) first** for the verified state
of the repository, including what is not true and what is not deployed.

## Automated fulfillment

`api/fulfillment.mjs` and `api/fulfillment-manifest.mjs` implement
automated email delivery for verified purchases whose SKU maps to a
hash-declared deliverable file — currently the Glitch coloring books and
their all-five bundle. The webhook verifies Stripe's raw signature and
the trusted offer before recording the sale; automated delivery then
verifies each deliverable's SHA-256, sends it through the configured
email sender, and writes a hash-chained delivery log that never contains
the buyer's full email address.

Full design, fail-closed behavior, scope limits, and the operator
go-live checklist: [docs/AUTOMATED_FULFILLMENT.md](docs/AUTOMATED_FULFILLMENT.md).

**Deployment truth:** the webhook is not live until `server.mjs` (or an
equivalent host for the route) is deployed with its environment and the
endpoint is registered with Stripe. The static site alone cannot deliver
anything.

## Tests

```sh
npm test
```

The suite is fully offline: Stripe-shaped events are signed locally,
email is captured or sent through an injected fetch double, and no real
charge or email occurs.
