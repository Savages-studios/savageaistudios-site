/**
 * Resolve the authenticated Stripe account for direct or Connect checkout.
 * Caller chooses routing from server configuration, never buyer input.
 * Account identity must be observed from Stripe before any session readback.
 */
export async function verifyStripeAccountRoute({ route, expectedAccountId, apiKey, fetchImpl = fetch }) {
  if (route !== 'direct' && route !== 'connect') throw new Error('unsupported account route');
  if (!/^acct_[A-Za-z0-9_]+$/.test(expectedAccountId ?? '')) throw new Error('invalid expected account');
  if (!/^(sk|rk)_(test|live)_[A-Za-z0-9_]+$/.test(apiKey ?? '')) throw new Error('invalid provider credential');
  const headers = { Authorization: 'Bearer ' + apiKey, Accept: 'application/json' };
  if (route === 'connect') headers['Stripe-Account'] = expectedAccountId;
  let response;
  try {
    response = await fetchImpl('https://api.stripe.com/v1/account', {
      method: 'GET', headers, signal: AbortSignal.timeout(8000)
    });
  } catch {
    throw new Error('provider account verification unavailable');
  }
  if (!response?.ok) throw new Error('provider account verification unavailable');
  let account;
  try { account = await response.json(); }
  catch { throw new Error('invalid provider account response'); }
  if (account?.object !== 'account' || account.id !== expectedAccountId)
    throw new Error('provider account identity mismatch');
  return Object.freeze({ route, accountId: account.id,
    mode: apiKey.includes('_live_') ? 'live' : 'test',
    headers: Object.freeze(headers) });
}
