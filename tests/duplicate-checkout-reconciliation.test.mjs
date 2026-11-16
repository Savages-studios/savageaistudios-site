import test from 'node:test';
import assert from 'node:assert/strict';
import { assertUniqueCheckoutSession } from '../scripts/audit-commerce-pipeline.mjs';

const sale = (accountId, livemode, checkoutSessionId) =>
  ({ accountId, livemode, checkoutSessionId });

test('two distinct provider events for one checkout cannot count as two sales', () => {
  const seen = new Set();
  assertUniqueCheckoutSession(seen, sale('acct_a', false, 'cs_test_one'));
  assert.throws(
    () => assertUniqueCheckoutSession(seen, sale('acct_a', false, 'cs_test_one')),
    /duplicate_checkout_session_across_events/,
  );
  assert.equal(seen.size, 1);
});

test('account and mode isolate checkout-session identity', () => {
  const seen = new Set();
  assertUniqueCheckoutSession(seen, sale('acct_a', false, 'cs_test_one'));
  assertUniqueCheckoutSession(seen, sale('acct_b', false, 'cs_test_one'));
  assertUniqueCheckoutSession(seen, sale('acct_a', true, 'cs_test_one'));
  assertUniqueCheckoutSession(seen, sale('acct_a', false, 'cs_test_two'));
  assert.equal(seen.size, 4);
});

test('duplicate detection remains fail-closed after unrelated sessions', () => {
  const seen = new Set();
  assertUniqueCheckoutSession(seen, sale('acct_a', false, 'cs_test_one'));
  assertUniqueCheckoutSession(seen, sale('acct_a', false, 'cs_test_two'));
  assert.throws(
    () => assertUniqueCheckoutSession(seen, sale('acct_a', false, 'cs_test_one')),
    /duplicate_checkout_session_across_events/,
  );
});
