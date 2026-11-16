/** Read-only refund reconciliation. No refund, entitlement, or customer action. */
const id = /^re_[A-Za-z0-9_]+$/;
const pi = /^pi_[A-Za-z0-9_]+$/;
const cs = /^cs_(test|live)_[A-Za-z0-9_]+$/;
const acct = /^acct_[A-Za-z0-9_]+$/;
const fail = reason => { throw new Error('refund_reconciliation:' + reason); };

/** Compare a trusted sale with Stripe refund and charge readback. No network calls. */
export function assessRefundReadback(sale, refund, charge) {
  if (!sale || !cs.test(sale.checkoutSessionId ?? '') || !pi.test(sale.paymentIntentId ?? '')
      || !acct.test(sale.accountId ?? '') || typeof sale.livemode !== 'boolean'
      || sale.checkoutSessionId.startsWith('cs_live_') !== sale.livemode
      || !Number.isSafeInteger(sale.amountTotal) || sale.amountTotal <= 0
      || !/^[a-z]{3}$/.test(sale.currency ?? '')) fail('invalid_sale_identity');
  if (!refund || !id.test(refund.id ?? '') || !charge || !/^ch_[A-Za-z0-9_]+$/.test(charge.id ?? '')
      || refund.charge !== charge.id || charge.payment_intent !== sale.paymentIntentId
      || refund.currency !== sale.currency || charge.currency !== sale.currency
      || refund.livemode !== sale.livemode || charge.livemode !== sale.livemode
      || !Number.isSafeInteger(refund.amount) || refund.amount <= 0
      || !Number.isSafeInteger(charge.amount) || charge.amount !== sale.amountTotal
      || !Number.isSafeInteger(charge.amount_refunded) || charge.amount_refunded < 0
      || charge.amount_refunded > charge.amount || refund.amount > charge.amount_refunded
      || !['pending','requires_action','succeeded','failed','canceled'].includes(refund.status))
    fail('provider_refund_charge_mismatch');
  return Object.freeze({
    schema: 'savage.commerce.refund-assessment.v1',
    checkoutSessionId: sale.checkoutSessionId,
    refundId: refund.id, status: refund.status,
    refundedMinorUnits: charge.amount_refunded,
    originalMinorUnits: sale.amountTotal,
    entitlementAction: refund.status === 'succeeded' && charge.amount_refunded === sale.amountTotal
      ? 'review_full_refund_for_revocation' : 'no_automatic_revocation',
    independentlyAuthenticatedProviderReadback: false,
    buyerDeliveryOrRevocationVerified: false,
  });
}

/** Caller must be a separately reviewed server-side authenticated Stripe adapter.
 * The flag is an internal adapter contract, not cryptographic evidence on its own.
 */
export function reconcileRefundEvidence(sale, readback) {
  if (!readback || readback.authenticatedByServer !== true
      || readback.accountId !== sale?.accountId
      || readback.livemode !== sale?.livemode
      || readback.checkoutSessionId !== sale?.checkoutSessionId
      || readback.paymentIntentId !== sale?.paymentIntentId)
    fail('authenticated_provider_readback_required');
  const result = assessRefundReadback(sale, readback.refund, readback.charge);
  return Object.freeze({ ...result, independentlyAuthenticatedProviderReadback: true });
}
