import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessCommercialLifecycle } from '../scripts/reconcile-commercial-lifecycle.mjs';

// Offline contract tests. These are not Stripe responses or real customer receipts.
const h = x => x.repeat(64);
const sale = (id, stage = 'local_provision_marker_awaiting_buyer_receipt') =>
  ({ eventDigest: h(id), purchaseBinding: h(id), sku: 'COMM-20260908-MARKETPLACE-FACTURFORGE-PACK100', stage });
const sales = entries => ({
  schema: 'savage.commercial.fulfillment.reconciliation.v1', entries, count: entries.length,
  independentlyVerifiedProviderPayment: false, customerDeliveryVerified: false, bankSettlementVerified: false,
});
const grant = (id, status = 'awaiting_buyer_possession') => ({
  eventDigest: h(id), purchaseBinding: h(id), grantId: h(id === 'a' ? '1' : '2'),
  status, used: 4, remaining: 96,
  providerPaymentIndependentlyRechecked: false, buyerReceiptIndependentlyVerified: false,
});
const grants = entries => ({
  schema: 'savage.commercial.buyer-grant-reconciliation.v1', entries,
  inspectedCount: entries.length, pendingUninspected: 0,
  providerPaymentIndependentlyRechecked: false, buyerReceiptIndependentlyVerified: false,
});
test('valid local grant remains commercially unaccepted', () => {
  const result = assessCommercialLifecycle(sales([sale('a')]), grants([grant('a')]));
  assert.equal(result.acceptedCustomerTransactions, 0);
  assert.equal(result.entries[0].accepted, false);
  assert.ok(result.entries[0].blockers.includes('independent_buyer_delivery_receipt_missing'));
  assert.ok(result.entries[0].blockers.includes('invoice_and_quota_reconciliation_missing'));
});
test('local buyer acknowledgment is not external receipt', () => {
  const result = assessCommercialLifecycle(sales([sale('a')]), grants([grant('a', 'local_buyer_possession_acknowledged_unverified')]));
  assert.equal(result.independentlyObservedBuyerDelivery, false);
});
test('missing grant inspection rejects entire report', () => {
  assert.throws(() => assessCommercialLifecycle(sales([sale('a')]), grants([])), /uninspected_provisioned_sale/);
});
test('orphaned grant rejected', () => {
  assert.throws(() => assessCommercialLifecycle(sales([]), grants([grant('a')])), /orphaned_or_conflicting_grant/);
});
test('grant binding mismatch rejected', () => {
  const g = grant('a'); g.purchaseBinding = h('b');
  assert.throws(() => assessCommercialLifecycle(sales([sale('a')]), grants([g])), /orphaned_or_conflicting_grant/);
});
test('duplicate grant identity across sales rejected', () => {
  const g = grant('b'); g.grantId = h('1');
  assert.throws(() => assessCommercialLifecycle(sales([sale('a'), sale('b')]), grants([grant('a'), g])), /orphaned_or_conflicting_grant/);
});
test('invalid quota accounting rejected', () => {
  const g = grant('a'); g.remaining = 97;
  assert.throws(() => assessCommercialLifecycle(sales([sale('a')]), grants([g])), /orphaned_or_conflicting_grant/);
});
test('provider receipt assertions cannot be smuggled into input', () => {
  const g = grant('a'); g.providerPaymentIndependentlyRechecked = true;
  assert.throws(() => assessCommercialLifecycle(sales([sale('a')]), grants([g])), /orphaned_or_conflicting_grant/);
});
test('unsupported product remains blocked and cannot claim a grant', () => {
  const result = assessCommercialLifecycle(sales([sale('a', 'no_supported_provisioning_adapter')]), grants([]));
  assert.ok(result.entries[0].blockers.includes('unsupported_product'));
});
test('revoked grant cannot be marked accepted', () => {
  const result = assessCommercialLifecycle(sales([sale('a')]), grants([grant('a', 'revoked')]));
  assert.ok(result.entries[0].blockers.includes('grant_revoked'));
});
