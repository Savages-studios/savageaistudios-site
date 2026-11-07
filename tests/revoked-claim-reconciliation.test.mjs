import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PurchaseLedger } from '../api/purchase-ledger.mjs';
import { reconcileCommercialFulfillment } from '../scripts/audit-commerce-pipeline.mjs';

const sha = s => createHash('sha256').update(s).digest('hex');
const offer = { accountId: 'acct_test_commerce', livemode: false,
  paymentLinkId: 'plink_test_commerce', priceId: 'price_test_commerce',
  sku: 'facturforge-test', amountTotal: 2500, currency: 'usd', fulfillmentMode: 'manual' };

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'claim-reconcile-'));
  const ledger = join(root, 'ledger'), markers = join(root, 'markers');
  await mkdir(ledger, { mode: 0o700 });
  await mkdir(markers, { mode: 0o700 });
  const purchase = { eventId: 'evt_claim_reconcile', sessionId: 'cs_test_claim_reconcile',
    customerEmail: 'buyer@example.invalid', sku: offer.sku, amountTotal: offer.amountTotal,
    currency: offer.currency, accountId: offer.accountId, livemode: false,
    fulfillmentMode: 'manual', observedAt: new Date().toISOString() };
  await new PurchaseLedger(ledger).record(purchase);
  const claimPath = join(ledger, sha('test:' + purchase.sessionId) + '.claim');
  const env = { SAVAGE_PURCHASE_LEDGER_DIR: ledger, SAVAGE_FULFILLMENT_RECEIPT_DIR: markers,
    SAVAGE_STRIPE_PRODUCTS_JSON: JSON.stringify([offer]) };
  return { root, env, claimPath, salePath: join(ledger, sha(purchase.eventId) + '.json') };
}

test('fulfilled checkout is visible to reconciliation', async () => {
  const f = await fixture();
  try {
    const result = await reconcileCommercialFulfillment(f.env);
    assert.equal(result.count, 1);
    assert.equal(result.entries.length, 1);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('revoked checkout cannot reenter provisioning queue', async () => {
  const f = await fixture();
  try {
    const claim = JSON.parse(await readFile(f.claimPath, 'utf8'));
    claim.state = 'revoked';
    claim.revocationEventId = 'evt_refund_claim_reconcile';
    claim.revocationReason = 'charge.refunded';
    claim.revokedAtMs = Date.now();
    claim.revokedAt = new Date(claim.revokedAtMs).toISOString();
    await writeFile(f.claimPath, JSON.stringify(claim), { mode: 0o600 });
    const row = JSON.parse(await readFile(f.salePath, 'utf8'));
    row.fulfillment.status = 'revoked';
    row.revocation = { eventId: claim.revocationEventId, reason: claim.revocationReason };
    await writeFile(f.salePath, JSON.stringify(row), { mode: 0o600 });
    await assert.rejects(reconcileCommercialFulfillment(f.env),
      /revoked_checkout_must_not_be_reprovisioned/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('conflicting checkout claim cannot authorize a different sale', async () => {
  const f = await fixture();
  try {
    const claim = JSON.parse(await readFile(f.claimPath, 'utf8'));
    claim.eventId = 'evt_wrong_purchase';
    await writeFile(f.claimPath, JSON.stringify(claim), { mode: 0o600 });
    await assert.rejects(reconcileCommercialFulfillment(f.env), /sale_checkout_claim_conflict/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});


test('revoked sale without matching durable claim fails closed', async () => {
  const f = await fixture();
  try {
    const row = JSON.parse(await readFile(f.salePath, 'utf8'));
    row.fulfillment.status = 'revoked';
    await writeFile(f.salePath, JSON.stringify(row), { mode: 0o600 });
    await assert.rejects(reconcileCommercialFulfillment(f.env),
      /revoked_sale_without_matching_claim/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
