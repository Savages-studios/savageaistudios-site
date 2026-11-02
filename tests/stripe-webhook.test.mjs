import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { chmod, link, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStripeWebhookRoute, retrieveStripeLineItems } from '../api/stripe-webhook.mjs';
import { validateOfferCatalog, verifyPaidCheckout } from '../api/stripe-verifier.mjs';
import { PurchaseLedger } from '../api/purchase-ledger.mjs';

const SECRET = 'whsec_offline_fixture_only_not_live';
const NOW = 1780000000;
const OFFER = Object.freeze({
  accountId: 'acct_offline_site_test', livemode: false,
  paymentLinkId: 'plink_offline_facturforge_test', priceId: 'price_offline_facturforge_test',
  sku: 'COMM-20260908-MARKETPLACE-FACTURFORGE-PACK100',
  amountTotal: 1900, currency: 'usd', fulfillmentMode: 'manual'
});
const event = (overrides = {}, top = {}) => ({
  id: 'evt_offline_site_event', type: 'checkout.session.completed', account: OFFER.accountId, livemode: false,
  data: { object: {
    object: 'checkout.session', id: 'cs_test_offline_site_event', status: 'complete', livemode: false,
    payment_link: OFFER.paymentLinkId, payment_status: 'paid',
    customer: 'cus_offline_test', customer_details: { email: 'buyer@example.invalid' },
    metadata: { sku: OFFER.sku }, amount_total: 1900, currency: 'usd',
    line_items: { has_more: false, data: [{ quantity: 1, price: { id: OFFER.priceId } }] },
    ...overrides
  } },
  ...top
});
const signed = (value, secret = SECRET, timestamp = NOW) => {
  const raw = Buffer.from(JSON.stringify(value));
  const hash = createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest('hex');
  return { raw, header: `t=${timestamp},v1=${hash}` };
};

test('site route durably records verified sale AND manual fulfillment work and deduplicates replay', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'savage-site-fulfillment-'));
  let now = NOW;
  const route = createStripeWebhookRoute({ signingSecret: SECRET, offers: [OFFER], ledgerDirectory: directory, nowSeconds: () => now });
  const server = createServer(async (req, res) => {
    if (await route(req, res)) return;
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (v) => fetch(`${base}/api/stripe/webhook`, {
    method: 'POST', headers: { 'stripe-signature': v.header, 'content-type': 'application/json' }, body: v.raw
  });
  const fixture = signed(event());
  const first = await post(fixture);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { received: true, recorded: true, duplicate: false, fulfillmentStatus: 'pending' });
  const entries = (await readdir(directory)).filter((name) => name.endsWith('.json'));
  assert.equal(entries.length, 1);
  const stored = JSON.parse(await readFile(join(directory, entries[0]), 'utf8'));
  assert.equal(stored.sale.buyerEmail, 'buyer@example.invalid');
  assert.equal(stored.sale.sku, OFFER.sku);
  assert.equal(stored.sale.amountTotal, 1900);
  assert.equal(stored.sale.currency, 'usd');
  assert.equal(stored.sale.providerEventId, 'evt_offline_site_event');
  assert.equal(stored.fulfillment.status, 'pending');
  assert.equal(stored.fulfillment.method, 'manual');

  const duplicates = await Promise.all([post(fixture), post(fixture)]);
  for (const response of duplicates) {
    assert.equal(response.status, 200);
    assert.equal((await response.json()).duplicate, true);
  }
  assert.equal((await readdir(directory)).filter((name) => name.endsWith('.json')).length, 1);
  // Stripe retries may receive an entirely new signature timestamp.
  now = NOW + 60;
  const retried = await post(signed(event(), SECRET, now));
  assert.equal(retried.status, 200, 're-signing a retry must not create a new purchase');
  assert.equal((await retried.json()).duplicate, true);
  now = NOW;
  const secondRoute = createStripeWebhookRoute({ signingSecret: SECRET, offers: [OFFER], ledgerDirectory: directory, nowSeconds: () => NOW });
  assert.equal(typeof secondRoute, 'function', 'a restarted route reopens same durable ledger');

  const invalid = [
    ['wrong account', event({}, { id: 'evt_wrongacct', account: 'acct_other' })],
    ['wrong mode', event({}, { id: 'evt_wrongmode', livemode: true })],
    ['wrong session mode', event({ livemode: true }, { id: 'evt_wrongsessionmode' })],
    ['wrong amount', event({ amount_total: 1901 }, { id: 'evt_wrongamount' })],
    ['wrong currency', event({ currency: 'eur' }, { id: 'evt_wrongcurrency' })],
    ['wrong price', event({ line_items: { data: [{ quantity: 1, price: { id: 'price_wrong' } }] } }, { id: 'evt_wrongprice' })],
    ['wrong SKU', event({ metadata: { sku: 'OTHER' } }, { id: 'evt_wrongsku' })],
    ['wrong quantity', event({ line_items: { data: [{ quantity: 2, price: { id: OFFER.priceId } }] } }, { id: 'evt_wrongquantity' })],
    ['unpaid', event({ payment_status: 'unpaid' }, { id: 'evt_unpaid' })],
    ['wrong link', event({ payment_link: 'plink_wrong' }, { id: 'evt_wronglink' })]
  ];
  for (const [label, value] of invalid) {
    const response = await post(signed(value));
    assert.equal(response.status, 400, label);
  }
  assert.equal((await post(signed(event({}, { id: 'evt_invalidsig' }), 'wrong_signing_secret_long'))).status, 400);
  assert.equal((await post(signed(event({}, { id: 'evt_stale' }), SECRET, NOW - 301))).status, 400);
  assert.equal((await readdir(directory)).filter((name) => name.endsWith('.json')).length, 1, 'rejections never record a sale');
  assert.equal((await fetch(`${base}/api/stripe/webhook`)).status, 405);
  assert.equal((await fetch(`${base}/api/not-found`)).status, 404);
});

