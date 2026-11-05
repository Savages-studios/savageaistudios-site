import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { buildCommercialFulfillmentPlan, dispatchCommercialFulfillment } from '../scripts/dispatch-commerce-fulfillment.mjs';
import { FACTURFORGE_SKU } from '../scripts/provision-facturforge-purchases.mjs';

// These are OFFLINE contract records, not payment-provider responses or sales.
// The tests execute the real dispatch planner and real CLI refusal paths.
const row = (digit, sku, stage) => ({
  eventDigest: digit.repeat(64), purchaseBinding: digit.repeat(64), sku, stage,
});
const report = (entries) => ({
  schema: 'savage.commercial.fulfillment.reconciliation.v1',
  count: entries.length, entries,
  counts: {
    queuedForProviderVerification: entries.filter(x => x.stage === 'queued_for_independent_provider_verification').length,
    localProvisionMarkersAwaitingBuyerReceipt: entries.filter(x => x.stage === 'local_provision_marker_awaiting_buyer_receipt').length,
    noSupportedProvisioningAdapter: entries.filter(x => x.stage === 'no_supported_provisioning_adapter').length,
  },
  independentlyVerifiedProviderPayment: false,
  customerDeliveryVerified: false,
  bankSettlementVerified: false,
});

test('empty real-contract plan does not claim revenue or trigger an adapter', () => {
  const plan = buildCommercialFulfillmentPlan(report([]));
  assert.equal(plan.purchaseCount, 0);
  assert.deepEqual(plan.products, []);
  assert.equal(plan.customerPaymentIndependentlyAccepted, false);
  assert.equal(plan.customerDeliveryVerified, false);
});

test('cross-offer plan separates provider verification, pending buyer receipt and unsupported products', () => {
  const plan = buildCommercialFulfillmentPlan(report([
    row('a', FACTURFORGE_SKU, 'queued_for_independent_provider_verification'),
    row('b', FACTURFORGE_SKU, 'local_provision_marker_awaiting_buyer_receipt'),
    row('c', 'COMM-ENTERPRISE-PRO', 'no_supported_provisioning_adapter'),
  ]));
  assert.equal(plan.purchaseCount, 3);
  assert.equal(plan.queued, 1);
  assert.equal(plan.pendingBuyerReceipt, 1);
  assert.equal(plan.unsupported, 1);
  assert.equal(plan.requiresOperatorReview, true);
  assert.equal(plan.products.find(p => p.sku === 'COMM-ENTERPRISE-PRO').adapter, null);
  assert.equal(plan.products.find(p => p.sku === FACTURFORGE_SKU).adapter, 'facturforge-marketplace-stripe-read');
});

test('unregistered SKU cannot impersonate a provisionable adapter', () => {
  assert.throws(() => buildCommercialFulfillmentPlan(report([
    row('a', 'COMM-ENTERPRISE-PRO', 'queued_for_independent_provider_verification'),
  ])), /unexpected_provisioning_adapter/);
});

test('duplicate sale digest cannot be counted or dispatched twice', () => {
  assert.throws(() => buildCommercialFulfillmentPlan(report([
    row('a', FACTURFORGE_SKU, 'queued_for_independent_provider_verification'),
    row('a', FACTURFORGE_SKU, 'queued_for_independent_provider_verification'),
  ])), /invalid_or_duplicate_reconciliation_entry/);
});

test('tampered reconciliation counts fail closed', () => {
  const input = report([row('a', FACTURFORGE_SKU, 'queued_for_independent_provider_verification')]);
  input.counts.queuedForProviderVerification = 0;
  assert.throws(() => buildCommercialFulfillmentPlan(input), /reconciliation_counts_mismatch/);
});

test('reconciliation cannot assert independent customer or bank acceptance', () => {
  const input = report([]);
  input.customerDeliveryVerified = true;
  assert.throws(() => buildCommercialFulfillmentPlan(input), /invalid_reconciliation_contract/);
  input.customerDeliveryVerified = false;
  input.independentlyVerifiedProviderPayment = true;
  assert.throws(() => buildCommercialFulfillmentPlan(input), /invalid_reconciliation_contract/);
});

test('untrusted or malformed row fails before any external adapter', () => {
  const input = report([row('a', FACTURFORGE_SKU, 'queued_for_independent_provider_verification')]);
  input.entries[0].eventDigest = '../escape';
  assert.throws(() => buildCommercialFulfillmentPlan(input), /invalid_or_duplicate_reconciliation_entry/);
});

test('operator CLI rejects unsupported arguments without touching provider', () => {
  const cli = fileURLToPath(new URL('../scripts/dispatch-commerce-fulfillment.mjs', import.meta.url));
  const run = spawnSync(process.execPath, [cli, '--charge'], {
    encoding: 'utf8', env: { PATH: process.env.PATH ?? '' },
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Usage: npm run dispatch:commerce/);
  assert.equal(run.stdout, '');
});

test('actual plan command refuses absent trusted catalog without a provider call', () => {
  const cli = fileURLToPath(new URL('../scripts/dispatch-commerce-fulfillment.mjs', import.meta.url));
  const run = spawnSync(process.execPath, [cli, '--plan'], {
    encoding: 'utf8', env: { PATH: process.env.PATH ?? '' },
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Commercial dispatch refused/);
  assert.equal(run.stdout, '');
});

test('actual execute entrypoint refuses missing catalog before provider or grant', async () => {
  await assert.rejects(
    dispatchCommercialFulfillment({ SAVAGE_ALLOW_EXISTING_PAYMENT_FULFILLMENT: 'YES' }, { execute: true }),
    /commercial_reconciliation:trusted_offer_catalog_invalid/,
  );
});
