import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyStripeAccountRoute } from '../api/provider-account-routing.mjs';
const expectedAccountId = 'acct_expected001';
const apiKey = 'rk_test_OfflineFixtureOnly';
test('direct account uses no Stripe-Account header and verifies account identity', async () => {
  const result = await verifyStripeAccountRoute({route:'direct',expectedAccountId,apiKey,
    fetchImpl:async (url, options) => {
      assert.equal(url,'https://api.stripe.com/v1/account');
      assert.equal(options.headers['Stripe-Account'],undefined);
      return {ok:true,json:async()=>({object:'account',id:expectedAccountId})};
    }});
  assert.equal(result.accountId,expectedAccountId);
  assert.equal(result.mode,'test');
});
test('Connect account uses explicit server-selected header and verifies identity', async () => {
  const result = await verifyStripeAccountRoute({route:'connect',expectedAccountId,apiKey,
    fetchImpl:async (_,options) => {
      assert.equal(options.headers['Stripe-Account'],expectedAccountId);
      return {ok:true,json:async()=>({object:'account',id:expectedAccountId})};
    }});
  assert.equal(result.route,'connect');
});
test('refuses account mismatch, missing credential, invalid routing, unavailable provider', async () => {
  const base={route:'direct',expectedAccountId,apiKey};
  await assert.rejects(verifyStripeAccountRoute({...base,fetchImpl:async()=>({ok:true,json:async()=>({object:'account',id:'acct_other'})})}),/mismatch/);
  await assert.rejects(verifyStripeAccountRoute({...base,apiKey:'not-a-key'}),/credential/);
  await assert.rejects(verifyStripeAccountRoute({...base,route:'auto'}),/route/);
  await assert.rejects(verifyStripeAccountRoute({...base,fetchImpl:async()=>{throw Error('network')}}),/unavailable/);
  await assert.rejects(verifyStripeAccountRoute({...base,fetchImpl:async()=>({ok:false})}),/unavailable/);
});
