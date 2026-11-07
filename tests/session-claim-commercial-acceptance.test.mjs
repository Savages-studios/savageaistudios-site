#!/usr/bin/env node
/** Offline adversarial acceptance for the REAL durable purchase ledger.
 * No provider, customer, Marketplace, payment, or production operation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PurchaseLedger } from '../api/purchase-ledger.mjs';

const purchase = (eventId, overrides = {}) => ({
  eventId, sessionId: 'cs_test_acceptance_001',
  customerEmail: 'offline-buyer@example.invalid',
  sku: 'facturforge-prepaid-100',
  amountTotal: 1000, currency: 'usd',
  accountId: 'acct_offline_acceptance', livemode: false,
  fulfillmentMode: 'manual',
  observedAt: '2026-11-07T00:00:00Z',
  ...overrides,
});

async function withLedger(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'savage-session-acceptance-'));
  try { await fn(new PurchaseLedger(dir), dir); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

test('one checkout session cannot yield two fulfilled sale records across distinct provider events', async () => {
  await withLedger(async (ledger, dir) => {
    const first = await ledger.record(purchase('evt_acceptance_a'));
    assert.equal(first.recorded, true);
    const second = await ledger.record(purchase('evt_acceptance_b'));
    assert.equal(second.recorded, false);
    assert.equal(second.duplicate, true);
    const files = await readdir(dir);
    assert.equal(files.filter(name => /^[a-f0-9]{64}\\.json$/.test(name)).length, 1);
    assert.equal(files.filter(name => /^[a-f0-9]{64}\\.claim$/.test(name)).length, 1);
  });
});

test('re-signed identical event replay does not create a second sale', async () => {
  await withLedger(async ledger => {
    const original = await ledger.record(purchase('evt_acceptance_replay'));
    const replay = await ledger.record(purchase('evt_acceptance_replay', {
      observedAt: '2026-11-07T01:00:00Z',
    }));
    assert.equal(original.recorded, true);
    assert.equal(replay.recorded, false);
    assert.equal(replay.duplicate, true);
    assert.equal(replay.row.purchaseBinding, original.row.purchaseBinding);
  });
});

test('same event identity cannot be rebound to another buyer', async () => {
  await withLedger(async ledger => {
    await ledger.record(purchase('evt_acceptance_buyer'));
    await assert.rejects(
      ledger.record(purchase('evt_acceptance_buyer', {
        customerEmail: 'different-buyer@example.invalid',
      })),
      /conflicting|corrupt/i,
    );
  });
});

test('same event identity cannot be rebound to another provider account', async () => {
  await withLedger(async ledger => {
    await ledger.record(purchase('evt_acceptance_account'));
    await assert.rejects(
      ledger.record(purchase('evt_acceptance_account', {
        accountId: 'acct_other_offline',
      })),
      /conflicting|corrupt/i,
    );
  });
});

test('invalid live-mode session fails without a sale or claim', async () => {
  await withLedger(async (ledger, dir) => {
    await assert.rejects(
      ledger.record(purchase('evt_acceptance_mode', { livemode: true })),
      /invalid checkout session ID/i,
    );
    assert.deepEqual((await readdir(dir)).filter(name => /\\.(json|claim)$/.test(name)), []);
  });
});
