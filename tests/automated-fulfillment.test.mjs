import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AutomatedFulfillment,
  CaptureEmailSender,
  DeliveryLog,
  HttpEmailSender,
  recipientDomainHash
} from '../api/fulfillment.mjs';
import {
  AUTOMATED_FULFILLMENT_MANIFEST,
  COLORING_BOOK_FILES,
  HELD_FULFILLMENT_SKUS
} from '../api/fulfillment-manifest.mjs';
import { createStripeWebhookRoute } from '../api/stripe-webhook.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const HONEY_SKU = 'COMM-20260908-MARKETPLACE-BASSO-AND-THE-HONEY-BEES-COLORING-BOOK-9';
const PACK_SKU = 'FIXTURE-DIGITAL-PACK';
const HELD_SKU = 'COMM-20260908-MARKETPLACE-FACTURFORGE-PRO-PACK-49';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'savage-automated-fulfillment-'));
  const goods = join(root, 'goods');
  const logDirectory = join(root, 'delivery-log');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(goods, { recursive: true }));
  t.after(() => rm(root, { recursive: true, force: true }));

  const honey = Buffer.from('%PDF-fixture-honey-book');
  const pack = Buffer.from('fixture digital pack archive bytes');
  const license = Buffer.from('fixture license and setup notes');
  await writeFile(join(goods, 'glitch-honey-book.pdf'), honey);
  await writeFile(join(goods, 'fixture-pack.zip'), pack);
  await writeFile(join(goods, 'fixture-license.txt'), license);

  const manifest = [
    {
      sku: HONEY_SKU,
      productName: 'Basso and the Honey Bees — Coloring Book',
      deliverables: [{
        path: 'glitch-honey-book.pdf', sha256: sha256(honey), bytes: honey.length,
        contentType: 'application/pdf', filename: 'glitch-honey-book.pdf'
      }]
    },
    {
      sku: PACK_SKU,
      productName: 'Fixture Digital Pack',
      deliverables: [
        {
          path: 'fixture-pack.zip', sha256: sha256(pack), bytes: pack.length,
          contentType: 'application/zip', filename: 'fixture-pack.zip'
        },
        {
          path: 'fixture-license.txt', sha256: sha256(license), bytes: license.length,
          contentType: 'text/plain', filename: 'fixture-license.txt'
        }
      ]
    }
  ];
  const sender = new CaptureEmailSender();
  const deliveryLog = new DeliveryLog(logDirectory);
  const fulfillment = new AutomatedFulfillment({
    manifest, goodsDirectory: goods, deliveryLog, sender,
    heldSkus: HELD_FULFILLMENT_SKUS
  });
  return { root, goods, logDirectory, honey, pack, license, sender, deliveryLog, fulfillment };
}

const purchase = (overrides = {}) => ({
  eventId: 'evt_fixture_delivery',
  sessionId: 'cs_test_fixture_delivery',
  customerEmail: 'buyer@example.invalid',
  sku: HONEY_SKU,
  amountTotal: 900,
  currency: 'usd',
  accountId: 'acct_fixture',
  livemode: false,
  observedAt: '2026-11-09T00:00:00.000Z',
  fulfillmentMode: 'automated',
  paymentIntentId: 'pi_fixture_delivery',
  ...overrides
});

test('production manifest is hash-declared, bundle-complete and excludes held SKUs', () => {
  const bySku = new Map(AUTOMATED_FULFILLMENT_MANIFEST.map((entry) => [entry.sku, entry]));
  assert.equal(bySku.get(HONEY_SKU).deliverables[0].sha256, COLORING_BOOK_FILES.honey.sha256);
  assert.equal(bySku.get('COLORING-BOOKS-BUNDLE-29').deliverables.length, 5);
  for (const held of HELD_FULFILLMENT_SKUS) assert.equal(bySku.has(held), false);
  for (const entry of AUTOMATED_FULFILLMENT_MANIFEST) {
    for (const file of entry.deliverables) assert.match(file.sha256, /^[a-f0-9]{64}$/);
  }
});