test('trusted product configuration and raw signature validation fail closed', () => {
  assert.throws(() => validateOfferCatalog([]), /catalog/);
  assert.throws(() => validateOfferCatalog([{ ...OFFER, priceId: '' }]), /configuration/);
  assert.throws(() => createStripeWebhookRoute({ signingSecret: SECRET, offers: [{ ...OFFER, fulfillmentMode: 'automated' }], ledgerDirectory: '/tmp/test-ledger' }), /worker/);
  const correct = signed(event());
  assert.equal(verifyPaidCheckout(correct.raw, correct.header, SECRET, [OFFER], NOW).sku, OFFER.sku);
  assert.throws(() => verifyPaidCheckout(Buffer.concat([correct.raw, Buffer.from(' ')]), correct.header, SECRET, [OFFER], NOW), /signature/);
  assert.throws(() => verifyPaidCheckout(correct.raw, undefined, SECRET, [OFFER], NOW), /header/);
  assert.throws(() => verifyPaidCheckout(correct.raw, 't=1,v1=bad', SECRET, [OFFER], NOW), /signature/);
});


test('normal unexpanded Stripe webhook retrieves trusted line items before durable sale', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'savage-lineitems-'));
  let mode = 'valid';
  let calls = 0;
  const stripeApiKey = 'sk_test_OfflineRestrictedReadOnlyExampleKey';
  const stripeFetch = async (url, config) => {
    ++calls;
    assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions/cs_test_offline_site_event/line_items?limit=2');
    assert.equal(config.method, 'GET');
    assert.equal(config.headers.Authorization, 'Bearer ' + stripeApiKey);
    if (mode === 'unavailable') return new Response('{"error":"unavailable"}', { status: 503 });
    return Response.json({
      object: 'list',
      data: [{ quantity: 1, price: { id: mode === 'bad-price' ? 'price_wrong' : OFFER.priceId } }],
      has_more: false
    });
  };
  const route = createStripeWebhookRoute({
    signingSecret: SECRET, stripeApiKey, stripeFetch,
    offers: [OFFER], ledgerDirectory: directory, nowSeconds: () => NOW
  });
  const server = createServer(async (req, res) => {
    if (await route(req, res)) return;
    res.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const url = 'http://127.0.0.1:' + server.address().port + '/api/stripe/webhook';
  const send = async (e, signingKey = SECRET) => {
    const packet = signed(e, signingKey);
    return fetch(url, { method: 'POST', headers: { 'stripe-signature': packet.header },
      body: packet.raw });
  };
  const slimEvent = (id) => event({ line_items: undefined }, { id });
  const accepted = await send(slimEvent('evt_unexpanded_paid_1'));
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).recorded, true);
  assert.equal(calls, 1);
  assert.equal((await readdir(directory)).filter(name => name.endsWith('.json')).length, 1);
  mode = 'bad-price';
  const badPrice = await send(slimEvent('evt_unexpanded_badprice'));
  assert.equal(badPrice.status, 400);
  assert.equal(calls, 2);
  mode = 'unavailable';
  const unavailable = await send(slimEvent('evt_unexpanded_unavailable'));
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).received, false);
  assert.equal(calls, 3);
  const unsigned = await send(slimEvent('evt_unexpanded_unsigned'), 'wrong_provider_signing_secret');
  assert.equal(unsigned.status, 400);
  assert.equal(calls, 3, 'reject signature BEFORE any Stripe network lookup');
  assert.equal((await readdir(directory)).filter(name => name.endsWith('.json')).length, 1);

  await assert.rejects(() => retrieveStripeLineItems('not-a-session-id', stripeApiKey, stripeFetch), /invalid checkout/);
  await assert.rejects(() => retrieveStripeLineItems('cs_test_validid', '', stripeFetch), /key is not configured/);
});

