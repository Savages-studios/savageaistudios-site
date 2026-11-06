#!/usr/bin/env node
/**
 * Revenue bridge: signed Stripe webhook sale ledger -> existing FacturForge
 * read-only Stripe verification CLI -> durable pending-buyer-receipt marker.
 *
 * No local sale record is payment authority. The Marketplace CLI independently
 * reads Stripe and must complete before this worker records provisioning.
 * This command never delivers a credential, creates a payment, or deploys.
 */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateOfferCatalog } from '../api/stripe-verifier.mjs';

const exec = promisify(execFile);
export const FACTURFORGE_SKU = 'COMM-20260908-MARKETPLACE-FACTURFORGE-PACK100';
const hex = /^[a-f0-9]{64}$/;
const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const event = /^evt_[A-Za-z0-9_]+$/;
const session = /^cs_(test|live)_[A-Za-z0-9_]+$/;
const fail = (reason) => { throw new Error('facturforge_revenue_bridge:' + reason); };
const digest = (value) => createHash('sha256').update(value).digest('hex');

export async function privateDirectory(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) fail('absolute_private_directory_required');
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()
      || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0))
    fail('private_directory_invalid');
  if (process.platform === 'win32') {
    // Windows 8.3 short names and long names can refer to the same directory.
    // Comparing realpath() to resolve() falsely rejects safe private roots.
    // Instead refuse symlinks/junctions in EVERY path component, including
    // ancestors, without treating 8.3 canonicalization as a symlink.
    for (let cursor = resolve(path); ; cursor = dirname(cursor)) {
      if ((await lstat(cursor)).isSymbolicLink()) fail('private_directory_invalid');
      if (dirname(cursor) === cursor) break;
    }
  } else if (await realpath(path) !== resolve(path)) {
    fail('private_directory_invalid');
  }
  return path;
}

export async function readPrivateJson(path) {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size < 2 || before.size > 32768
      || (process.platform !== 'win32' && ((before.mode & 0o077) !== 0 || before.nlink !== 1)))
    fail('private_record_invalid');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino
        || opened.size !== before.size || opened.mtimeMs !== before.mtimeMs) fail('private_record_changed');
    const raw = await handle.readFile();
    const after = await lstat(path);
    if (raw.length !== before.size || after.dev !== opened.dev || after.ino !== opened.ino
        || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs)
      fail('private_record_changed');
    try { return JSON.parse(raw.toString('utf8')); }
    catch { return fail('private_record_unreadable'); }
  } finally { await handle.close(); }
}

export function verifyQueuedFacturForgePurchase(row, filename, offer) {
  if (!row || row.schemaVersion !== 1 || !event.test(row.eventId)
      || filename !== digest(row.eventId) + '.json'
      || !row.sale || !row.fulfillment || !hex.test(row.purchaseBinding ?? ''))
    fail('purchase_record_invalid');
  const sale = row.sale;
  const task = row.fulfillment;
  if (!session.test(sale.checkoutSessionId)
      || sale.checkoutSessionId.startsWith('cs_live_') !== offer.livemode
      || !email.test(sale.buyerEmail ?? '') || sale.buyerEmail.length > 254
      || sale.providerEventId !== row.eventId || sale.sku !== FACTURFORGE_SKU
      || sale.sku !== offer.sku || sale.amountTotal !== 1900
      || sale.amountTotal !== offer.amountTotal || sale.currency !== 'usd'
      || sale.currency !== offer.currency || sale.accountId !== offer.accountId
      || sale.livemode !== offer.livemode
      || task.status !== 'pending' || task.sku !== offer.sku
      || task.sourceEventId !== row.eventId || task.method !== offer.fulfillmentMode)
    fail('purchase_terms_mismatch');
  const identity = {
    eventId: row.eventId, sessionId: sale.checkoutSessionId,
    customerEmail: sale.buyerEmail, sku: sale.sku,
    amountTotal: sale.amountTotal, currency: sale.currency,
    accountId: sale.accountId, livemode: sale.livemode,
    fulfillmentMode: task.method,
  };
  if (row.purchaseBinding !== digest(JSON.stringify(identity))) fail('purchase_binding_mismatch');
  return identity;
}

function settings(env) {
  let catalog;
  try { catalog = validateOfferCatalog(JSON.parse(env.SAVAGE_STRIPE_PRODUCTS_JSON ?? 'null')); }
  catch { fail('trusted_catalog_invalid'); }
  const matches = catalog.filter((offer) => offer.sku === FACTURFORGE_SKU);
  if (matches.length !== 1 || matches[0].amountTotal !== 1900
      || matches[0].currency !== 'usd') fail('facturforge_offer_not_configured');
  const offer = matches[0];
  const key = env.FACTURFORGE_STRIPE_READ_KEY;
  if (typeof key !== 'string' || !/^(sk|rk)_(live|test)_[A-Za-z0-9_]+$/.test(key)
      || key.includes('_live_') !== offer.livemode) fail('provider_read_key_missing_or_wrong_mode');
  if (env.SAVAGE_CHECKOUT_SESSION_ID !== undefined
      && !session.test(env.SAVAGE_CHECKOUT_SESSION_ID))
    fail('invalid_selected_checkout');
  return { offer, key };
}

