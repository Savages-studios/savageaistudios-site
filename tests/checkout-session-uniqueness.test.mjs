import test from 'node:test';
import assert from 'node:assert/strict';
import { assertUniqueCheckoutSessions } from '../scripts/checkout-session-uniqueness.mjs';

const row = (eventId, checkoutSessionId) => ({ eventId, sale: { checkoutSessionId } });
test('accepts distinct checkout sessions', () => {
  assert.deepEqual(assertUniqueCheckoutSessions([
    row('evt_one', 'cs_test_first'), row('evt_two', 'cs_live_second'),
  ]), { uniqueSessions: 2 });
});
test('accepts an empty ledger', () => {
  assert.deepEqual(assertUniqueCheckoutSessions([]), { uniqueSessions: 0 });
});
test('rejects two event IDs representing the same checkout purchase', () => {
  assert.throws(() => assertUniqueCheckoutSessions([
    row('evt_one', 'cs_test_first'), row('evt_two', 'cs_test_first'),
  ]), /duplicate_checkout_session/);
});
test('rejects duplicate event identities', () => {
  assert.throws(() => assertUniqueCheckoutSessions([
    row('evt_one', 'cs_test_first'), row('evt_one', 'cs_test_second'),
  ]), /duplicate_event/);
});
test('rejects missing or malformed identities', () => {
  for (const rows of [null, [{}], [row('bad', 'cs_test_first')], [row('evt_one', 'bad')]])
    assert.throws(() => assertUniqueCheckoutSessions(rows));
});