test('PDF good happy path sends one captured email and writes a private hash-chained log', async (t) => {
  const f = await fixture(t);
  const result = await f.fulfillment.fulfill(purchase());
  assert.equal(result.status, 'delivered');
  assert.equal(result.duplicate, false);
  assert.equal(f.sender.messages.length, 1);
  assert.equal(f.sender.messages[0].to, 'buyer@example.invalid');
  assert.equal(f.sender.messages[0].attachments.length, 1);
  assert.deepEqual(f.sender.messages[0].attachments[0].content, f.honey);
  assert.equal(f.sender.messages[0].attachments[0].sha256, sha256(f.honey));

  const records = await f.deliveryLog.records();
  assert.deepEqual(records.map((record) => record.outcome), ['reserved', 'delivered']);
  assert.equal(records[1].prevHash, records[0].recordHash);
  assert.equal(records[1].sku, HONEY_SKU);
  assert.equal(records[1].deliverables[0].sha256, sha256(f.honey));
  assert.equal(records[1].recipientDomainHash, recipientDomainHash('buyer@example.invalid'));
  const logText = await readFile(join(f.logDirectory, 'delivery-log.jsonl'), 'utf8');
  assert.equal(logText.includes('buyer@example.invalid'), false, 'full buyer email must never be logged');
});

test('digital pack happy path attaches every declared deliverable', async (t) => {
  const f = await fixture(t);
  const result = await f.fulfillment.fulfill(purchase({
    eventId: 'evt_fixture_pack', sessionId: 'cs_test_fixture_pack', sku: PACK_SKU,
    amountTotal: 4900
  }));
  assert.equal(result.status, 'delivered');
  assert.equal(f.sender.messages.length, 1);
  assert.deepEqual(
    f.sender.messages[0].attachments.map((attachment) => attachment.filename),
    ['fixture-pack.zip', 'fixture-license.txt']
  );
  const delivered = (await f.deliveryLog.records())
    .find((record) => record.outcome === 'delivered');
  assert.equal(delivered.deliverables.length, 2);
});

test('duplicate Stripe event produces exactly one delivery', async (t) => {
  const f = await fixture(t);
  const first = await f.fulfillment.fulfill(purchase());
  const second = await f.fulfillment.fulfill(purchase());
  assert.equal(first.status, 'delivered');
  assert.equal(second.status, 'delivered');
  assert.equal(second.duplicate, true);
  assert.equal(f.sender.messages.length, 1);
  const delivered = (await f.deliveryLog.records())
    .filter((record) => record.outcome === 'delivered');
  assert.equal(delivered.length, 1);
});

test('unknown and held SKUs refuse without sending and both refusals are logged', async (t) => {
  const f = await fixture(t);
  const unknown = await f.fulfillment.fulfill(purchase({
    eventId: 'evt_unknown_sku', sessionId: 'cs_test_unknown_sku', sku: 'UNKNOWN-SKU-404'
  }));
  const held = await f.fulfillment.fulfill(purchase({
    eventId: 'evt_held_sku', sessionId: 'cs_test_held_sku', sku: HELD_SKU
  }));
  assert.equal(unknown.status, 'refused');
  assert.equal(unknown.reason, 'unknown_sku');
  assert.equal(held.status, 'refused');
  assert.equal(held.reason, 'held_sku');
  assert.equal(f.sender.messages.length, 0);
  const refusals = (await f.deliveryLog.records())
    .filter((record) => record.outcome === 'refused')
    .map((record) => record.reason);
  assert.deepEqual(refusals, ['unknown_sku', 'held_sku']);
});

test('tampered deliverable refuses on hash mismatch before any email is produced', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.goods, 'glitch-honey-book.pdf'), Buffer.from('%PDF-tampered'));
  const result = await f.fulfillment.fulfill(purchase({
    eventId: 'evt_tampered_good', sessionId: 'cs_test_tampered_good'
  }));
  assert.equal(result.status, 'refused');
  assert.equal(result.reason, 'deliverable_hash_mismatch');
  assert.equal(f.sender.messages.length, 0);
  const [record] = await f.deliveryLog.records();
  assert.equal(record.outcome, 'refused');
  assert.equal(record.reason, 'deliverable_hash_mismatch');
});

test('HTTP email sender posts attachments as base64 through an injected fetch only', async () => {
  let request;
  const sender = new HttpEmailSender({
    endpoint: 'https://mail.example.invalid/send',
    apiKey: 'fixture-api-key',
    from: 'studio@example.invalid',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ id: 'msg_fixture' }) };
    }
  });
  const content = Buffer.from('fixture attachment');
  const result = await sender.send({
    to: 'buyer@example.invalid', subject: 'Your fixture', text: 'Attached.',
    attachments: [{
      filename: 'fixture.txt', contentType: 'text/plain', sha256: sha256(content), content
    }],
    metadata: { eventId: 'evt_fixture', sku: PACK_SKU }
  });
  assert.equal(result.id, 'msg_fixture');
  assert.equal(request.url, 'https://mail.example.invalid/send');
  const body = JSON.parse(request.options.body);
  assert.equal(body.attachments[0].contentBase64, content.toString('base64'));
  assert.equal(body.attachments[0].sha256, sha256(content));
});

