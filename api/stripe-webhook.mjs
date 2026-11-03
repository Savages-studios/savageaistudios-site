import { verifyPaidCheckout, verifySignedCheckoutEnvelope, verifySignedEventEnvelope, validateOfferCatalog, FULFILLMENT_EVENT_TYPES } from './stripe-verifier.mjs';
import { PurchaseLedger } from './purchase-ledger.mjs';

async function readRaw(req, max = 256 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw Object.assign(new Error('request too large'), { code: 'BODY_TOO_LARGE' });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function respond(res, status, result) {
  const body = JSON.stringify(result);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body), 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff' });
  res.end(body);
}

/**
 * Retrieve line items from an authenticated Stripe API session lookup.
 * Stripe webhook events are minimal and do not auto-expand line_items.
 * No client-supplied URL or account ID is used.
 */
export async function retrieveStripeLineItems(sessionId, apiKey, fetchImpl = fetch) {
  if (typeof sessionId !== 'string' || !/^cs_(live|test)_[A-Za-z0-9_]+$/.test(sessionId))
    throw new Error('invalid checkout session ID');
  if (typeof apiKey !== 'string' || !/^(sk|rk)_(live|test)_[A-Za-z0-9_]+$/.test(apiKey))
    throw new Error('Stripe API key is not configured');
  const url = `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}/line_items?limit=2`;
  const response = await fetchImpl(url, { method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(8000) });
  if (!response?.ok) throw new Error('Stripe line-item lookup failed');
  const data = await response.json();
  if (!data || data.object !== 'list' || !Array.isArray(data.data)
      || data.data.length !== 1 || data.has_more !== false)
    throw new Error('Stripe line-item lookup returned ambiguous or incomplete items');
  return { data: data.data, has_more: false };
}

/** HTTP handler; caller must connect it to a server-side host, NOT static hosting. */
export function createStripeWebhookRoute({ signingSecret, stripeApiKey, offers, ledgerDirectory,
                                           nowSeconds, stripeFetch } = {}) {
  if (typeof signingSecret !== 'string' || signingSecret.length < 16) throw new Error('Stripe webhook signing secret required');
  const catalog = validateOfferCatalog(offers);
  if (new Set(catalog.map((offer) => `${offer.accountId}/${offer.livemode}`)).size !== 1)
    throw new Error('All offers for one signing secret must bind one Stripe account and mode');
  if (catalog.some((offer) => offer.fulfillmentMode !== 'manual'))
    throw new Error('Automatic fulfillment requires an implemented, durable delivery worker; not configured here');
  const ledger = new PurchaseLedger(ledgerDirectory);
  return async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname !== '/api/stripe/webhook') return false;
    if (req.method !== 'POST') { respond(res, 405, { error: 'METHOD_NOT_ALLOWED' }); return true; }
    let raw;
    try { raw = await readRaw(req); }
    catch (error) { respond(res, error.code === 'BODY_TOO_LARGE' ? 413 : 500, { error: error.code ?? 'BODY_READ_FAILED' }); return true; }
    let signedEvent;
    try {
      signedEvent = verifySignedEventEnvelope(raw, req.headers['stripe-signature'],
                                              signingSecret, nowSeconds?.());
    } catch (error) {
      respond(res, 400, { received: false, error: 'CHECKOUT_REJECTED', reason: error.message });
      return true;
    }
    if (!FULFILLMENT_EVENT_TYPES.has(signedEvent.event.type)) {
      // Authentic Stripe event that cannot claim a fulfillment (expiry,
      // refund and payment-intent notices): acknowledge it so Stripe stops
      // retrying, and record nothing. Only the two fulfillment event types
      // proceed to checkout verification below.
      respond(res, 200, { received: true, recorded: false, duplicate: false, ignored: true });
      return true;
    }
    let envelope;
    try {
      envelope = verifySignedCheckoutEnvelope(raw, req.headers['stripe-signature'],
                                             signingSecret, nowSeconds?.());
    } catch (error) {
      respond(res, 400, { received: false, error: 'CHECKOUT_REJECTED', reason: error.message });
      return true;
    }
    let enrichedLineItems;
    if (!envelope.session.line_items) {
      // Normal Stripe webhook: authenticate to Stripe to get the missing rows.
      // Refuse the event if enrichment fails; HTTP 503 allows retry without
      // ever recording an unverified order.
      try {
        enrichedLineItems = await retrieveStripeLineItems(envelope.session.id,
                                                          stripeApiKey, stripeFetch);
      } catch {
        respond(res, 503, { received: false, error: 'STRIPE_LINE_ITEMS_UNAVAILABLE' });
        return true;
      }
    }
    let purchase;
    try {
      purchase = verifyPaidCheckout(raw, req.headers['stripe-signature'], signingSecret, catalog,
                                    nowSeconds?.(), enrichedLineItems);
    } catch (error) {
      respond(res, 400, { received: false, error: 'CHECKOUT_REJECTED', reason: error.message });
      return true;
    }
    try {
      const outcome = await ledger.record(purchase);
      // A paid order always creates a durable human-fulfillment work item.
      // No delivery is claimed before a separate fulfillment worker acts.
      respond(res, 200, { received: true, recorded: outcome.recorded, duplicate: outcome.duplicate, fulfillmentStatus: 'pending' });
    } catch {
      // Do not acknowledge an order that could not be durably committed.
      respond(res, 503, { received: false, error: 'PURCHASE_LEDGER_UNAVAILABLE' });
    }
    return true;
  };
}
