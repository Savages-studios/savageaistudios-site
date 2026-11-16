#!/usr/bin/env node
/**
 * Operator-only buyer readiness audit over REAL site and Marketplace ledgers.
 * Never sends customer messages, issues grants, or certifies provider payment.
 */
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { reconcileCommercialFulfillment } from './audit-commerce-pipeline.mjs';
import { reconcileBuyerGrantStatus } from './reconcile-buyer-grant-status.mjs';
import { assessBuyerGrantCoverage } from './commerce-buyer-grant-gate.mjs';

const hash = report => {
  const unsigned = { ...report };
  delete unsigned.contentFingerprint;
  return createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
};
const fail = code => { throw new Error('buyer_readiness_audit:' + code); };
const verify = report => {
  if (!report || typeof report !== 'object'
      || !/^[a-f0-9]{64}$/.test(report.contentFingerprint ?? '')
      || report.contentFingerprint !== hash(report)) fail('invalid_report_fingerprint');
};

/**
 * The second reconciliation detects sales/marker changes during grant inspection.
 * The injection seam supports tests without any private ledger or provider access.
 */
export async function auditBuyerReadiness(env = process.env, {
  readSales = reconcileCommercialFulfillment,
  readGrants = reconcileBuyerGrantStatus,
} = {}) {
  const before = await readSales(env);
  verify(before);
  const grants = await readGrants(env);
  // Empty-grant Marketplace audit deliberately has no fingerprint when no grants exist.
  if (grants?.contentFingerprint !== undefined) verify(grants);
  const after = await readSales(env);
  verify(after);
  if (before.contentFingerprint !== after.contentFingerprint)
    fail('sale_or_marker_changed_during_audit');
  const coverage = assessBuyerGrantCoverage(after, grants);
  return Object.freeze({
    schema: 'savage.commercial.operator-buyer-readiness.v1',
    saleSnapshotFingerprint: after.contentFingerprint,
    grantSnapshotFingerprint: grants.contentFingerprint ?? null,
    ...coverage,
    schema: 'savage.commercial.operator-buyer-readiness.v1',
    actionable: Object.freeze({
      queuedForProviderVerification: after.counts.queuedForProviderVerification,
      awaitingBuyerReceipt: coverage.awaitingBuyer,
      locallyAcknowledgedButUnverified: coverage.locallyAcknowledged,
      revokedGrants: coverage.revoked,
      unsupportedAdapters: after.counts.noSupportedProvisioningAdapter,
    }),
    independentProviderPaymentVerified: false,
    independentBuyerDeliveryVerified: false,
    productionReady: false,
    requiresIndependentEvidence: true,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 2) {
    console.error('Usage: node scripts/audit-commercial-buyer-readiness.mjs');
    process.exitCode = 1;
  } else {
    auditBuyerReadiness().then(
      report => { console.log(JSON.stringify(report)); if (report.actionable.unsupportedAdapters) process.exitCode = 2; },
      () => { console.error('Buyer readiness audit refused; inspect private operator logs'); process.exitCode = 1; },
    );
  }
}
