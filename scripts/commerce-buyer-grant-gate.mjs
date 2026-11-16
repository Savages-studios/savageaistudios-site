import { createHash } from 'node:crypto';
/** Read-only join of site reconciliation and Marketplace grant-status evidence.
 * This never issues grants or treats local evidence as provider confirmation.
 */
const hex = /^[a-f0-9]{64}$/;
const fail = reason => { throw new Error(`commerce_buyer_grant_gate:${reason}`); };

export function assessBuyerGrantCoverage(commerce, grants) {
  if (commerce?.schema !== 'savage.commercial.fulfillment.reconciliation.v1'
      || !Array.isArray(commerce.entries) || commerce.count !== commerce.entries.length
      || commerce.independentlyVerifiedProviderPayment !== false
      || commerce.customerDeliveryVerified !== false
      || commerce.bankSettlementVerified !== false
      || grants?.schema !== 'savage.commercial.buyer-grant-reconciliation.v1'
      || !Array.isArray(grants.entries)
      || grants.inspectedCount !== grants.entries.length
      || grants.pendingUninspected !== 0
      || grants.providerPaymentIndependentlyRechecked !== false
      || grants.buyerReceiptIndependentlyVerified !== false)
    fail('invalid_input_contract');
  const unsigned = { ...commerce }; delete unsigned.contentFingerprint;
  const fingerprint = createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
  if (!hex.test(commerce.contentFingerprint ?? '') || commerce.contentFingerprint !== fingerprint)
    fail('reconciliation_fingerprint_mismatch');
  const sales = new Map();
  let pending = 0;
  for (const sale of commerce.entries) {
    if (!hex.test(sale?.eventDigest ?? '') || !hex.test(sale?.purchaseBinding ?? '')
        || sales.has(sale.eventDigest)
        || !['queued_for_independent_provider_verification', 'local_provision_marker_awaiting_buyer_receipt', 'no_supported_provisioning_adapter'].includes(sale.stage)) fail('invalid_or_duplicate_sale');
    sales.set(sale.eventDigest, sale);
    if (sale.stage === 'local_provision_marker_awaiting_buyer_receipt') pending++;
  }
  const seen = new Set();
  const grantIds = new Set();
  let revoked = 0, awaitingBuyer = 0, locallyAcknowledged = 0;
  for (const grant of grants.entries) {
    const sale = sales.get(grant?.eventDigest);
    if (!sale || seen.has(grant.eventDigest)
        || sale.stage !== 'local_provision_marker_awaiting_buyer_receipt'
        || sale.purchaseBinding !== grant.purchaseBinding
        || !hex.test(grant.grantId ?? '') || grantIds.has(grant.grantId)
        || !Number.isSafeInteger(grant.used) || !Number.isSafeInteger(grant.remaining)
        || grant.used < 0 || grant.remaining < 0 || grant.used + grant.remaining !== 100
        || grant.providerPaymentIndependentlyRechecked !== false
        || grant.buyerReceiptIndependentlyVerified !== false
        || !['revoked','awaiting_buyer_possession','local_buyer_possession_acknowledged_unverified'].includes(grant.status))
      fail('invalid_or_unbound_grant');
    seen.add(grant.eventDigest);
    grantIds.add(grant.grantId);
    if (grant.status === 'revoked') revoked++;
    else if (grant.status === 'awaiting_buyer_possession') awaitingBuyer++;
    else locallyAcknowledged++;
  }
  if (seen.size !== pending) fail('missing_pending_grant_inspection');
  return Object.freeze({
    schema: 'savage.commercial.buyer-grant-coverage.v1',
    sales: sales.size, inspectedGrants: seen.size,
    revoked, awaitingBuyer, locallyAcknowledged,
    uninspectedPendingGrants: 0,
    independentlyVerifiedCustomerPayment: false,
    independentlyVerifiedCustomerDelivery: false,
    readyForAutomaticCustomerEntitlement: false,
    requiresExternalProviderAndBuyerReceiptVerification: true,
  });
}
