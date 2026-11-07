import { createHash } from 'node:crypto';
const hex=/^[a-f0-9]{64}$/;
const session=/^cs_(test|live)_[A-Za-z0-9_]+$/;
const event=/^evt_[A-Za-z0-9_]+$/;
const fail=reason=>{throw new Error('session_claim_inspection:'+reason)};
const digest=value=>createHash('sha256').update(value).digest('hex');
/** Read-only PR #33 claim protocol assessment. Claims are never provider receipts.
 * Inputs must be read from private records, not supplied by customers.
 * No result authorizes automatic retry or customer entitlement revocation. */
export function inspectSessionClaims({claims,purchases,markers}) {
  if(!Array.isArray(claims)||!Array.isArray(purchases)||!Array.isArray(markers)) fail('record_arrays_required');
  const purchasesByEvent=new Map();
  for(const row of purchases) {
    if(!event.test(row?.eventId??'')||!session.test(row?.checkoutSessionId??'')
      ||!/^acct_[A-Za-z0-9_]+$/.test(row?.accountId??'')
      ||typeof row.livemode!=='boolean'||!hex.test(row?.purchaseBinding??'')
      ||row.checkoutSessionId.startsWith('cs_live_')!==row.livemode
      ||purchasesByEvent.has(row.eventId)) fail('invalid_or_duplicate_purchase');
    purchasesByEvent.set(row.eventId,row);
  }
  const markerByEvent=new Map();
  for(const marker of markers) {
    if(!event.test(marker?.eventId??'')||markerByEvent.has(marker.eventId)
      ||!hex.test(marker?.purchaseBinding??'')||!hex.test(marker?.grantId??'')
      ||marker.status!=='provisioned_pending_buyer_receipt') fail('invalid_or_duplicate_marker');
    markerByEvent.set(marker.eventId,marker);
  }
  const seenNames=new Set(),entries=[];
  for(const {filename,claim} of claims) {
    if(typeof filename!=='string'||!/^session-[a-f0-9]{64}\.claim$/.test(filename)
      ||seenNames.has(filename)) fail('invalid_or_duplicate_claim_name');
    seenNames.add(filename);
    if(claim?.schema!=='savage.facturforge.session-claim.v1'
      ||!event.test(claim.eventId??'')||!session.test(claim.checkoutSessionId??'')
      ||!hex.test(claim.purchaseBinding??'')) fail('incomplete_or_corrupt_claim');
    const purchase=purchasesByEvent.get(claim.eventId);
    if(!purchase||purchase.checkoutSessionId!==claim.checkoutSessionId
      ||purchase.purchaseBinding!==claim.purchaseBinding
      ||filename!=='session-'+digest(JSON.stringify([
        purchase.accountId,purchase.livemode,purchase.checkoutSessionId,
      ]))+'.claim') fail('claim_purchase_binding_conflict');
    const marker=markerByEvent.get(claim.eventId);
    if(marker&&(marker.purchaseBinding!==claim.purchaseBinding
      ||marker.checkoutSessionId!==claim.checkoutSessionId)) fail('marker_claim_conflict');
    entries.push({filename,eventId:claim.eventId,
      status:marker?'local_marker_present_provider_and_buyer_unverified'
        :'uncertain_external_grant_outcome_manual_reconciliation_required',
      automaticRetryAllowed:false,providerPaymentVerified:false,buyerDeliveryVerified:false});
  }
  return {schema:'savage.facturforge.claim-recovery-inspection.v1',
    count:entries.length,entries,automaticRetryAllowed:false,
    providerPaymentVerified:false,buyerDeliveryVerified:false};
}
