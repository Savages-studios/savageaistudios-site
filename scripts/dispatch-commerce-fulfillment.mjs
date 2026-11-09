#!/usr/bin/env node
/**
 * Cross-offer commercial fulfillment dispatcher.
 *
 * This is an operator tool, NOT a payment processor. It consumes the actual
 * validated sale/marker reconciliation and invokes ONLY the existing compiled
 * FacturForge Marketplace provider-verifying adapter. Unknown SKUs never
 * receive credentials or fabricated grants.
 */
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { reconcileCommercialFulfillment } from './audit-commerce-pipeline.mjs';
import { FACTURFORGE_SKU, provisionPendingFacturForgeSales } from './provision-facturforge-purchases.mjs';

const fail = (reason) => { throw new Error('commercial_dispatch:' + reason); };
const digest = /^[a-f0-9]{64}$/;
const allowedStages = new Set([
  'queued_for_independent_provider_verification',
  'local_provision_marker_awaiting_buyer_receipt',
  'no_supported_provisioning_adapter',
]);

/**
 * Transform the REAL reconciliation contract into a product-specific work plan.
 * This function is pure so a plan can be independently reviewed without keys.
 */
export function buildCommercialFulfillmentPlan(reconciliation) {
  if (reconciliation?.schema !== 'savage.commercial.fulfillment.reconciliation.v1'
      || !Array.isArray(reconciliation.entries)
      || reconciliation.entries.length !== reconciliation.count
      || reconciliation.independentlyVerifiedProviderPayment !== false
      || reconciliation.customerDeliveryVerified !== false
      || reconciliation.bankSettlementVerified !== false) fail('invalid_reconciliation_contract');
  // The reconciliation report is a coherent snapshot contract, not merely an
  // arbitrary array of work items. Reject stale or modified reports before
  // calculating a grant plan. SHA-256 detects accidental mutation; it is NOT
  // provider authentication or a signature.
  const { contentFingerprint, ...unsignedReport } = reconciliation;
  const expectedFingerprint = createHash('sha256')
    .update(JSON.stringify(unsignedReport)).digest('hex');
  if (typeof contentFingerprint !== 'string'
      || !/^[a-f0-9]{64}$/.test(contentFingerprint)
      || contentFingerprint !== expectedFingerprint)
    fail('reconciliation_fingerprint_mismatch');
  if (!Number.isSafeInteger(reconciliation.count) || reconciliation.count < 0)
    fail('invalid_reconciliation_count');
  const seen = new Set();
  const bySku = new Map();
  for (const row of reconciliation.entries) {
    if (!row || !digest.test(row.eventDigest ?? '')
        || !digest.test(row.purchaseBinding ?? '')
        || typeof row.sku !== 'string' || !/^[A-Za-z0-9_-]{3,180}$/.test(row.sku)
        || !allowedStages.has(row.stage)
        || seen.has(row.eventDigest)) fail('invalid_or_duplicate_reconciliation_entry');
    seen.add(row.eventDigest);
    if (row.stage !== 'no_supported_provisioning_adapter' && row.sku !== FACTURFORGE_SKU)
      fail('unexpected_provisioning_adapter');
    const group = bySku.get(row.sku) ?? {
      sku: row.sku, adapter: row.sku === FACTURFORGE_SKU ? 'facturforge-marketplace-stripe-read' : null,
      queued: 0, pendingBuyerReceipt: 0, unsupported: 0,
    };
    if (row.stage === 'queued_for_independent_provider_verification') group.queued++;
    else if (row.stage === 'local_provision_marker_awaiting_buyer_receipt') group.pendingBuyerReceipt++;
    else group.unsupported++;
    bySku.set(row.sku, group);
  }
  const products = [...bySku.values()].sort((a, b) => a.sku.localeCompare(b.sku));
  const queued = products.reduce((sum, product) => sum + product.queued, 0);
  const pendingBuyerReceipt = products.reduce((sum, product) => sum + product.pendingBuyerReceipt, 0);
  const unsupported = products.reduce((sum, product) => sum + product.unsupported, 0);
  if (queued !== reconciliation.counts?.queuedForProviderVerification
      || pendingBuyerReceipt !== reconciliation.counts?.localProvisionMarkersAwaitingBuyerReceipt
      || unsupported !== reconciliation.counts?.noSupportedProvisioningAdapter)
    fail('reconciliation_counts_mismatch');
  return {
    schema: 'savage.commercial.fulfillment.dispatch-plan.v1',
    purchaseCount: reconciliation.count,
    products, queued, pendingBuyerReceipt, unsupported,
    requiresOperatorReview: unsupported > 0 || pendingBuyerReceipt > 0,
    customerPaymentIndependentlyAccepted: false,
    customerDeliveryVerified: false,
  };
}

export async function dispatchCommercialFulfillment(env = process.env, { execute = false } = {}) {
  if (typeof execute !== 'boolean') fail('invalid_execution_mode');
  const before = await reconcileCommercialFulfillment(env);
  const plan = buildCommercialFulfillmentPlan(before);
  if (!execute) return { ...plan, mode: 'plan', executionAttempted: false };
  // This opt-in authorizes the operator to use the existing read-only provider
  // verification and real grant issuance path, never a new payment or charge.
  if (env.SAVAGE_ALLOW_EXISTING_PAYMENT_FULFILLMENT !== 'YES')
    fail('explicit_operator_fulfillment_opt_in_required');
  if (env.SAVAGE_CHECKOUT_SESSION_ID !== undefined)
    fail('single_session_filter_not_supported_for_full_dispatch');
  if (!plan.queued) return { ...plan, mode: 'execute', executionAttempted: false, noWork: true };

  const result = await provisionPendingFacturForgeSales(env);
  const after = await reconcileCommercialFulfillment(env);
  const next = buildCommercialFulfillmentPlan(after);
  const prior = new Map(before.entries.map(row => [row.eventDigest, row]));
  if (prior.size !== after.entries.length) fail('sale_set_changed_during_dispatch');
  for (const row of after.entries) {
    const old = prior.get(row.eventDigest);
    if (!old || old.sku !== row.sku || old.purchaseBinding !== row.purchaseBinding)
      fail('sale_identity_changed_during_dispatch');
    if (old.stage === 'queued_for_independent_provider_verification'
        && row.stage !== 'local_provision_marker_awaiting_buyer_receipt')
      fail('incomplete_provider_verified_provisioning');
    if (old.stage !== 'queued_for_independent_provider_verification' && row.stage !== old.stage)
      fail('unexpected_stage_change_during_dispatch');
  }
  return {
    ...next, mode: 'execute', executionAttempted: true,
    marketplaceProvisioning: result,
    customerPaymentIndependentlyAccepted: false,
    customerDeliveryVerified: false,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && !['--plan', '--execute'].includes(args[0]))) {
    console.error('Usage: npm run dispatch:commerce -- [--plan|--execute]');
    process.exitCode = 1;
  } else {
    dispatchCommercialFulfillment(process.env, { execute: args[0] === '--execute' }).then(
      result => { console.log(JSON.stringify(result)); if (result.unsupported) process.exitCode = 2; },
      () => { console.error('Commercial dispatch refused; inspect private operator logs'); process.exitCode = 1; },
    );
  }
}
