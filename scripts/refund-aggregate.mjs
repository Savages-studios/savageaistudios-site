/** Read-only charge-wide refund reconciliation; caller must independently authenticate and paginate Stripe evidence. */
const fail = reason => { throw new Error('refund_aggregate:' + reason); };
const valid = (s,p) => typeof s === 'string' && new RegExp('^'+p+'_[A-Za-z0-9_]+$').test(s);
export function assessChargeRefundAggregate(charge, refunds, evidence = {}) {
  if (!charge || !valid(charge.id,'ch') || !valid(charge.payment_intent,'pi')
      || typeof charge.livemode !== 'boolean' || !/^[a-z]{3}$/.test(charge.currency ?? '')
      || !Number.isSafeInteger(charge.amount) || charge.amount <= 0
      || !Number.isSafeInteger(charge.amount_refunded) || charge.amount_refunded < 0
      || charge.amount_refunded > charge.amount || !Array.isArray(refunds)) fail('invalid_charge_or_refunds');
  const seen = new Set();
  let succeeded = 0, pending = 0;
  for (const refund of refunds) {
    if (!refund || !valid(refund.id,'re') || seen.has(refund.id)
        || refund.charge !== charge.id || refund.currency !== charge.currency
        || !Number.isSafeInteger(refund.amount) || refund.amount <= 0
        || refund.livemode !== charge.livemode
        || !['succeeded','pending','requires_action','failed','canceled'].includes(refund.status))
      fail('invalid_or_duplicate_refund');
    seen.add(refund.id);
    if (refund.status === 'succeeded') succeeded += refund.amount;
    if (refund.status === 'pending' || refund.status === 'requires_action') pending += refund.amount;
    if (!Number.isSafeInteger(succeeded) || !Number.isSafeInteger(pending)
        || succeeded + pending > charge.amount) fail('refund_amount_overflow');
  }
  if (succeeded !== charge.amount_refunded) fail('charge_refunded_amount_mismatch');
  const complete = evidence.authenticatedByServer === true && evidence.allPagesRetrieved === true
    && evidence.chargeId === charge.id && evidence.paymentIntentId === charge.payment_intent
    && valid(evidence.accountId,'acct') && evidence.livemode === charge.livemode;
  return Object.freeze({
    schema:'savage.commerce.charge-refund-aggregate.v1',
    chargeId:charge.id, paymentIntentId:charge.payment_intent,
    succeededMinorUnits:succeeded, pendingMinorUnits:pending, refundCount:seen.size,
    entitlementAction: complete && succeeded === charge.amount && pending === 0
      ? 'manual_full_refund_revocation_review' : 'no_automatic_revocation',
    independentlyVerified:false,
    completeProviderEvidenceAssertedByAdapter:Boolean(complete),
    buyerRevocationVerified:false,
  });
}