// --- Route-level recorded Stripe-shaped fixtures (offline, signed locally). ---

const SECRET = 'whsec_offline_fulfillment_fixture';
const NOW = 1780000000;
const OFFERS = [
  {
    accountId: 'acct_offline_fulfillment', livemode: false,
    paymentLinkId: 'plink_offline_honey', priceId: 'price_offline_honey',
    sku: HONEY_SKU, amountTotal: 900, currency: 'usd', fulfillmentMode: 'automated'
  },
  {
    accountId: 'acct_offline_fulfillment', livemode: false,
    paymentLinkId: 'plink_offline_unknown', priceId: 'price_offline_unknown',
    sku: 'UNKNOWN-SKU-404', amountTotal: 100, currency: 'usd', fulfillmentMode: 'automated'
  },
  {
    accountId: 'acct_offline_fulfillment', livemode: false,
    paymentLinkId: 'plink_offline_held', priceId: 'price_offline_held',
    sku: HELD_SKU, amountTotal: 4900, currency: 'usd', fulfillmentMode: 'automated'
  }
];

function stripeEvent(offer, eventId, sessionId) {
  return {
    id: eventId, type: 'checkout.session.completed',
    account: offer.accountId, livemode: false,
    data: { object: {
      object: 'checkout.session', id: sessionId, status: 'complete', livemode: false,
      payment_link: offer.paymentLinkId, payment_status: 'paid',
      customer: 'cus_offline_fixture', customer_details: { email: 'buyer@example.invalid' },
      metadata: { sku: offer.sku }, amount_total: offer.amountTotal, currency: 'usd',
      line_items: { has_more: false, data: [{ quantity: 1, price: { id: offer.priceId } }] }
    } }
  };
}

function sign(value, secret = SECRET) {
  const raw = Buffer.from(JSON.stringify(value));
  const signature = createHmac('sha256', secret).update(`${NOW}.`).update(raw).digest('hex');
  return { raw, header: `t=${NOW},v1=${signature}` };
}

test('webhook route delivers once, rejects bad signatures, and logs unknown/held refusals', async (t) => {
  const f = await fixture(t);
  const purchaseDirectory = join(f.root, 'purchase-ledger');
  const route = createStripeWebhookRoute({
    signingSecret: SECRET, offers: OFFERS, ledgerDirectory: purchaseDirectory,
    nowSeconds: () => NOW, fulfillment: f.fulfillment
  });
  const server = createServer(async (req, res) => {
    if (await route(req, res)) return;
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/stripe/webhook`;
  const post = (packet) => fetch(url, {
    method: 'POST', headers: { 'stripe-signature': packet.header }, body: packet.raw
  });

  const honeyPacket = sign(stripeEvent(OFFERS[0], 'evt_route_honey', 'cs_test_route_honey'));
  const first = await post(honeyPacket);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).fulfillmentStatus, 'delivered');
  assert.equal(f.sender.messages.length, 1);

  const duplicate = await post(honeyPacket);
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).duplicate, true);
  assert.equal(f.sender.messages.length, 1, 'purchase-ledger duplicate must not send again');

  const badSignature = await post(sign(
    stripeEvent(OFFERS[0], 'evt_route_bad_sig', 'cs_test_route_bad_sig'),
    'wrong_signing_secret_long'
  ));
  assert.equal(badSignature.status, 400);
  assert.equal(f.sender.messages.length, 1);

  const unknown = await post(sign(stripeEvent(OFFERS[1], 'evt_route_unknown', 'cs_test_route_unknown')));
  assert.equal(unknown.status, 200);
  assert.equal((await unknown.json()).fulfillmentReason, 'unknown_sku');

  const held = await post(sign(stripeEvent(OFFERS[2], 'evt_route_held', 'cs_test_route_held')));
  assert.equal(held.status, 200);
  assert.equal((await held.json()).fulfillmentReason, 'held_sku');
  assert.equal(f.sender.messages.length, 1);

  const reasons = (await f.deliveryLog.records())
    .filter((record) => record.outcome === 'refused').map((record) => record.reason);
  assert.deepEqual(reasons, ['unknown_sku', 'held_sku']);
});
