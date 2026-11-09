import { createHash } from 'node:crypto';

const HEX = /^[0-9a-f]{64}$/;
const STAGES = new Set(['queued_for_independent_provider_verification','local_provision_marker_awaiting_buyer_receipt','no_supported_provisioning_adapter']);
const fail = reason => { throw new Error(`commerce_lifecycle_transition:${reason}`); };
const fingerprint = report => {
  const unsigned = { ...report };
  delete unsigned.contentFingerprint;
  return createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
};

/** Pure, read-only transition review. A passing transition is NOT payment or delivery evidence. */
export function assessCommerceLifecycleTransition(previous, current) {
  const read = report => {
    if (report?.schema !== 'savage.commercial.fulfillment.reconciliation.v1'
        || !Array.isArray(report.entries) || !Number.isSafeInteger(report.count)
        || report.count !== report.entries.length
        || report.independentlyVerifiedProviderPayment !== false
        || report.customerDeliveryVerified !== false || report.bankSettlementVerified !== false
        || !HEX.test(report.contentFingerprint ?? '')
        || report.contentFingerprint !== fingerprint(report)) fail('invalid_snapshot');
    const entries = new Map();
    const counts = { queuedForProviderVerification: 0, localProvisionMarkersAwaitingBuyerReceipt: 0, noSupportedProvisioningAdapter: 0 };
    for (const entry of report.entries) {
      if (!HEX.test(entry?.eventDigest ?? '') || !HEX.test(entry?.purchaseBinding ?? '')
          || !/^[A-Za-z0-9_-]{3,180}$/.test(entry?.sku ?? '')
          || !STAGES.has(entry?.stage) || entries.has(entry.eventDigest)) fail('invalid_or_duplicate_entry');
      entries.set(entry.eventDigest, entry);
      if (entry.stage === 'queued_for_independent_provider_verification') counts.queuedForProviderVerification++;
      else if (entry.stage === 'local_provision_marker_awaiting_buyer_receipt') counts.localProvisionMarkersAwaitingBuyerReceipt++;
      else counts.noSupportedProvisioningAdapter++;
    }
    if (Object.keys(counts).some(key => report.counts?.[key] !== counts[key])) fail('counts_mismatch');
    return entries;
  };
  const old = read(previous), next = read(current);
  let advanced = 0, unchanged = 0, added = 0;
  for (const [id, entry] of old) {
    const now = next.get(id);
    if (!now) fail('sale_disappeared');
    if (now.purchaseBinding !== entry.purchaseBinding || now.sku !== entry.sku) fail('sale_identity_mutated');
    if (now.stage === entry.stage) { unchanged++; continue; }
    if (entry.stage !== 'queued_for_independent_provider_verification'
        || now.stage !== 'local_provision_marker_awaiting_buyer_receipt') fail('invalid_stage_transition');
    advanced++;
  }
  for (const id of next.keys()) if (!old.has(id)) added++;
  return {
    schema: 'savage.commercial.lifecycle-transition.v1',
    priorFingerprint: previous.contentFingerprint,
    currentFingerprint: current.contentFingerprint,
    advancedToLocalProvisionMarker: advanced, unchanged, newSales: added,
    independentProviderPaymentVerified: false,
    customerDeliveryVerified: false,
    refundOrDisputeClearanceVerified: false,
    productionAcceptance: false,
  };
}
