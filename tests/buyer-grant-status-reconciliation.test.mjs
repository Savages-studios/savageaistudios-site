/** Offline local sale/marker tests, not payment or buyer receipt simulations. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PurchaseLedger } from '../api/purchase-ledger.mjs';
import { FACTURFORGE_SKU } from '../scripts/provision-facturforge-purchases.mjs';
import {
  validateMarketplaceGrantStatus, reconcileBuyerGrantStatus,
} from '../scripts/reconcile-buyer-grant-status.mjs';

const grantId = 'a'.repeat(64);
const digest = value => createHash('sha256').update(value).digest('hex');
const localStatus = (changes = {}) => ({
  schema: 'savage.facturforge.commercial-grant-status.v1',
  grantId, product: FACTURFORGE_SKU, revoked: false,
  used: 0, allowance: 100, remaining: 100,
  buyerPossessionAcknowledgedInLocalLedger: false,
  paymentEvidenceMethodInLocalLedger: 'test-fixture',
  providerPaymentIndependentlyRechecked: false,
  buyerReceiptIndependentlyVerified: false, ...changes,
});
const offer = {
  accountId: 'acct_offline_buyer_grants', livemode: false,
  paymentLinkId: 'plink_offline_buyer_grants',
  priceId: 'price_offline_buyer_grants',
  sku: FACTURFORGE_SKU, amountTotal: 1900, currency: 'usd',
  fulfillmentMode: 'manual',
};

async function setup(t, marker = false) {
  const root = await mkdtemp(join(tmpdir(), 'buyer-grant-site-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ledger = join(root, 'sales');
  const markers = join(root, 'markers');
  await mkdir(ledger, { mode: 0o700 });
  await mkdir(markers, { mode: 0o700 });
  const purchase = {
    eventId: 'evt_offline_buyer_grant', sessionId: 'cs_test_offline_buyer_grant',
    customerEmail: 'offline@example.invalid', sku: FACTURFORGE_SKU,
    amountTotal: 1900, currency: 'usd', accountId: offer.accountId,
    livemode: false, observedAt: '2026-11-02T00:00:00Z',
    fulfillmentMode: 'manual',
  };
  const saved = await new PurchaseLedger(ledger).record(purchase);
  if (marker) await writeFile(join(markers, digest(purchase.eventId) + '.json'), JSON.stringify({
    schema: 'savage.facturforge.provision.v1',
    eventId: purchase.eventId, purchaseBinding: saved.row.purchaseBinding,
    checkoutSessionId: purchase.sessionId, grantId,
    status: 'provisioned_pending_buyer_receipt', customerNotified: false,
  }), { mode: 0o600 });
  return {
    env: {
      SAVAGE_PURCHASE_LEDGER_DIR: ledger,
      SAVAGE_FULFILLMENT_RECEIPT_DIR: markers,
      SAVAGE_STRIPE_PRODUCTS_JSON: JSON.stringify([offer]),
    },
  };
}

test('strict Marketplace status parser preserves local-only proof boundary', () => {
  const result = validateMarketplaceGrantStatus(localStatus(), grantId);
  assert.equal(result.status, 'awaiting_buyer_possession');
  assert.equal(result.localPaymentEvidenceMethod, 'test-fixture');
  assert.equal(result.providerPaymentIndependentlyRechecked, false);
  assert.equal(result.buyerReceiptIndependentlyVerified, false);
  assert.equal(JSON.stringify(result).includes('offline@example.invalid'), false);
});

test('local acknowledgment and quota debit remain unverified, revocation takes precedence', () => {
  const ack = validateMarketplaceGrantStatus(localStatus({
    used: 1, remaining: 99, buyerPossessionAcknowledgedInLocalLedger: true,
  }), grantId);
  assert.equal(ack.status, 'local_buyer_possession_acknowledged_unverified');
  assert.equal(ack.remaining, 99);
  assert.equal(ack.buyerReceiptIndependentlyVerified, false);
  const revoked = validateMarketplaceGrantStatus(localStatus({
    revoked: true, buyerPossessionAcknowledgedInLocalLedger: true,
  }), grantId);
  assert.equal(revoked.status, 'revoked');
});

test('forged success flags, extra secrets, wrong grant and inconsistent quota fail closed', () => {
  for (const changed of [
    { providerPaymentIndependentlyRechecked: true },
    { buyerReceiptIndependentlyVerified: true },
    { customerCredential: 'must-not-leak' },
    { grantId: 'b'.repeat(64) },
    { used: 3, remaining: 99 },
    { paymentEvidenceMethodInLocalLedger: 'invented-provider' },
  ]) assert.throws(() => validateMarketplaceGrantStatus(localStatus(changed), grantId),
    /invalid_marketplace_grant_status/);
});

test('actual unprovisioned sale returns no inspected grants and no fabricated payment', async t => {
  const { env } = await setup(t);
  const report = await reconcileBuyerGrantStatus(env);
  assert.equal(report.inspectedCount, 0);
  assert.deepEqual(report.entries, []);
  assert.equal(report.providerPaymentIndependentlyRechecked, false);
  assert.equal(report.buyerReceiptIndependentlyVerified, false);
});

test('actual local provision marker requires the compiled Marketplace CLI and grant directory', async t => {
  const { env } = await setup(t, true);
  await assert.rejects(reconcileBuyerGrantStatus(env),
    /compiled_marketplace_status_cli_and_private_grants_required/);
});

test('operator CLI refuses missing trusted sale configuration without provider access', () => {
  const cli = fileURLToPath(new URL('../scripts/reconcile-buyer-grant-status.mjs', import.meta.url));
  const run = spawnSync(process.execPath, [cli], {
    encoding: 'utf8', env: { PATH: process.env.PATH ?? '' },
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Buyer grant reconciliation refused/);
  assert.equal(run.stdout, '');
});
