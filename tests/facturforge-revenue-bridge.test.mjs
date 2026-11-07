import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PurchaseLedger } from '../api/purchase-ledger.mjs';
import {
  FACTURFORGE_SKU, verifyQueuedFacturForgePurchase, provisionPendingFacturForgeSales,
} from '../scripts/provision-facturforge-purchases.mjs';

const offer = Object.freeze({
  accountId: 'acct_offline_bridge', livemode: false,
  paymentLinkId: 'plink_offline_bridge', priceId: 'price_offline_bridge',
  sku: FACTURFORGE_SKU, amountTotal: 1900, currency: 'usd',
  fulfillmentMode: 'manual',
});
const purchase = {
  eventId: 'evt_offline_bridge', sessionId: 'cs_test_offline_bridge',
  customerEmail: 'buyer@example.invalid', sku: FACTURFORGE_SKU,
  amountTotal: 1900, currency: 'usd', accountId: offer.accountId,
  livemode: false, observedAt: '2026-11-02T00:00:00.000Z',
  fulfillmentMode: 'manual',
};

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'savage-revenue-bridge-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ledger = join(root, 'sales');
  const markers = join(root, 'provision-markers');
  const prepaid = join(root, 'prepaid');
  const delivery = join(root, 'private-delivery');
  for (const path of [ledger, markers, prepaid, delivery])
    await mkdir(path, { mode: 0o700 });
  const outcome = await new PurchaseLedger(ledger).record(purchase);
  assert.equal(outcome.recorded, true, 'a real local atomic sale+queue file is created');
  const filename = createHash('sha256').update(purchase.eventId).digest('hex') + '.json';
  const cli = join(root, 'reject-cli.js');
  // A real child process exits unsuccessfully; it never pretends to be Stripe.
  await writeFile(cli, 'process.exit(9);\n', { mode: 0o600 });
  const env = {
    SAVAGE_STRIPE_PRODUCTS_JSON: JSON.stringify([offer]),
    SAVAGE_PURCHASE_LEDGER_DIR: ledger,
    SAVAGE_FULFILLMENT_RECEIPT_DIR: markers,
    FACTURFORGE_PREPAID_DIR: prepaid,
    FACTURFORGE_PRIVATE_DELIVERY_DIR: delivery,
    FACTURFORGE_PROVISION_CLI: cli,
    FACTURFORGE_STRIPE_READ_KEY: 'rk_test_inert_local_child_exit_only',
  };
  return { ledger, markers, filename, outcome, env };
}

test('actual atomic sale queue is bound to exact configured FacturForge purchase terms', async t => {
  const { ledger, filename } = await setup(t);
  const row = JSON.parse(await readFile(join(ledger, filename), 'utf8'));
  const identity = verifyQueuedFacturForgePurchase(row, filename, offer);
  assert.equal(identity.sessionId, purchase.sessionId);
  assert.equal(identity.customerEmail, purchase.customerEmail);
  for (const mutation of [
    { sale: { ...row.sale, amountTotal: 1901 } },
    { sale: { ...row.sale, buyerEmail: 'other@example.invalid' } },
    { fulfillment: { ...row.fulfillment, status: 'delivered' } },
    { purchaseBinding: '0'.repeat(64) },
  ]) {
    assert.throws(() => verifyQueuedFacturForgePurchase(
      { ...row, ...mutation }, filename, offer), /facturforge_revenue_bridge:/);
  }
  assert.throws(() => verifyQueuedFacturForgePurchase(row, 'other.json', offer));
});

test('missing authenticated provider configuration cannot start provisioning or mark delivery', async t => {
  const { markers, env } = await setup(t);
  await assert.rejects(provisionPendingFacturForgeSales({
    ...env, FACTURFORGE_STRIPE_READ_KEY: '',
  }), /provider_read_key_missing_or_wrong_mode/);
  assert.deepEqual(await readdir(markers), []);
});

test('real failed child process never marks an offline queue as paid, provisioned or delivered', async t => {
  const { markers, env } = await setup(t);
  await assert.rejects(provisionPendingFacturForgeSales(env),
    /authenticated_marketplace_provisioning_failed/);
  const files = await readdir(markers);
  assert.equal(files.length, 1);
  assert.match(files[0], /^session-[a-f0-9]{64}\\.claim$/);
  const claim = JSON.parse(await readFile(join(markers, files[0]), 'utf8'));
  assert.equal(claim.checkoutSessionId, purchase.sessionId);
  assert.equal(claim.eventId, purchase.eventId);
  // A failed external call may have committed a grant. Never automatically retry.
  await assert.rejects(provisionPendingFacturForgeSales(env),
    /checkout_session_claim_requires_reconciliation/);
  assert.deepEqual(await readdir(markers), files);
});

test('conflicting persisted marker fails closed without invoking the provider command', async t => {
  const { markers, filename, env } = await setup(t);
  await writeFile(join(markers, filename), JSON.stringify({
    schema: 'savage.facturforge.provision.v1',
    eventId: purchase.eventId,
    purchaseBinding: '0'.repeat(64),
    checkoutSessionId: purchase.sessionId,
    status: 'provisioned_pending_buyer_receipt',
    grantId: 'a'.repeat(64),
  }), { mode: 0o600 });
  await assert.rejects(provisionPendingFacturForgeSales(env),
    /existing_marker_conflicts_with_purchase/);
});

test('only the verified fixed-price FacturForge SKU is eligible for this revenue bridge', async t => {
  const { env, markers } = await setup(t);
  const other = { ...offer, amountTotal: 1901 };
  await assert.rejects(provisionPendingFacturForgeSales({
    ...env, SAVAGE_STRIPE_PRODUCTS_JSON: JSON.stringify([other]),
  }), /facturforge_offer_not_configured/);
  assert.deepEqual(await readdir(markers), []);
});