async function writeMarker(directory, filename, record) {
  const path = join(directory, filename);
  let handle;
  try { handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
    | (constants.O_NOFOLLOW ?? 0), 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = await readPrivateJson(path);
    if (existing.schema !== record.schema || existing.eventId !== record.eventId
        || existing.purchaseBinding !== record.purchaseBinding
        || existing.checkoutSessionId !== record.checkoutSessionId
        || existing.status !== record.status || !hex.test(existing.grantId ?? ''))
      fail('conflicting_provision_marker');
    return false;
  }
  try { await handle.writeFile(JSON.stringify(record) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  if (process.platform !== 'win32') {
    const parent = await open(directory, 'r');
    try { await parent.sync(); } finally { await parent.close(); }
  }
  return true;
}

export async function provisionPendingFacturForgeSales(env = process.env) {
  const { offer, key } = settings(env);
  const ledger = await privateDirectory(env.SAVAGE_PURCHASE_LEDGER_DIR);
  const markers = await privateDirectory(env.SAVAGE_FULFILLMENT_RECEIPT_DIR);
  const grantDirectory = await privateDirectory(env.FACTURFORGE_PREPAID_DIR);
  const deliveryDirectory = await privateDirectory(env.FACTURFORGE_PRIVATE_DELIVERY_DIR);
  if (new Set([ledger, markers, grantDirectory, deliveryDirectory].map((path) => resolve(path))).size !== 4)
    fail('storage_roots_must_be_distinct');
  const cli = env.FACTURFORGE_PROVISION_CLI;
  if (typeof cli !== 'string' || !isAbsolute(cli) || !cli.endsWith('.js'))
    fail('compiled_marketplace_cli_required');
  const cliStat = await lstat(cli);
  if (!cliStat.isFile() || cliStat.isSymbolicLink()) fail('compiled_marketplace_cli_invalid');
  // Preflight the entire FacturForge queue BEFORE any Marketplace grant is issued.
  // Two signed events for one Checkout Session are one purchase, not two grants.
  const queued = [];
  let skipped = 0;
  const sessionOwners = new Map();
  for (const filename of (await readdir(ledger)).sort()) {
    if (!hex.test(filename.slice(0, -5)) || !filename.endsWith('.json')) continue;
    const row = await readPrivateJson(join(ledger, filename));
    if (row?.sale?.sku !== FACTURFORGE_SKU) { skipped++; continue; }
    const purchase = verifyQueuedFacturForgePurchase(row, filename, offer);
    const key = purchase.sessionId;
    if (sessionOwners.has(key)) fail('duplicate_checkout_session_in_queue');
    sessionOwners.set(key, filename);
    queued.push({ filename, row, purchase });
  }
  let processed = 0;
  let already = 0;
  for (const { filename, row, purchase } of queued) {
    if (env.SAVAGE_CHECKOUT_SESSION_ID
        && purchase.sessionId !== env.SAVAGE_CHECKOUT_SESSION_ID) { skipped++; continue; }
    const markerName = filename;
    let existing;
    try { existing = await readPrivateJson(join(markers, markerName)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existing) {
      if (existing.schema !== 'savage.facturforge.provision.v1'
          || existing.eventId !== row.eventId
          || existing.purchaseBinding !== row.purchaseBinding
          || existing.checkoutSessionId !== purchase.sessionId
          || existing.status !== 'provisioned_pending_buyer_receipt'
          || !hex.test(existing.grantId ?? ''))
        fail('existing_marker_conflicts_with_purchase');
      already++;
      continue;
    }
    // This invokes the existing Marketplace production CLI, not a fake
    // successful payment adapter. The CLI makes authenticated Stripe GETs,
    // verifies the actual paid Checkout, and commits the private grant.
    let stdout;
    try {
      ({ stdout } = await exec(process.execPath, [cli], {
        timeout: 120000, maxBuffer: 16384, windowsHide: true,
        env: {
          ...env,
          FACTURFORGE_STRIPE_ACCOUNT_ID: offer.accountId,
          FACTURFORGE_STRIPE_MODE: offer.livemode ? 'live' : 'test',
          FACTURFORGE_STRIPE_PAYMENT_LINK_ID: offer.paymentLinkId,
          FACTURFORGE_STRIPE_PRICE_ID: offer.priceId,
          FACTURFORGE_STRIPE_READ_KEY: key,
          FACTURFORGE_CHECKOUT_SESSION_ID: purchase.sessionId,
          FACTURFORGE_EXPECTED_BUYER_EMAIL: purchase.customerEmail,
        },
      }));
    } catch { fail('authenticated_marketplace_provisioning_failed'); }
    let result;
    try { result = JSON.parse(stdout); }
    catch { fail('marketplace_provision_result_invalid'); }
    if (!hex.test(result?.grantId ?? '') || typeof result.issued !== 'boolean'
        || result.customerNotified !== false || result.moneyMoved !== false
        || (result.issued
          ? result.deliveryStatus !== 'pending-private-delivery'
            || result.credentialRecordPath !== join(deliveryDirectory, result.grantId + '.json')
          : result.deliveryStatus !== 'previously-provisioned'
            || result.credentialRecordPath !== null))
      fail('marketplace_provision_result_invalid');
    const marker = {
      schema: 'savage.facturforge.provision.v1',
      eventId: row.eventId, purchaseBinding: row.purchaseBinding,
      checkoutSessionId: purchase.sessionId,
      grantId: result.grantId,
      status: 'provisioned_pending_buyer_receipt',
      customerNotified: false,
    };
    if (await writeMarker(markers, markerName, marker)) processed++;
    else already++;
  }
  return { processed, already, skipped, customerDeliveryVerified: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  provisionPendingFacturForgeSales().then(
    (result) => { console.log(JSON.stringify(result)); },
    () => { console.error('FacturForge revenue bridge failed; inspect private operator logs'); process.exitCode = 1; },
  );
}
