# Authenticated Stripe storefront offer audit (review-only)

## Commercial purpose

The site has dozens of public `buy.stripe.com` buttons, but an HTML checkout URL alone cannot establish the selling account, Payment Link ID, Price ID, actual amount, active status, or downstream fulfillment. This command inventories the **actual checked-out HTML** and cross-checks each link against authenticated **read-only** Stripe Payment Link and line-item Price objects, under one explicitly selected account and mode. It does not create or modify payments, customers, products, prices, grants, or entitlements.

Run `npm run audit:storefront` only when the correct seller account has already been independently authorized for read-only access. Supply `SAVAGE_STRIPE_ACCOUNT_ID`, `SAVAGE_STRIPE_MODE` (live/test), `SAVAGE_STRIPE_READ_KEY` (account-scoped read-only key), `SAVAGE_STRIPE_PRODUCTS_JSON` (trusted exact SKU/link/price/amount/currency/fulfillment map) and optionally `SAVAGE_STOREFRONT_ROOT` (checked-out site path). Do not commit secrets. The command makes authenticated GET requests only: `/v1/account`, paginated `/v1/payment_links`, and `/v1/payment_links/{id}/line_items` for configured links. HTTP redirects, mismatched accounts, malformed pages, pagination truncation and inconsistent offer terms fail closed. Missing links and unconfigured offers appear as unresolved rather than being assigned invented IDs.

The JSON output identifies the URL and source pages, verified SKU where present, exact failure classification, and total authenticated mappings. `readyForOfferRouting` is true only if every discovered link matches the selected account, active mode and configured price/quantity/currency. Exit code 2 means unresolved storefront offers, 1 means audit failure, 0 means all link mappings checked. **Even exit 0 is not payment, fulfillment, buyer receipt or bank settlement evidence.** It is an offer-routing prerequisite only. All real customer acceptance gates remain separate.

## Fresh seller-account mismatch observed on 2026-11-03 UTC

The currently connected read-only Stripe session exposes one LIVE account: `acct_1UDarZ4SKNBjaRcQ` ("savage ai studios, LLC"). Its authenticated payment-link, price and product lists returned zero records (`data: []`, `has_more:false`). Separately, Marketplace pricing PR #155 states its live checkout offers were verified on 2026-11-02 against a **different** seller account: `acct_1UDhFvCA21F1OObS`. No assertion is made that the latter account is empty, inactive, or invalid. **The current connected account cannot independently verify those historical seller mappings.** Do not replace account IDs or fabricate `plink_`/`price_` IDs to force a green result.

## Acceptance and limits

The source tests inspect the real checked-out HTML inventory and exercise negative account/credential gates. They do **not** mock a successful provider payment or assert that a Stripe API verification happened. Exact-head Linux/Windows CI must pass before review. Independently run the operator command against the correct already-authorized seller account to verify real mapping, then link genuine preexisting paid Checkout evidence to Marketplace's buyer-controlled credential receipt, real invoice/quota debit, and refund/dispute revocation. The enterprise OEM license engine still requires Tights' explicit recorded architecture/ownership decision.

No merge, deployment, Stripe reconnection, new/test payment, spending, fund movement, customer contact, or Genesis modification is authorized by this PR.
