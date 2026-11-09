import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildCommercialFulfillmentPlan } from '../scripts/dispatch-commerce-fulfillment.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
function signedReport(entries = []) {
  const counts = {
    queuedForProviderVerification: entries.filter(x => x.stage === 'queued_for_independent_provider_verification').length,
    localProvisionMarkersAwaitingBuyerReceipt: entries.filter(x => x.stage === 'local_provision_marker_awaiting_buyer_receipt').length,
    noSupportedProvisioningAdapter: entries.filter(x => x.stage === 'no_supported_provisioning_adapter').length,
  };
  const report = {
    schema: 'savage.commercial.fulfillment.reconciliation.v1',
    count: entries.length, counts, entries,
    independentlyVerifiedProviderPayment: false,
    customerDeliveryVerified: false,
    bankSettlementVerified: false,
  };
  return { ...report, contentFingerprint: digest(JSON.stringify(report)) };
}
const entry = {
  eventDigest: 'a'.repeat(64), purchaseBinding: 'b'.repeat(64),
  sku: 'other-product', stage: 'no_supported_provisioning_adapter',
};
test('intact reconciliation snapshot yields read-only plan', () => {
  const plan = buildCommercialFulfillmentPlan(signedReport([entry]));
  assert.equal(plan.purchaseCount, 1);
  assert.equal(plan.unsupported, 1);
  assert.equal(plan.customerPaymentIndependentlyAccepted, false);
});
test('changed SKU after fingerprint generation is rejected', () => {
  const report = signedReport([entry]);
  report.entries[0] = { ...entry, sku: 'different-product' };
  assert.throws(() => buildCommercialFulfillmentPlan(report), /reconciliation_fingerprint_mismatch/);
});
test('changed stage and recalculated counts without new fingerprint are rejected', () => {
  const report = signedReport([entry]);
  report.entries[0] = { ...entry, stage: 'queued_for_independent_provider_verification' };
  report.counts.queuedForProviderVerification = 1;
  report.counts.noSupportedProvisioningAdapter = 0;
  assert.throws(() => buildCommercialFulfillmentPlan(report), /reconciliation_fingerprint_mismatch/);
});
test('missing or malformed fingerprint fails closed', () => {
  const report = signedReport();
  delete report.contentFingerprint;
  assert.throws(() => buildCommercialFulfillmentPlan(report), /reconciliation_fingerprint_mismatch/);
  report.contentFingerprint = 'f'.repeat(63);
  assert.throws(() => buildCommercialFulfillmentPlan(report), /reconciliation_fingerprint_mismatch/);
});
test('fingerprint is not authentication: internally consistent unsupported entries stay unsupported', () => {
  const report = signedReport([entry]);
  const plan = buildCommercialFulfillmentPlan(report);
  assert.equal(plan.queued, 0);
  assert.equal(plan.requiresOperatorReview, true);
});
