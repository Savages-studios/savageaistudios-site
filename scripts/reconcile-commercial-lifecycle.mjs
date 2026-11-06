#!/usr/bin/env node
/**
 * Read-only, cross-system readiness assessment for real site sale ledgers and
 * Marketplace grant-status reports. No payment, grant, delivery or revocation.
 * Local acknowledgments must never be presented as provider/buyer acceptance.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { reconcileCommercialFulfillment } from './audit-commerce-pipeline.mjs';
import { reconcileBuyerGrantStatus } from './reconcile-buyer-grant-status.mjs';

const hex = /^[a-f0-9]{64}$/;
const fail = reason => { throw new Error('commercial_lifecycle:' + reason); };
const saleStages = new Set([
  'queued_for_independent_provider_verification',
  'local_provision_marker_awaiting_buyer_receipt',
  'no_supported_provisioning_adapter',
]);
const grantStages = new Set([
  'revoked', 'local_buyer_possession_acknowledged_unverified',
  'awaiting_buyer_possession',
]);

/**
 * Deterministically joins real sale and grant contracts by BOTH event digest
 * and purchase binding. Fails closed on missing, orphaned or conflicting grants.
 * Reports work remaining; never infers an invoice, delivery or paid receipt.
 */
export function assessCommercialLifecycle(sales, grants) {
  if (sales?.schema !== 'savage.commercial.fulfillment.reconciliation.v1'
      || !Array.isArray(sales.entries) || sales.count !== sales.entries.length
      || sales.independentlyVerifiedProviderPayment !== false
      || sales.customerDeliveryVerified !== false
      || sales.bankSettlementVerified !== false
      || grants?.schema !== 'savage.commercial.buyer-grant-reconciliation.v1'
      || !Array.isArray(grants.entries) || grants.inspectedCount !== grants.entries.length
      || grants.pendingUninspected !== 0
      || grants.providerPaymentIndependentlyRechecked !== false
      || grants.buyerReceiptIndependentlyVerified !== false)
    fail('invalid_source_contract');

  const bySale = new Map();
  for (const row of sales.entries) {
    if (!hex.test(row?.eventDigest ?? '') || !hex.test(row?.purchaseBinding ?? '')
        || !saleStages.has(row.stage) || bySale.has(row.eventDigest))
      fail('duplicate_or_invalid_sale');
    bySale.set(row.eventDigest, row);
  }
  const byGrant = new Map();
  const grantIds = new Set();
  for (const grant of grants.entries) {
    const sale = bySale.get(grant?.eventDigest);
    if (!sale || sale.stage !== 'local_provision_marker_awaiting_buyer_receipt'
        || grant.purchaseBinding !== sale.purchaseBinding
        || !hex.test(grant.grantId ?? '') || grantIds.has(grant.grantId)
        || byGrant.has(grant.eventDigest) || !grantStages.has(grant.status)
        || grant.providerPaymentIndependentlyRechecked !== false
        || grant.buyerReceiptIndependentlyVerified !== false
        || !Number.isSafeInteger(grant.used) || grant.used < 0
        || !Number.isSafeInteger(grant.remaining) || grant.remaining < 0
        || grant.used + grant.remaining !== 100)
      fail('orphaned_or_conflicting_grant');
    byGrant.set(grant.eventDigest, grant);
    grantIds.add(grant.grantId);
  }

  const entries = [];
  for (const sale of sales.entries) {
    const grant = byGrant.get(sale.eventDigest);
    if (sale.stage === 'local_provision_marker_awaiting_buyer_receipt' && !grant)
      fail('uninspected_provisioned_sale');
    const blockers = [];
    if (sale.stage === 'no_supported_provisioning_adapter') blockers.push('unsupported_product');
    else if (!grant) blockers.push('provider_verification_and_grant_pending');
    else if (grant.status === 'revoked') blockers.push('grant_revoked');
    else blockers.push('independent_buyer_delivery_receipt_missing');
    blockers.push('authenticated_provider_settlement_receipt_missing');
    blockers.push('invoice_and_quota_reconciliation_missing');
    blockers.push('refund_and_dispute_reconciliation_missing');
    entries.push({
      eventDigest: sale.eventDigest, purchaseBinding: sale.purchaseBinding,
      sku: sale.sku, stage: sale.stage,
      grantId: grant?.grantId ?? null,
      localGrantStatus: grant?.status ?? null,
      quotaRemainingInLocalLedger: grant?.remaining ?? null,
      blockers,
      accepted: false,
    });
  }
  return {
    schema: 'savage.commercial.lifecycle-readiness.v1',
    purchaseCount: entries.length, inspectedGrantCount: byGrant.size,
    entries, acceptedCustomerTransactions: 0,
    providerConfirmedPayment: false, independentlyObservedBuyerDelivery: false,
    invoiceAndQuotaReconciled: false, refundReconciled: false,
  };
}

export async function inspectCommercialLifecycle(env = process.env) {
  // The buyer inspection invokes only the existing read-only Marketplace CLI.
  // Its local flags are never upgraded into independently observed evidence.
  const sales = await reconcileCommercialFulfillment(env);
  const grants = await reconcileBuyerGrantStatus(env);
  return assessCommercialLifecycle(sales, grants);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  inspectCommercialLifecycle().then(
    report => console.log(JSON.stringify(report)),
    () => { console.error('Commercial lifecycle inspection refused; inspect private operator logs'); process.exitCode = 1; },
  );
}
