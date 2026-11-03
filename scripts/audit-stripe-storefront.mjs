#!/usr/bin/env node
/**
 * Read-only, account-bound reconciliation of actual storefront checkout URLs
 * against authenticated Stripe Payment Link + Price objects.
 * This never creates payments, entitlements, credentials or customers.
 */
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateOfferCatalog } from '../api/stripe-verifier.mjs';

const error = code => { throw new Error('storefront_offer_audit:' + code); };
const excluded = new Set(['.git', 'node_modules', '.next', 'dist', 'coverage', '.vercel']);
const id = (prefix, value) => typeof value === 'string'
  && new RegExp('^' + prefix + '_[A-Za-z0-9_]+$').test(value);

export async function collectStorefrontCheckoutLinks(root) {
  const base = resolve(root);
  if (!(await lstat(base)).isDirectory()) error('site_root_invalid');
  const found = new Map();
  let examined = 0;
  async function walk(directory) {
    for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (excluded.has(item.name)) continue;
      const full = join(directory, item.name);
      const stat = await lstat(full);
      if (stat.isSymbolicLink()) error('site_symlink_not_allowed');
      if (stat.isDirectory()) { await walk(full); continue; }
      if (!stat.isFile() || !item.name.endsWith('.html')) continue;
      if (++examined > 1000 || stat.size > 2_000_000) error('site_scan_limit_exceeded');
      const html = await readFile(full, 'utf8');
      for (const match of html.matchAll(/\bhref\s*=\s*["'](https:\/\/buy\.stripe\.com\/[^"'\s<>]+)["']/gi)) {
        let url;
        try { url = new URL(match[1].replaceAll('&amp;', '&')); }
        catch { error('invalid_checkout_url'); }
        if (url.protocol !== 'https:' || url.hostname !== 'buy.stripe.com'
            || !/^\/[A-Za-z0-9]+$/.test(url.pathname)
            || url.search || url.hash || url.username || url.password)
          error('unsupported_checkout_url');
        const normalized = url.href;
        if (!found.has(normalized)) found.set(normalized, new Set());
        found.get(normalized).add(relative(base, full).replaceAll('\\', '/'));
      }
    }
  }
  await walk(base);
  if (found.size === 0) error('no_checkout_links_found');
  return [...found].sort(([a], [b]) => a.localeCompare(b))
    .map(([url, paths]) => ({ url, pages: [...paths].sort() }));
}

export function validateStorefrontAuditConfig(env) {
  let offers;
  try { offers = validateOfferCatalog(JSON.parse(env.SAVAGE_STRIPE_PRODUCTS_JSON ?? 'null')); }
  catch { error('trusted_catalog_invalid'); }
  const accountId = env.SAVAGE_STRIPE_ACCOUNT_ID;
  const mode = env.SAVAGE_STRIPE_MODE;
  const readKey = env.SAVAGE_STRIPE_READ_KEY;
  if (!id('acct', accountId) || !['live', 'test'].includes(mode)
      || typeof readKey !== 'string'
      || !/^(rk|sk)_(live|test)_[A-Za-z0-9_]+$/.test(readKey)
      || readKey.includes('_live_') !== (mode === 'live'))
    error('account_scoped_read_configuration_required');
  const seenSku = new Set();
  for (const offer of offers) {
    if (offer.accountId !== accountId || offer.livemode !== (mode === 'live')
        || seenSku.has(offer.sku)) error('catalog_account_mode_or_sku_mismatch');
    seenSku.add(offer.sku);
  }
  return { accountId, livemode: mode === 'live', readKey, offers };
}

async function stripeGet(path, key) {
  const response = await fetch('https://api.stripe.com/v1/' + path, {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' },
    redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) error('provider_get_failed_' + response.status);
  let data;
  try { data = await response.json(); } catch { error('provider_invalid_json'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) error('provider_invalid_object');
  return data;
}

export async function auditStorefrontOffers(env = process.env) {
  const { accountId, livemode, readKey, offers } = validateStorefrontAuditConfig(env);
  const checkoutLinks = await collectStorefrontCheckoutLinks(env.SAVAGE_STOREFRONT_ROOT ?? process.cwd());
  const account = await stripeGet('account', readKey);
  if (account.object !== 'account' || account.id !== accountId)
    error('authenticated_stripe_account_mismatch');

  const byUrl = new Map();
  let cursor;
  for (let page = 0; page < 100; page++) {
    const query = 'payment_links?limit=100'
      + (cursor ? '&starting_after=' + encodeURIComponent(cursor) : '');
    const result = await stripeGet(query, readKey);
    if (result.object !== 'list' || !Array.isArray(result.data)
        || typeof result.has_more !== 'boolean') error('invalid_provider_link_page');
    for (const link of result.data) {
      if (!id('plink', link?.id) || typeof link.url !== 'string'
          || typeof link.livemode !== 'boolean' || typeof link.active !== 'boolean'
          || byUrl.has(link.url)) error('invalid_or_duplicate_provider_link');
      byUrl.set(link.url, link);
    }
    if (!result.has_more) { cursor = undefined; break; }
    const last = result.data.at(-1);
    if (!last || !id('plink', last.id) || last.id === cursor) error('invalid_provider_pagination');
    cursor = last.id;
    if (page === 99) error('provider_pagination_limit');
  }
  const byLinkId = new Map(offers.map(offer => [offer.paymentLinkId, offer]));
  const results = [];
  for (const { url, pages } of checkoutLinks) {
    const link = byUrl.get(url);
    let status;
    let sku = null;
    if (!link) status = 'missing_from_authenticated_account';
    else if (link.livemode !== livemode || !link.active) status = 'inactive_or_wrong_mode';
    else {
      const offer = byLinkId.get(link.id);
      if (!offer) status = 'no_trusted_fulfillment_mapping';
      else {
        sku = offer.sku;
        const lines = await stripeGet('payment_links/' + link.id + '/line_items?limit=2', readKey);
        const item = lines?.data?.[0];
        const price = item?.price;
        status = lines.object === 'list' && lines.has_more === false
          && Array.isArray(lines.data) && lines.data.length === 1
          && item.quantity === 1 && price?.id === offer.priceId
          && price?.unit_amount === offer.amountTotal
          && price?.currency === offer.currency
          ? 'authenticated_link_price_and_catalog_match' : 'provider_offer_terms_mismatch';
      }
    }
    results.push({ url, pages, sku, status });
  }
  const verified = results.filter(row => row.status === 'authenticated_link_price_and_catalog_match').length;
  return {
    schema: 'savage.storefront.stripe.offer-audit.v1',
    accountId, livemode, storefrontLinks: results.length,
    authenticatedMappings: verified, unresolved: results.length - verified,
    readyForOfferRouting: verified === results.length,
    results,
    customerPaymentVerified: false, customerFulfillmentVerified: false,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  auditStorefrontOffers().then(report => {
    console.log(JSON.stringify(report));
    if (!report.readyForOfferRouting) process.exitCode = 2;
  }, () => {
    console.error('Storefront offer audit failed; inspect private operator logs');
    process.exitCode = 1;
  });
}
