import { createHash } from 'node:crypto';
const hex = /^[a-f0-9]{64}$/;
const fail = code => { throw new Error('commercial_acceptance:' + code); };
const sha = value => createHash('sha256').update(value).digest('hex');
/**
 * Read-only cross-system evidence inventory. Local sale and grant records
 * NEVER establish independently authenticated provider settlement or buyer receipt.
 */
export function assessCommercialAcceptance(fulfillment, grants, evidence = []) {
  if (fulfillment?.schema !== 'savage.commercial.fulfillment.reconciliation.v1'
    || !Array.isArray(fulfillment.entries) || !Number.isSafeInteger(fulfillment.count)
    || fulfillment.count !== fulfillment.entries.length
    || fulfillment.independentlyVerifiedProviderPayment !== false
    || fulfillment.customerDeliveryVerified !== false
    || fulfillment.bankSettlementVerified !== false
    || grants?.schema !== 'savage.commercial.buyer-grant-reconciliation.v1'
    || !Array.isArray(grants.entries) || grants.inspectedCount !== grants.entries.length
    || grants.pendingUninspected !== 0
    || grants.providerPaymentIndependentlyRechecked !== false
    || grants.buyerReceiptIndependentlyVerified !== false
    || !Array.isArray(evidence)) fail('invalid_input_contract');
  const sales = new Map();
  for (const row of fulfillment.entries) {
    if (!hex.test(row?.eventDigest ?? '') || !hex.test(row?.purchaseBinding ?? '')
      || !['queued_for_independent_provider_verification', 'local_provision_marker_awaiting_buyer_receipt', 'no_supported_provisioning_adapter'].includes(row.stage)
      || sales.has(row.eventDigest)) fail('invalid_or_duplicate_sale');
    sales.set(row.eventDigest, row);
  }
  const inspected = new Map();
  for (const row of grants.entries) {
    const sale = sales.get(row?.eventDigest);
    if (!sale || sale.stage !== 'local_provision_marker_awaiting_buyer_receipt'
      || sale.purchaseBinding !== row.purchaseBinding || !hex.test(row.grantId ?? '')
      || inspected.has(row.eventDigest)
      || row.providerPaymentIndependentlyRechecked !== false
      || row.buyerReceiptIndependentlyVerified !== false
      || !['revoked','local_buyer_possession_acknowledged_unverified','awaiting_buyer_possession'].includes(row.status))
      fail('invalid_or_conflicting_grant');
    inspected.set(row.eventDigest, row);
  }
  for (const [id, sale] of sales) {
    if (sale.stage === 'local_provision_marker_awaiting_buyer_receipt' && !inspected.has(id))
      fail('missing_grant_inspection');
  }
  const kinds = ['provider_readback','invoice','quota','delivery_observer','buyer_ack','refund_reconciliation'];
  const refs = new Set();
  for (const row of evidence) {
    if (!row || !hex.test(row.eventDigest ?? '') || !sales.has(row.eventDigest)
      || !kinds.includes(row.kind) || !hex.test(row.digest ?? '')
      || refs.has(row.eventDigest + ':' + row.kind))
      fail('invalid_or_duplicate_evidence_reference');
    refs.add(row.eventDigest + ':' + row.kind);
  }
  const entries = [...sales.values()].sort((a,b)=>a.eventDigest.localeCompare(b.eventDigest)).map(sale => {
    const missing = kinds.filter(kind => !refs.has(sale.eventDigest + ':' + kind));
    return { eventDigest:sale.eventDigest, purchaseBinding:sale.purchaseBinding,
      stage:sale.stage, grantStatus:inspected.get(sale.eventDigest)?.status ?? 'not_inspected',
      evidenceReferencesPresent:kinds.length - missing.length, missingEvidenceReferences:missing,
      accepted:false, reason:'independent_authentication_and_buyer_receipt_not_established' };
  });
  const report = {schema:'savage.commercial.acceptance-readiness.v1',count:entries.length,
    acceptedCount:0,entries,independentProviderAcceptance:false,
    independentBuyerDeliveryAcceptance:false,productionReady:false};
  return {...report,contentFingerprint:sha(JSON.stringify(report))};
}
