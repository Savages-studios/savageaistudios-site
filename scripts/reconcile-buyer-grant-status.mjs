#!/usr/bin/env node
/**
 * Read-only cross-repository commercial fulfillment status.
 * Uses Marketplace's actual compiled, buyer-bound grant-status CLI, not
 * direct access to its private ledger or a fabricated provider response.
 * Neither local records nor buyer HMAC state prove external customer receipt.
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { reconcileCommercialFulfillment } from './audit-commerce-pipeline.mjs';
import { FACTURFORGE_SKU, privateDirectory, readPrivateJson } from './provision-facturforge-purchases.mjs';

const exec = promisify(execFile);
const hex = /^[a-f0-9]{64}$/;
const methods = new Set(['dashboard-review', 'stripe-webhook', 'stripe-api-read', 'test-fixture']);
const requiredKeys = [
  'schema', 'grantId', 'product', 'revoked', 'used', 'allowance', 'remaining',
  'buyerPossessionAcknowledgedInLocalLedger', 'paymentEvidenceMethodInLocalLedger',
  'providerPaymentIndependentlyRechecked', 'buyerReceiptIndependentlyVerified',
].sort();
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = reason => { throw new Error('buyer_grant_reconciliation:' + reason); };

/** Strictly consume only the documented, redacted Marketplace CLI contract. */
export function validateMarketplaceGrantStatus(value, expectedGrantId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join('|') !== requiredKeys.join('|')
      || value.schema !== 'savage.facturforge.commercial-grant-status.v1'
      || !hex.test(expectedGrantId ?? '') || value.grantId !== expectedGrantId
      || value.product !== FACTURFORGE_SKU
      || typeof value.revoked !== 'boolean'
      || typeof value.buyerPossessionAcknowledgedInLocalLedger !== 'boolean'
      || value.providerPaymentIndependentlyRechecked !== false
      || value.buyerReceiptIndependentlyVerified !== false
      || !methods.has(value.paymentEvidenceMethodInLocalLedger)
      || value.allowance !== 100 || !Number.isSafeInteger(value.used)
      || !Number.isSafeInteger(value.remaining)
      || value.used < 0 || value.used > 100
      || value.remaining !== 100 - value.used)
    fail('invalid_marketplace_grant_status');
  return {
    grantId: value.grantId,
    status: value.revoked ? 'revoked'
      : value.buyerPossessionAcknowledgedInLocalLedger
        ? 'local_buyer_possession_acknowledged_unverified'
        : 'awaiting_buyer_possession',
    used: value.used, remaining: value.remaining,
    localPaymentEvidenceMethod: value.paymentEvidenceMethodInLocalLedger,
    providerPaymentIndependentlyRechecked: false,
    buyerReceiptIndependentlyVerified: false,
  };
}

function cliEnvironment(env, sale, grantId) {
  const allow = ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE'];
  const child = Object.fromEntries(allow.filter(key => env[key] !== undefined).map(key => [key, env[key]]));
  return {
    ...child, FACTURFORGE_PREPAID_DIR: env.FACTURFORGE_PREPAID_DIR,
    FACTURFORGE_STRIPE_ACCOUNT_ID: sale.accountId,
    FACTURFORGE_STRIPE_MODE: sale.livemode ? 'live' : 'test',
    FACTURFORGE_GRANT_ID: grantId,
    FACTURFORGE_CHECKOUT_SESSION_ID: sale.checkoutSessionId,
    FACTURFORGE_EXPECTED_BUYER_EMAIL: sale.buyerEmail,
  };
}

/** Read actual site ledger/markers and inspect only already provisioned grants. */
export async function reconcileBuyerGrantStatus(env = process.env) {
  const initial = await reconcileCommercialFulfillment(env);
  const pending = initial.entries.filter(row => row.stage === 'local_provision_marker_awaiting_buyer_receipt');
  if (!pending.length) return {
    schema: 'savage.commercial.buyer-grant-reconciliation.v1',
    inspectedCount: 0, entries: [], pendingUninspected: 0,
    providerPaymentIndependentlyRechecked: false, buyerReceiptIndependentlyVerified: false,
  };
  const cli = env.SAVAGE_MARKETPLACE_GRANT_STATUS_CLI;
  if (typeof cli !== 'string' || !isAbsolute(cli)
      || basename(cli) !== 'inspect-commerce-grant.js'
      || typeof env.FACTURFORGE_PREPAID_DIR !== 'string'
      || !isAbsolute(env.FACTURFORGE_PREPAID_DIR))
    fail('compiled_marketplace_status_cli_and_private_grants_required');
  const ledger = await privateDirectory(env.SAVAGE_PURCHASE_LEDGER_DIR);
  const markers = await privateDirectory(env.SAVAGE_FULFILLMENT_RECEIPT_DIR);
  const entries = [];
  for (const row of pending) {
    if (!hex.test(row.eventDigest) || !hex.test(row.purchaseBinding))
      fail('invalid_sale_identity');
    const filename = row.eventDigest + '.json';
    const saleRecord = await readPrivateJson(join(ledger, filename));
    const marker = await readPrivateJson(join(markers, filename));
    const sale = saleRecord.sale;
    if (saleRecord.purchaseBinding !== row.purchaseBinding
        || digest(saleRecord.eventId) !== row.eventDigest
        || sale?.sku !== FACTURFORGE_SKU
        || marker?.schema !== 'savage.facturforge.provision.v1'
        || marker.purchaseBinding !== row.purchaseBinding
        || marker.checkoutSessionId !== sale.checkoutSessionId
        || !hex.test(marker.grantId ?? '')
        || marker.status !== 'provisioned_pending_buyer_receipt'
        || marker.customerNotified !== false)
      fail('sale_or_marker_changed_during_inspection');
    let stdout;
    try {
      ({ stdout } = await exec(process.execPath, [resolve(cli)], {
        timeout: 30_000, maxBuffer: 4096, windowsHide: true,
        env: cliEnvironment(env, sale, marker.grantId),
      }));
    } catch { fail('marketplace_status_inspection_failed'); }
    let status;
    try { status = validateMarketplaceGrantStatus(JSON.parse(stdout), marker.grantId); }
    catch { fail('marketplace_status_contract_invalid'); }
    entries.push({ eventDigest: row.eventDigest, purchaseBinding: row.purchaseBinding, ...status });
  }
  const final = await reconcileCommercialFulfillment(env);
  if (final.contentFingerprint !== initial.contentFingerprint)
    fail('sale_or_marker_set_changed_during_inspection');
  const report = {
    schema: 'savage.commercial.buyer-grant-reconciliation.v1',
    inspectedCount: entries.length, entries,
    pendingUninspected: 0,
    providerPaymentIndependentlyRechecked: false,
    buyerReceiptIndependentlyVerified: false,
  };
  return { ...report, contentFingerprint: digest(JSON.stringify(report)) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 2) {
    console.error('Usage: npm run audit:buyer-grants');
    process.exitCode = 1;
  } else {
    reconcileBuyerGrantStatus().then(
      report => console.log(JSON.stringify(report)),
      () => { console.error('Buyer grant reconciliation refused; inspect private operator logs'); process.exitCode = 1; },
    );
  }
}
