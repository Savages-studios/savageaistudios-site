/**
 * Site webhook adapter. Ported from:
 * sa6ag9/savage-marketplace/products/facturforge/src/stripe-webhook.ts
 * Keep its raw-body HMAC, bounded timestamp, account/mode, price/link/SKU,
 * buyer, quantity and paid checks. This generalizes ONLY the trusted offer
 * catalog; it never accepts pricing from webhook metadata as authority.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

function reject(reason) { throw Object.assign(new Error(reason), { code: 'CHECKOUT_REJECTED' }); }
const text = (x) => typeof x === 'string' && x.length > 0 ? x : undefined;
const object = (x) => x && typeof x === 'object' && !Array.isArray(x) ? x : undefined;
const regex = (pattern, value) => typeof value === 'string' && pattern.test(value);

export function validateOfferCatalog(offers) {
  if (!Array.isArray(offers) || offers.length === 0) reject('trusted offer catalog missing');
  const links = new Set();
  for (const offer of offers) {
    if (!offer || !regex(/^acct_[A-Za-z0-9_]+$/, offer.accountId)
      || typeof offer.livemode !== 'boolean'
      || !regex(/^plink_[A-Za-z0-9_]+$/, offer.paymentLinkId)
      || !regex(/^price_[A-Za-z0-9_]+$/, offer.priceId)
      || !regex(/^[A-Za-z0-9_-]{3,180}$/, offer.sku)
      || !Number.isSafeInteger(offer.amountTotal) || offer.amountTotal <= 0
      || !regex(/^[a-z]{3}$/, offer.currency)
      || !['manual', 'automated'].includes(offer.fulfillmentMode))
      reject('incomplete trusted offer configuration');
    if (links.has(offer.paymentLinkId)) reject('duplicate payment link binding');
    links.add(offer.paymentLinkId);
  }
  return offers.map((offer) => Object.freeze({ ...offer }));
}

function checkSignature(rawBody, header, secret, nowSeconds) {
  if (!Buffer.isBuffer(rawBody) || !rawBody.length) reject('empty raw request body');
  if (!text(secret) || secret.length < 16) reject('missing signing secret');
  if (!text(header)) reject('missing Stripe-Signature header');
  const values = new Map();
  for (const part of header.split(',')) {
    const pos = part.indexOf('=');
    if (pos <= 0) continue;
    const key = part.slice(0, pos).trim();
    const val = part.slice(pos + 1).trim();
    if (val) values.set(key, [...(values.get(key) ?? []), val]);
  }
  const timestampText = values.get('t')?.[0];
  const timestamp = timestampText && /^\d+$/.test(timestampText) ? Number(timestampText) : NaN;
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) reject('invalid signature timestamp');
  const expected = createHmac('sha256', secret).update(`${timestampText}.`).update(rawBody).digest();
  const matching = (values.get('v1') ?? []).some((candidate) =>
    /^[a-f0-9]{64}$/.test(candidate)
    && timingSafeEqual(Buffer.from(candidate, 'hex'), expected));
  if (!matching) reject('invalid raw-body signature');
  if (!Number.isFinite(nowSeconds) || Math.abs(nowSeconds - timestamp) > 300) reject('stale signature timestamp');
  return timestamp;
}

/**
 * The only event types that may claim a fulfillment. Everything else with
 * a valid Stripe signature is acknowledged by the route without claiming;
 * unsigned or malformed events are rejected before classification.
 */
export const FULFILLMENT_EVENT_TYPES = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded'
]);

/**
 * Verify Stripe's signature over the exact raw bytes and parse the event.
 * This classifies nothing: callers decide which event types may proceed.
 */
export function verifySignedEventEnvelope(rawBody, header, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  // Parse only after verifying Stripe's signature over the exact raw bytes.
  const observedAt = checkSignature(rawBody, header, secret, nowSeconds);
  let event;
  try { event = object(JSON.parse(rawBody.toString('utf8'))); }
  catch { reject('invalid event JSON'); }
  if (!event || !text(event.type)) reject('missing event type');
  return { event, observedAt };
}

export function verifySignedCheckoutEnvelope(rawBody, header, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const { event, observedAt } = verifySignedEventEnvelope(rawBody, header, secret, nowSeconds);
  if (!FULFILLMENT_EVENT_TYPES.has(event.type)) reject('wrong event type');
  const session = object(object(event.data)?.object);
  if (!session || session.object !== 'checkout.session') reject('missing checkout session');
  return { event, session, observedAt };
}

export function verifyPaidCheckout(rawBody, header, secret, offers,
                                   nowSeconds = Math.floor(Date.now() / 1000),
                                   verifiedLineItems = undefined) {
  // Never use external enrichment to bypass verification of original bytes.
  const { event, session, observedAt } = verifySignedCheckoutEnvelope(rawBody, header, secret, nowSeconds);
  const offer = offers.find((x) => x.paymentLinkId === session.payment_link);
  if (!offer) reject('unrecognized payment link');
  // Direct-account Stripe events often omit event.account; when present
  // (e.g. Connect), the account must match the trusted account for this offer.
  // The endpoint secret MUST be scoped to that account by deployment config.
  const account = event.account === undefined ? offer.accountId : event.account;
  const customer = object(session.customer_details);
  // Stripe's signed webhook normally has no expanded line items. Only the
  // server may supply data obtained from authenticated Stripe API retrieval.
  // Never accept client-reported price or quantity as this argument.
  const items = object(session.line_items) ?? object(verifiedLineItems);
  const lineItems = items?.data;
  const item = Array.isArray(lineItems) && lineItems.length === 1 ? object(lineItems[0]) : undefined;
  const price = object(item?.price);
  const metadata = object(session.metadata);
  const email = text(customer?.email) ?? text(session.customer_email);
  const sessionId = text(session.id);
  const eventId = text(event.id);
  const paymentIntentId = session.payment_intent ?? null;
  if (account !== offer.accountId || event.livemode !== offer.livemode || session.livemode !== offer.livemode
      || !regex(new RegExp(`^cs_${offer.livemode ? 'live' : 'test'}_[A-Za-z0-9_]+$`), sessionId)
      || !regex(/^evt_[A-Za-z0-9_]+$/, eventId)
      || (paymentIntentId !== null && !regex(/^pi_[A-Za-z0-9_]+$/, paymentIntentId))
      || (session.status !== undefined && session.status !== 'complete')
      || session.payment_status !== 'paid'
      || !email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || session.amount_total !== offer.amountTotal || session.currency !== offer.currency
      || items?.has_more === true || !Array.isArray(lineItems) || lineItems.length !== 1
      || item.quantity !== 1 || price?.id !== offer.priceId
      || metadata?.sku !== offer.sku
      || (session.customer !== undefined && session.customer !== null
          && !regex(/^cus_[A-Za-z0-9_]+$/, session.customer)))
    reject('checkout is not bound to paid configured offer, price, buyer, mode and account');
  return Object.freeze({
    eventId, sessionId, customerEmail: email, sku: offer.sku,
    amountTotal: offer.amountTotal, currency: offer.currency,
    accountId: offer.accountId, livemode: offer.livemode,
    observedAt: new Date(observedAt * 1000).toISOString(),
    fulfillmentMode: offer.fulfillmentMode,
    // Link hint only: the checkout session above is the fulfillment key
    // and the purchase identity; a payment intent never widens either.
    paymentIntentId
  });
}