test('private purchase ledger rejects public, symlinked and indirect symlinked directories before writes', {
  skip: process.platform === 'win32' ? 'POSIX permissions and symlink guarantees' : false
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'site-ledger-path-integrity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { raw, header } = signed(event());
  const purchase = verifyPaidCheckout(raw, header, SECRET, [OFFER], NOW);
  const publicDir = join(root, 'public');
  const privateDir = join(root, 'private');
  await mkdir(publicDir, { mode: 0o700 });
  await chmod(publicDir, 0o777);
  await assert.rejects(() => new PurchaseLedger(publicDir).record(purchase), /private and process-owned/);
  assert.deepEqual(await readdir(publicDir), [], 'no sale must be written to shared storage');
  await mkdir(privateDir, { mode: 0o700 });
  const alias = join(root, 'alias');
  await symlink(privateDir, alias, 'dir');
  await assert.rejects(() => new PurchaseLedger(alias).record(purchase), /symlinks/);
  await assert.rejects(() => new PurchaseLedger(join(alias, 'child')).record(purchase), /symlinks/);
  await assert.rejects(() => stat(join(privateDir, 'child')), { code: 'ENOENT' });
  assert.deepEqual(await readdir(privateDir), [], 'no side effects across an untrusted path');
});

test('replayed paid events reject symlink and hardlinked ledger files without leaking contents', {
  skip: process.platform === 'win32' ? 'POSIX symlink and hardlink semantics' : false
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'site-ledger-replay-integrity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ledgerDir = join(root, 'ledger');
  await mkdir(ledgerDir, { mode: 0o700 });
  const packet = signed(event());
  const purchase = verifyPaidCheckout(packet.raw, packet.header, SECRET, [OFFER], NOW);
  const ledger = new PurchaseLedger(ledgerDir);
  const key = createHash('sha256').update(purchase.eventId).digest('hex');
  const target = join(root, 'outside-private-ledger.json');
  const destination = join(ledgerDir, key + '.json');
  await writeFile(target, 'PRIVATE-UNTRUSTED-CONTENT', { mode: 0o600 });
  await symlink(target, destination);
  await assert.rejects(() => ledger.record(purchase), (error) =>
    /unsafe or unreadable/.test(error.message) && !error.message.includes('PRIVATE-UNTRUSTED-CONTENT'));
  await unlink(destination);
  await link(target, destination);
  await assert.rejects(() => ledger.record(purchase), /unsafe or unreadable/);
  await unlink(destination);
  const first = await ledger.record(purchase);
  const replay = await ledger.record(purchase);
  assert.equal(first.recorded, true);
  assert.equal(replay.duplicate, true);
  assert.deepEqual((await readdir(ledgerDir)).filter(name => name.endsWith('.json')),
                   [key + '.json'], 'accepted purchase has one durable private record');
});
