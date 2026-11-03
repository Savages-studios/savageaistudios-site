import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PurchaseLedger } from '../api/purchase-ledger.mjs';
import { FACTURFORGE_SKU } from '../scripts/provision-facturforge-purchases.mjs';
import { reconcileCommercialFulfillment } from '../scripts/audit-commerce-pipeline.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const offer = {
  accountId: 'acct_offline_audit', livemode: false,
  paymentLinkId: 'plink_offline_audit', priceId: 'price_offline_audit',
  sku: FACTURFORGE_SKU, amountTotal: 1900, currency: 'usd',
  fulfillmentMode: 'manual',
};
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'commerce-reconcile-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ledger = join(root, 'sales');
  const markers = join(root, 'markers');
  await mkdir(ledger, { mode: 0o700 });
  await mkdir(markers, { mode: 0o700 });
  const purchase = {
    eventId: 'evt_offline_reconciliation', sessionId: 'cs_test_offline_reconciliation',
    customerEmail: 'offline@example.invalid', sku: FACTURFORGE_SKU,
    amountTotal: 1900, currency: 'usd', accountId: offer.accountId,
    livemode: false, observedAt: '2026-11-02T00:00:00Z',
    fulfillmentMode: 'manual',
  };
  const saved = await new PurchaseLedger(ledger).record(purchase);
  const name = digest(purchase.eventId) + '.json';
  const env = {
    SAVAGE_PURCHASE_LEDGER_DIR: ledger,
    SAVAGE_FULFILLMENT_RECEIPT_DIR: markers,
    SAVAGE_STRIPE_PRODUCTS_JSON: JSON.stringify([offer]),
  };
  return { root, ledger, markers, purchase, saved, name, env };
}

test('real persisted sale is queued, not called paid, delivered or settled', async t => {
  const { env } = await setup(t);
  const report = await reconcileCommercialFulfillment(env);
  assert.equal(report.count, 1);
  assert.equal(report.counts.queuedForProviderVerification, 1);
  assert.equal(report.entries[0].stage, 'queued_for_independent_provider_verification');
  assert.equal(report.independentlyVerifiedProviderPayment, false);
  assert.equal(report.customerDeliveryVerified, false);
  assert.equal(report.bankSettlementVerified, false);
  assert.match(report.contentFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(report).includes('offline@example.invalid'), false);
  assert.deepEqual(report, await reconcileCommercialFulfillment(env));
});

test('existing local marker is reported only as awaiting buyer receipt, never as delivery', async t => {
  const { markers, name, saved, purchase, env } = await setup(t);
  await writeFile(join(markers, name), JSON.stringify({
    schema: 'savage.facturforge.provision.v1',
    eventId: purchase.eventId, purchaseBinding: saved.row.purchaseBinding,
    checkoutSessionId: purchase.sessionId, grantId: 'a'.repeat(64),
    status: 'provisioned_pending_buyer_receipt', customerNotified: false,
  }), { mode: 0o600 });
  const report = await reconcileCommercialFulfillment(env);
  assert.equal(report.counts.localProvisionMarkersAwaitingBuyerReceipt, 1);
  assert.equal(report.counts.queuedForProviderVerification, 0);
  assert.equal(report.customerDeliveryVerified, false);
});

test('marker contradicting purchase binding is rejected, not counted', async t => {
  const { markers, name, purchase, env } = await setup(t);
  await writeFile(join(markers, name), JSON.stringify({
    schema: 'savage.facturforge.provision.v1',
    eventId: purchase.eventId, purchaseBinding: '0'.repeat(64),
    checkoutSessionId: purchase.sessionId, grantId: 'a'.repeat(64),
    status: 'provisioned_pending_buyer_receipt', customerNotified: false,
  }), { mode: 0o600 });
  await assert.rejects(reconcileCommercialFulfillment(env), /invalid_or_conflicting_provision_marker/);
});

test('orphan marker is rejected instead of counted as fulfillment', async t => {
  const { markers, env } = await setup(t);
  await writeFile(join(markers, 'b'.repeat(64) + '.json'), '{}', { mode: 0o600 });
  await assert.rejects(reconcileCommercialFulfillment(env), /orphan_or_unexpected_provision_marker/);
});

test('tampered sale binding and mismatched trusted offer terms fail closed', async t => {
  const { ledger, name, env } = await setup(t);
  const path = join(ledger, name);
  const row = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...row, purchaseBinding: '0'.repeat(64) }), { mode: 0o600 });
  await assert.rejects(reconcileCommercialFulfillment(env), /sale_binding_mismatch/);
  await writeFile(path, JSON.stringify(row), { mode: 0o600 });
  const mismatched = { ...offer, amountTotal: 2000 };
  await assert.rejects(reconcileCommercialFulfillment({
    ...env, SAVAGE_STRIPE_PRODUCTS_JSON: JSON.stringify([mismatched]),
  }), /trusted_offer_terms_mismatch/);
});

test('unknown real queue SKU is surfaced as unsupported, not routed to FacturForge', async t => {
  const { ledger, env } = await setup(t);
  const other = {
    eventId: 'evt_offline_other_product', sessionId: 'cs_test_offline_other',
    customerEmail: 'another@example.invalid', sku: 'OTHER-PRODUCT',
    amountTotal: 4900, currency: 'usd', accountId: offer.accountId,
    livemode: false, observedAt: '2026-11-02T00:00:00Z',
    fulfillmentMode: 'manual',
  };
  await new PurchaseLedger(ledger).record(other);
  const report = await reconcileCommercialFulfillment(env);
  assert.equal(report.count, 2);
  assert.equal(report.counts.noSupportedProvisioningAdapter, 1);
  assert.equal(report.entries.find(x => x.sku === other.sku).stage,
    'no_supported_provisioning_adapter');
});

test('duplicate trusted SKUs and missing private roots fail before reporting', async t => {
  const { env } = await setup(t);
  await assert.rejects(reconcileCommercialFulfillment({
    ...env, SAVAGE_STRIPE_PRODUCTS_JSON: JSON.stringify([
      offer, { ...offer, paymentLinkId: 'plink_offline_second' },
    ]),
  }), /duplicate_trusted_sku/);
  await assert.rejects(reconcileCommercialFulfillment({
    ...env, SAVAGE_FULFILLMENT_RECEIPT_DIR: '/not/a/private/known/path',
  }));
});

test('operator CLI executes read-only and emits non-PII machine-readable report', async t => {
  const { env } = await setup(t);
  const stdout = execFileSync(process.execPath,
    ['scripts/audit-commerce-pipeline.mjs'], {
      cwd: process.cwd(), env: { ...process.env, ...env },
      encoding: 'utf8', timeout: 15000,
    });
  const report = JSON.parse(stdout);
  assert.equal(report.count, 1);
  assert.equal(report.customerDeliveryVerified, false);
  assert.equal(stdout.includes('offline@example.invalid'), false);
});
