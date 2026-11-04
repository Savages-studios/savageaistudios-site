import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStripeWebhookRoute } from '../api/stripe-webhook.mjs';
import { verifyPaidCheckout, verifySignedChargeRefund } from '../api/stripe-verifier.mjs';
import { PurchaseLedger, checkoutSessionClaimKey } from '../api/purchase-ledger.mjs';

// --- Revocation: a verified charge.refunded revokes the entitlement. ---
// Mirrors the harness of stripe-webhook.test.mjs (same fixture offer,
// same signing discipline). The refund reaches its checkout session
// only through the payment-intent link stored at checkout time.

const SECRET = 'whsec_offline_fixture_only_not_live';
const NOW = 1780000000;
const OFFER = Object.freeze({
  accountId: 'acct_offline_site_test', livemode: false,
  paymentLinkId: 'plink_offline_facturforge_test', priceId: 'price_offline_facturforge_test',
  sku: 'COMM-20260908-MARKETPLACE-FACTURFORGE-PACK100',
  amountTotal: 1900, currency: 'usd', fulfillmentMode: 'manual'
});
const PI = 'pi_refund_link';
const event = (overrides = {}, top = {}) => ({
  id: 'evt_offline_site_event', type: 'checkout.session.completed', account: OFFER.accountId, livemode: false,
  data: { object: {
    object: 'checkout.session', id: 'cs_test_offline_site_event', status: 'complete', livemode: false,
    payment_link: OFFER.paymentLinkId, payment_status: 'paid', payment_intent: PI,
    customer: 'cus_offline_test', customer_details: { email: 'buyer@example.invalid' },
    metadata: { sku: OFFER.sku }, amount_total: 1900, currency: 'usd',
    line_items: { has_more: false, data: [{ quantity: 1, price: { id: OFFER.priceId } }] },
    ...overrides
  } },
  ...top
});
const refundEvent = (overrides = {}, top = {}) => ({
  id: 'evt_refund_1', type: 'charge.refunded', account: OFFER.accountId, livemode: false,
  data: { object: {
    object: 'charge', id: 'ch_refund_1', payment_intent: PI,
    amount: 1900, amount_refunded: 1900, currency: 'usd', livemode: false,
    ...overrides
  } },
  ...top
});
const signed = (value, secret = SECRET, timestamp = NOW) => {
  const raw = Buffer.from(JSON.stringify(value));
  const hash = createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest('hex');
  return { raw, header: `t=${timestamp},v1=${hash}` };
};
const claimPathFor = (directory, sessionId = 'cs_test_offline_site_event', livemode = false) =>
  join(directory, createHash('sha256').update(checkoutSessionClaimKey(livemode, sessionId)).digest('hex') + '.claim');
const recordFiles = async (directory) =>
  (await readdir(directory)).filter((name) => name.endsWith('.json'));
const readClaim = async (directory) => JSON.parse(await readFile(claimPathFor(directory), 'utf8'));

