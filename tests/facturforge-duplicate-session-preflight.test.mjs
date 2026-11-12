import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PurchaseLedger } from '../api/purchase-ledger.mjs';
import { FACTURFORGE_SKU, provisionPendingFacturForgeSales } from '../scripts/provision-facturforge-purchases.mjs';

test('two signed events for one checkout session fail before any provider command or grant', async t => {
  const root = await mkdtemp(join(tmpdir(), 'facturforge-duplicate-preflight-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = ['sales', 'markers', 'prepaid', 'delivery'].map(name => join(root, name));
  for (const path of paths) await mkdir(path, { mode: 0o700 });
  const [ledger, markers, prepaid, delivery] = paths;
  const offer = {
    accountId: 'acct_offline_preflight', livemode: false,
    paymentLinkId: 'plink_offline_preflight', priceId: 'price_offline_preflight',
    sku: FACTURFORGE_SKU, amountTotal: 1900, currency: 'usd',
    fulfillmentMode: 'manual',
  };
  const purchase = {
    sessionId: 'cs_test_same_purchase', customerEmail: 'buyer@example.invalid',
    sku: FACTURFORGE_SKU, amountTotal: 1900, currency: 'usd',
    accountId: offer.accountId, livemode: false,
    observedAt: '2026-11-06T00:00:00.000Z', fulfillmentMode: 'manual',
  };
  const store = new PurchaseLedger(ledger);
  for (const eventId of ['evt_checkout_complete', 'evt_async_payment_succeeded']) {
    const result = await store.record({ ...purchase, eventId });
    assert.equal(result.recorded, true);
  }
  const cli = join(root, 'must-not-execute.js');
  await writeFile(cli, 'process.exit(17);\n', { mode: 0o600 });
  const env = {
    SAVAGE_STRIPE_PRODUCTS_JSON: JSON.stringify([offer]),
    SAVAGE_PURCHASE_LEDGER_DIR: ledger, SAVAGE_FULFILLMENT_RECEIPT_DIR: markers,
    FACTURFORGE_PREPAID_DIR: prepaid, FACTURFORGE_PRIVATE_DELIVERY_DIR: delivery,
    FACTURFORGE_PROVISION_CLI: cli,
    FACTURFORGE_STRIPE_READ_KEY: 'rk_test_inert_preflight_only',
  };
  await assert.rejects(provisionPendingFacturForgeSales(env), /duplicate_checkout_session_in_queue/);
  assert.deepEqual(await readdir(markers), []);
  assert.equal((await readdir(ledger)).length, 2);
});
