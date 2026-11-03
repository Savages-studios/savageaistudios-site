import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { collectStorefrontCheckoutLinks, validateStorefrontAuditConfig } from '../scripts/audit-stripe-storefront.mjs';

test('inventory scans the actual checked-out storefront rather than an invented catalog', async () => {
  const rows = await collectStorefrontCheckoutLinks(process.cwd());
  assert.ok(rows.length >= 30, 'real storefront should contain many distinct checkout URLs');
  assert.ok(rows.some(row => row.url === 'https://buy.stripe.com/7sYaEWdJW9cAeLogxW4Ni01'));
  assert.ok(rows.every(row => row.pages.length > 0));
  assert.equal(new Set(rows.map(row => row.url)).size, rows.length);
  // This only proves site HTML inventory, not that any Stripe link is live.
});

test('missing provider credentials cannot silently become an authenticated mapping', () => {
  assert.throws(() => validateStorefrontAuditConfig({}), /trusted_catalog_invalid/);
  const catalog = JSON.stringify([{
    accountId: 'acct_local_inventory', livemode: true,
    paymentLinkId: 'plink_local_inventory', priceId: 'price_local_inventory',
    sku: 'FACTURFORGE-LOCAL-TEST', amountTotal: 1900, currency: 'usd',
    fulfillmentMode: 'manual',
  }]);
  const base = {
    SAVAGE_STRIPE_PRODUCTS_JSON: catalog,
    SAVAGE_STRIPE_ACCOUNT_ID: 'acct_local_inventory',
    SAVAGE_STRIPE_MODE: 'live',
  };
  assert.throws(() => validateStorefrontAuditConfig(base), /account_scoped_read_configuration_required/);
  assert.throws(() => validateStorefrontAuditConfig({
    ...base, SAVAGE_STRIPE_READ_KEY: 'rk_test_local_invalid_mode',
  }), /account_scoped_read_configuration_required/);
  assert.throws(() => validateStorefrontAuditConfig({
    ...base, SAVAGE_STRIPE_ACCOUNT_ID: 'acct_other_local',
    SAVAGE_STRIPE_READ_KEY: 'rk_live_local_inert_not_used',
  }), /catalog_account_mode_or_sku_mismatch/);
});

test('actual operator command fails closed before any provider call without configured evidence', () => {
  const run = spawnSync(process.execPath, ['scripts/audit-stripe-storefront.mjs'], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 10000,
    env: {
      PATH: process.env.PATH ?? '',
      SYSTEMROOT: process.env.SYSTEMROOT ?? '',
    },
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Storefront offer audit failed/);
  assert.equal(run.stdout, '');
});