async function serveRoute(t, directory) {
  const route = createStripeWebhookRoute({ signingSecret: SECRET, offers: [OFFER], ledgerDirectory: directory, nowSeconds: () => NOW });
  const server = createServer(async (req, res) => {
    if (await route(req, res)) return;
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}/api/stripe/webhook`;
  const post = async (packet, headers = {}) => fetch(url, {
    method: 'POST',
    headers: { 'stripe-signature': packet.header, 'content-type': 'application/json', ...headers },
    body: packet.raw
  });
  post.url = url;
  return post;
}

test('signed charge.refunded revokes the fulfilled claim and marks the fulfillment record', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'savage-revocation-basic-'));
  const post = await serveRoute(t, directory);
  const checkout = await post(signed(event()));
  assert.equal(checkout.status, 200);
  assert.equal((await checkout.json()).recorded, true);
  const claimBefore = await readClaim(directory);
  assert.equal(claimBefore.state, 'fulfilled');
  assert.equal(claimBefore.paymentIntentId, PI);

  const refund = await post(signed(refundEvent()));
  assert.equal(refund.status, 200);
  assert.deepEqual(await refund.json(), {
    received: true, recorded: true, duplicate: false, revoked: true,
    claimState: 'revoked', fulfillmentStatus: 'revoked'
  });

  const claim = await readClaim(directory);
  assert.equal(claim.state, 'revoked');
  assert.equal(claim.revocationEventId, 'evt_refund_1');
  assert.equal(claim.revocationReason, 'charge.refunded');
  assert.equal(claim.revocationChargeId, 'ch_refund_1');
  assert.equal(claim.revocationAmountRefunded, 1900);
  assert.ok(Number.isSafeInteger(claim.revokedAtMs) && claim.revokedAtMs > 0);
  // The original claim is preserved, not rewritten: identity fields stand.
  assert.equal(claim.eventId, claimBefore.eventId);
  assert.equal(claim.leaseId, claimBefore.leaseId);
  assert.equal(claim.claimedAtMs, claimBefore.claimedAtMs);
  assert.equal(claim.recordFile, claimBefore.recordFile);

  const records = await recordFiles(directory);
  assert.equal(records.length, 1, 'the original record is never deleted');
  const row = JSON.parse(await readFile(join(directory, records[0]), 'utf8'));
  assert.equal(row.fulfillment.status, 'revoked', 'a revoked claim leaves no actionable fulfillment');
  assert.equal(row.revocation.eventId, 'evt_refund_1');
  assert.equal(row.revocation.chargeId, 'ch_refund_1');
  assert.equal(row.revocation.paymentIntentId, PI);
  assert.equal(row.sale.buyerEmail, 'buyer@example.invalid', 'the sale evidence is untouched');
  assert.equal(row.sale.amountTotal, 1900);
});

test('duplicate refund deliveries stay exactly one revocation', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'savage-revocation-dupe-'));
  const post = await serveRoute(t, directory);
  await post(signed(event()));
  const packet = signed(refundEvent());
  const first = await post(packet);
  assert.equal((await first.json()).recorded, true);
  const replay = await post(packet);
  assert.equal(replay.status, 200);
  const replayJson = await replay.json();
  assert.equal(replayJson.duplicate, true);
  assert.equal(replayJson.recorded, false);
  assert.equal(replayJson.revoked, true);
  const secondEvent = await post(signed(refundEvent({}, { id: 'evt_refund_2' })));
  assert.equal((await secondEvent.json()).duplicate, true, 'a distinct refund event for the same charge is still the same revocation');
  const claim = await readClaim(directory);
  assert.equal(claim.state, 'revoked');
  assert.equal(claim.revocationEventId, 'evt_refund_1', 'the first revocation stands');
  assert.equal((await recordFiles(directory)).length, 1);
  assert.equal((await readdir(directory)).filter((name) => name.endsWith('.claim')).length, 1);
});

test('unsigned, wrongly signed and malformed refunds are rejected and change nothing', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'savage-revocation-reject-'));
  const post = await serveRoute(t, directory);
  await post(signed(event()));
  const packet = signed(refundEvent());
  const unsigned = await fetch(post.url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: packet.raw
  });
  assert.equal(unsigned.status, 400, 'an unsigned refund is rejected, never acknowledged');
  const wrongSecret = await post(signed(refundEvent(), 'wrong_signing_secret_long'));
  assert.equal(wrongSecret.status, 400);
  const missingPi = await post(signed(refundEvent({ payment_intent: undefined })));
  assert.equal(missingPi.status, 400, 'a refund without a payment-intent link cannot be resolved and fails closed');
  const wrongMode = await post(signed(refundEvent({ livemode: true }, { livemode: true })));
  assert.equal(wrongMode.status, 400, 'a live-mode refund presented to a test endpoint is rejected');
  const claim = await readClaim(directory);
  assert.equal(claim.state, 'fulfilled', 'rejected refunds never touch the claim');
  const records = await recordFiles(directory);
  const row = JSON.parse(await readFile(join(directory, records[0]), 'utf8'));
  assert.equal(row.fulfillment.status, 'pending');
});

test('refund for an unknown charge is acknowledged unmatched and records no phantom revocation', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'savage-revocation-unmatched-'));
  const post = await serveRoute(t, directory);
  await post(signed(event()));
  const before = (await readdir(directory)).sort();
  const unknown = await post(signed(refundEvent(
    { id: 'ch_unknown', payment_intent: 'pi_unknown_refund' }, { id: 'evt_refund_unknown' })));
  assert.equal(unknown.status, 200, 'an authentic unmatched refund is acknowledged so Stripe stops retrying');
  assert.deepEqual(await unknown.json(), {
    received: true, recorded: false, duplicate: false, revoked: false, unmatched: true
  });
  assert.deepEqual((await readdir(directory)).sort(), before, 'no phantom claim or record is written');
  const claim = await readClaim(directory);
  assert.equal(claim.state, 'fulfilled');
});

test('a revoked session cannot be resurrected by later checkout deliveries (Issue #9 discipline)', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'savage-revocation-terminal-'));
  const post = await serveRoute(t, directory);
  const original = signed(event());
  await post(original);
  const dupeCheckout = await post(signed(event({}, { id: 'evt_second_checkout' })));
  assert.equal((await dupeCheckout.json()).duplicate, true);
  assert.equal((await recordFiles(directory)).length, 1, 'duplicate checkout events still produce one record');
  await post(signed(refundEvent()));
  const afterRefund = await post(signed(event({}, { id: 'evt_third_checkout' })));
  assert.equal(afterRefund.status, 200);
  const afterJson = await afterRefund.json();
  assert.equal(afterJson.duplicate, true);
  assert.equal(afterJson.fulfillmentStatus, 'revoked', 'a post-refund delivery reports the revoked status honestly');
  const replayOriginal = await post(original);
  assert.equal((await replayOriginal.json()).duplicate, true);
  const claim = await readClaim(directory);
  assert.equal(claim.state, 'revoked', 'revocation is terminal');
  assert.equal((await recordFiles(directory)).length, 1);
});

test('verifySignedChargeRefund binds account, mode and charge shape', () => {
  const good = signed(refundEvent());
  const parsed = verifySignedChargeRefund(good.raw, good.header, SECRET, [OFFER], NOW);
  assert.equal(parsed.paymentIntentId, PI);
  assert.equal(parsed.chargeId, 'ch_refund_1');
  assert.equal(parsed.amountRefunded, 1900);
  assert.throws(() => verifySignedChargeRefund(
    signed(event()).raw, signed(event()).header, SECRET, [OFFER], NOW), /wrong event type/);
  const wrongAccount = signed(refundEvent({}, { account: 'acct_other' }));
  assert.throws(() => verifySignedChargeRefund(wrongAccount.raw, wrongAccount.header, SECRET, [OFFER], NOW), /not bound/);
});

const purchaseFor = (eventId, sessionOverrides = {}) => {
  const packet = signed(event(sessionOverrides, { id: eventId }));
  return verifyPaidCheckout(packet.raw, packet.header, SECRET, [OFFER], NOW);
};
const plantClaim = async (directory, overrides = {}) => {
  const now = Date.now();
  const claim = {
    schemaVersion: 2, kind: 'checkout-session-claim',
    claimKey: checkoutSessionClaimKey(false, 'cs_test_offline_site_event'),
    sessionId: 'cs_test_offline_site_event', livemode: false,
    state: 'pending', leaseId: '0123456789abcdef0123456789abcdef',
    claimedAt: new Date(now).toISOString(), claimedAtMs: now,
    eventId: 'evt_claim_owner', recordFile: null, paymentIntentId: null,
    ...overrides
  };
  const path = claimPathFor(directory, claim.sessionId, claim.livemode);
  await writeFile(path, JSON.stringify(claim) + '\n', { mode: 0o600 });
  return { path, claim };
};

test('revokeForRefund transitions a pending claim and preserves its original fields', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'savage-revocation-pending-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { path, claim: planted } = await plantClaim(directory, { paymentIntentId: 'pi_pending_link' });
  const ledger = new PurchaseLedger(directory);
  const outcome = await ledger.revokeForRefund({
    eventId: 'evt_refund_pending', paymentIntentId: 'pi_pending_link', livemode: false,
    chargeId: 'ch_pending_link', amountRefunded: 1900, observedAt: new Date(NOW * 1000).toISOString()
  });
  assert.equal(outcome.matched, true);
  assert.equal(outcome.revoked, true);
  assert.equal(outcome.row, null, 'a pending claim has no durable record to mark');
  const claim = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(claim.state, 'revoked');
  assert.equal(claim.revocationEventId, 'evt_refund_pending');
  assert.equal(claim.revokedAtMs, NOW * 1000, 'revocation time comes from the verified event');
  assert.equal(claim.eventId, planted.eventId, 'the original claiming event is preserved');
  assert.equal(claim.leaseId, planted.leaseId);
  const again = await ledger.revokeForRefund({
    eventId: 'evt_refund_pending_2', paymentIntentId: 'pi_pending_link', livemode: false,
    chargeId: 'ch_pending_link', amountRefunded: 1900, observedAt: new Date(NOW * 1000).toISOString()
  });
  assert.equal(again.duplicate, true);
  const after = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(after.revocationEventId, 'evt_refund_pending', 'the first revocation stands');
});

test('revokeForRefund fails closed on a conflicting payment-intent link', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'savage-revocation-conflict-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const ledger = new PurchaseLedger(directory);
  await ledger.record(purchaseFor('evt_link_a', { payment_intent: 'pi_shared_link' }));
  await ledger.record(purchaseFor('evt_link_b', { id: 'cs_test_other_session', payment_intent: 'pi_shared_link' }));
  await assert.rejects(() => ledger.revokeForRefund({
    eventId: 'evt_refund_conflict', paymentIntentId: 'pi_shared_link', livemode: false,
    chargeId: 'ch_conflict', amountRefunded: 1900, observedAt: new Date(NOW * 1000).toISOString()
  }), /conflicting payment intent link/);
  const claim = await readClaim(directory);
  assert.equal(claim.state, 'fulfilled', 'a conflict revokes nothing');
});

test('revokeForRefund on an unresolvable payment intent matches nothing and writes nothing', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'savage-revocation-nomatch-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const ledger = new PurchaseLedger(directory);
  const outcome = await ledger.revokeForRefund({
    eventId: 'evt_refund_none', paymentIntentId: 'pi_never_seen', livemode: false,
    chargeId: 'ch_never_seen', amountRefunded: 100, observedAt: new Date(NOW * 1000).toISOString()
  });
  assert.equal(outcome.matched, false);
  assert.equal(outcome.revoked, false);
  assert.deepEqual(await readdir(directory), [], 'no files are written for an unmatched refund');
});

test('revokeForRefund adopts a legacy event-keyed record into a revoked claim', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'savage-revocation-legacy-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const legacyPurchase = purchaseFor('evt_legacy_refund', { payment_intent: 'pi_legacy_link' });
  const legacyIdentity = {
    eventId: legacyPurchase.eventId, sessionId: legacyPurchase.sessionId,
    customerEmail: legacyPurchase.customerEmail, sku: legacyPurchase.sku,
    amountTotal: legacyPurchase.amountTotal, currency: legacyPurchase.currency,
    accountId: legacyPurchase.accountId, livemode: legacyPurchase.livemode,
    fulfillmentMode: legacyPurchase.fulfillmentMode
  };
  const legacyRow = {
    schemaVersion: 1, eventId: 'evt_legacy_refund',
    purchaseBinding: createHash('sha256').update(JSON.stringify(legacyIdentity)).digest('hex'),
    sale: {
      checkoutSessionId: 'cs_test_offline_site_event', buyerEmail: 'buyer@example.invalid',
      sku: OFFER.sku, amountTotal: 1900, currency: 'usd', accountId: OFFER.accountId,
      livemode: false, providerEventId: 'evt_legacy_refund', purchasedAt: legacyPurchase.observedAt,
      paymentIntentId: 'pi_legacy_link'
    },
    fulfillment: { sku: OFFER.sku, status: 'pending', method: 'manual', sourceEventId: 'evt_legacy_refund' }
  };
  const legacyFile = createHash('sha256').update('evt_legacy_refund').digest('hex') + '.json';
  await writeFile(join(directory, legacyFile), JSON.stringify(legacyRow) + '\n', { mode: 0o600 });
  const ledger = new PurchaseLedger(directory);
  const outcome = await ledger.revokeForRefund({
    eventId: 'evt_refund_legacy', paymentIntentId: 'pi_legacy_link', livemode: false,
    chargeId: 'ch_legacy', amountRefunded: 1900, observedAt: new Date(NOW * 1000).toISOString()
  });
  assert.equal(outcome.matched, true);
  assert.equal(outcome.revoked, true);
  const claim = await readClaim(directory);
  assert.equal(claim.state, 'revoked');
  assert.equal(claim.recordFile, legacyFile);
  const row = JSON.parse(await readFile(join(directory, legacyFile), 'utf8'));
  assert.equal(row.fulfillment.status, 'revoked');
  assert.equal(row.revocation.eventId, 'evt_refund_legacy');
});
