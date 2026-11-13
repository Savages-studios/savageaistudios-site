import test from 'node:test';
import assert from 'node:assert/strict';
import { readbackPaidCheckout } from '../api/provider-session-readback.mjs';

const purchase = Object.freeze({
  sessionId: 'cs_test_readback_001', paymentIntentId: 'pi_readback_001',
  accountId: 'acct_readback_001', livemode: false, amountTotal: 1900,
  currency: 'usd', customerEmail: 'buyer@example.invalid'
});
const session = Object.freeze({
  object: 'checkout.session', id: purchase.sessionId, payment_intent: purchase.paymentIntentId,
  livemode: false, status: 'complete', payment_status: 'paid',
  amount_total: 1900, currency: 'usd', customer_details: { email: purchase.customerEmail }
});
const key = 'rk_test_ReadbackFixtureOnly';
test('authenticated server-side readback binds checkout identity, account and payment', async () => {
  let count = 0;
  const observed = await readbackPaidCheckout(purchase, key, async (url, options) => {
    count++;
    assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions/cs_test_readback_001');
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Authorization, 'Bearer ' + key);
    assert.equal(options.headers['Stripe-Account'], purchase.accountId);
    return { ok: true, json: async () => session };
  });
  assert.equal(count, 1);
  assert.equal(observed.paymentStatus, 'paid');
  assert.equal(observed.sessionId, purchase.sessionId);
  assert.equal(Object.hasOwn(observed, 'delivered'), false);
});
test('readback refuses every conflicting settlement attribute', async () => {
  for (const change of [
    { id: 'cs_test_other' }, { payment_intent: 'pi_other' },
    { livemode: true }, { status: 'open' }, { payment_status: 'unpaid' },
    { amount_total: 1901 }, { currency: 'eur' },
    { customer_details: { email: 'other@example.invalid' } },
    { object: 'payment_intent' }
  ]) {
    await assert.rejects(
      readbackPaidCheckout(purchase, key, async () => ({
        ok: true, json: async () => ({ ...session, ...change })
      })), /conflicts/);
  }
});
test('readback fails closed on unavailable provider and invalid credentials', async () => {
  await assert.rejects(readbackPaidCheckout(purchase, key, async () => ({ ok: false })), /unavailable/);
  await assert.rejects(readbackPaidCheckout(purchase, 'rk_live_WrongMode', async () => {
    throw new Error('must not call provider');
  }), /credential/);
  await assert.rejects(readbackPaidCheckout({ ...purchase, sessionId: 'cs_live_wrong' }, key, async () => {
    throw new Error('must not call provider');
  }), /binding/);
});
