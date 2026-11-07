#!/usr/bin/env node
/** Read-only operator recovery entrypoint. Requires PR #34 inspector and PR #33 claim writer.
 * Never invokes Marketplace, retries grants, changes files, or claims buyer delivery.
 */
import { readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { privateDirectory, readPrivateJson } from './provision-facturforge-purchases.mjs';
import { inspectSessionClaims } from './inspect-session-claims.mjs';

const fail = reason => { throw new Error('claim_ledger_reader:' + reason); };
const saleName = /^[a-f0-9]{64}\.json$/;
const claimName = /^session-[a-f0-9]{64}\.claim$/;
const digest = value => createHash('sha256').update(value).digest('hex');

export async function inspectPrivateClaimLedger({ledgerDirectory,markerDirectory}) {
  const ledger = await privateDirectory(ledgerDirectory);
  const markersDir = await privateDirectory(markerDirectory);
  if (resolve(ledger) === resolve(markersDir)) fail('storage_roots_must_be_distinct');
  const purchases = [], claims = [], markers = [];
  for (const name of (await readdir(ledger)).sort()) {
    if (!saleName.test(name)) {
      if (name.endsWith('.json')) fail('unexpected_purchase_filename');
      continue;
    }
    const row = await readPrivateJson(join(ledger,name));
    if (row?.sale?.sku !== 'COMM-20260908-MARKETPLACE-FACTURFORGE-PACK100') continue;
    if (name !== digest(row.eventId ?? '') + '.json') fail('purchase_filename_identity_mismatch');
    if (row.fulfillment?.status !== 'pending') fail('unexpected_purchase_status');
    purchases.push({
      eventId:row.eventId, checkoutSessionId:row.sale.checkoutSessionId,
      accountId:row.sale.accountId, livemode:row.sale.livemode,
      purchaseBinding:row.purchaseBinding,
    });
  }
  for (const name of (await readdir(markersDir)).sort()) {
    if (name.startsWith('session-') && !claimName.test(name)) fail('invalid_claim_filename');
    if (claimName.test(name)) {
      claims.push({filename:name,claim:await readPrivateJson(join(markersDir,name))});
    } else if (saleName.test(name)) {
      const row = await readPrivateJson(join(markersDir,name));
      if (row?.schema !== 'savage.facturforge.provision.v1') fail('unknown_provision_marker');
      markers.push(row);
    }
  }
  // A marker without its matching purchase is an accounting defect, not proof of fulfillment.
  const purchaseIds = new Set(purchases.map(p=>p.eventId));
  const purchaseSessions = new Set();
  for (const purchase of purchases) {
    const key = JSON.stringify([purchase.accountId,purchase.livemode,purchase.checkoutSessionId]);
    if (purchaseSessions.has(key)) fail('duplicate_checkout_session');
    purchaseSessions.add(key);
  }
  const claimEvents = new Set(claims.map(row=>row.claim?.eventId));
  for (const marker of markers) if (!purchaseIds.has(marker.eventId)) fail('orphan_provision_marker');
  for (const marker of markers) if (!claimEvents.has(marker.eventId)) fail('marker_without_session_claim');
  const inspection = inspectSessionClaims({claims,purchases,markers});
  return {...inspection,orphanMarkerCount:0,providerPaymentVerified:false,
    buyerDeliveryVerified:false,automaticRetryAllowed:false};
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  inspectPrivateClaimLedger({
    ledgerDirectory:process.env.SAVAGE_PURCHASE_LEDGER_DIR,
    markerDirectory:process.env.SAVAGE_FULFILLMENT_RECEIPT_DIR,
  }).then(result=>console.log(JSON.stringify(result)),
    error=>{console.error(error.message);process.exitCode=1;});
}
