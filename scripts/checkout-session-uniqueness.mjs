/**
 * Fail-closed uniqueness check for signed checkout sales. Stripe may emit
 * multiple event IDs for one checkout session; those are not new purchases.
 * Refuse ambiguous records before any fulfillment plan can be produced.
 */
export function assertUniqueCheckoutSessions(rows) {
  if (!Array.isArray(rows)) throw new Error('checkout_sessions:invalid_rows');
  const sessions = new Map();
  const events = new Set();
  for (const row of rows) {
    const event = row?.eventId;
    const session = row?.sale?.checkoutSessionId;
    if (typeof event !== 'string' || !/^evt_[A-Za-z0-9_]+$/.test(event)
        || typeof session !== 'string' || !/^cs_(test|live)_[A-Za-z0-9_]+$/.test(session))
      throw new Error('checkout_sessions:invalid_identity');
    if (events.has(event)) throw new Error('checkout_sessions:duplicate_event');
    events.add(event);
    const prior = sessions.get(session);
    if (prior !== undefined)
      throw new Error('checkout_sessions:duplicate_checkout_session');
    sessions.set(session, event);
  }
  return { uniqueSessions: sessions.size };
}
