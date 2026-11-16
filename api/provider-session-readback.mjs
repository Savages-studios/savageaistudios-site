/**
 * Authenticated provider readback gate. A signed webhook is a notification,
 * not by itself an independent current-state settlement observation.
 * No client URL, account, price or buyer data controls this lookup.
 */
export async function readbackPaidCheckout(purchase, apiKey, fetchImpl = fetch) {
  if (!purchase || typeof purchase !== 'object'
      || !/^cs_(test|live)_[A-Za-z0-9_]+$/.test(purchase.sessionId ?? '')
      || !/^acct_[A-Za-z0-9_]+$/.test(purchase.accountId ?? '')
      || typeof purchase.livemode !== 'boolean'
      || !/^pi_[A-Za-z0-9_]+$/.test(purchase.paymentIntentId ?? '')
      || !Number.isSafeInteger(purchase.amountTotal) || purchase.amountTotal <= 0
      || !/^[a-z]{3}$/.test(purchase.currency ?? '')
      || typeof purchase.customerEmail !== 'string'
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(purchase.customerEmail)
      || purchase.sessionId.startsWith(purchase.livemode ? 'cs_test_' : 'cs_live_'))
    throw new Error('invalid trusted purchase binding');
  if (typeof apiKey !== 'string' ||
      !new RegExp('^(sk|rk)_' + (purchase.livemode ? 'live' : 'test') + '_[A-Za-z0-9_]+$').test(apiKey))
    throw new Error('provider readback credential missing or mode mismatch');
  const response = await fetchImpl(
    'https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(purchase.sessionId),
    { method: 'GET', headers: { Authorization: 'Bearer ' + apiKey, Accept: 'application/json',
      'Stripe-Account': purchase.accountId }, signal: AbortSignal.timeout(8000) });
  if (!response?.ok) throw new Error('provider readback unavailable');
  const session = await response.json();
  if (!session || session.object !== 'checkout.session' || session.id !== purchase.sessionId
      || session.livemode !== purchase.livemode || session.status !== 'complete'
      || session.payment_status !== 'paid' || session.payment_intent !== purchase.paymentIntentId
      || session.amount_total !== purchase.amountTotal || session.currency !== purchase.currency
      || session.customer_details?.email !== purchase.customerEmail)
    throw new Error('provider readback conflicts with signed checkout');
  return Object.freeze({
    provider: 'stripe', sessionId: session.id, paymentIntentId: session.payment_intent,
    accountId: purchase.accountId, livemode: purchase.livemode,
    amountTotal: session.amount_total, currency: session.currency,
    paymentStatus: 'paid', checkoutStatus: 'complete',
    // Observation is process-local. Do not mistake it for a buyer delivery receipt.
    observedAt: new Date().toISOString()
  });
}
