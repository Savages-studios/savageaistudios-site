import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assessBuyerGrantCoverage } from '../scripts/commerce-buyer-grant-gate.mjs';
const id = c => c.repeat(64);
const commerce = (entries) => {
  const report = {schema:'savage.commercial.fulfillment.reconciliation.v1',count:entries.length,counts:{queuedForProviderVerification:0,localProvisionMarkersAwaitingBuyerReceipt:entries.length,noSupportedProvisioningAdapter:0},entries,independentlyVerifiedProviderPayment:false,customerDeliveryVerified:false,bankSettlementVerified:false};
  return {...report,contentFingerprint:createHash('sha256').update(JSON.stringify(report)).digest('hex')};
};
const entry = (c,d) => ({eventDigest:id(c),purchaseBinding:id(d),stage:'local_provision_marker_awaiting_buyer_receipt'});
const grant = (c,d,g) => ({eventDigest:id(c),purchaseBinding:id(d),grantId:id(g),status:'awaiting_buyer_possession',used:0,remaining:100,providerPaymentIndependentlyRechecked:false,buyerReceiptIndependentlyVerified:false});
const grants = entries => ({schema:'savage.commercial.buyer-grant-reconciliation.v1',inspectedCount:entries.length,pendingUninspected:0,providerPaymentIndependentlyRechecked:false,buyerReceiptIndependentlyVerified:false,entries});
test('exact fingerprint and distinct grants accepted without payment claim',()=>{
  const r=assessBuyerGrantCoverage(commerce([entry('a','b'),entry('c','d')]),grants([grant('a','b','e'),grant('c','d','f')]));
  assert.equal(r.inspectedGrants,2); assert.equal(r.readyForAutomaticCustomerEntitlement,false);
});
test('changed sale binding with stale fingerprint rejected',()=>{
  const c=commerce([entry('a','b')]);c.entries[0].purchaseBinding=id('c');
  assert.throws(()=>assessBuyerGrantCoverage(c,grants([grant('a','c','e')])),/fingerprint_mismatch/);
});
test('missing snapshot fingerprint rejected',()=>{
  const c=commerce([entry('a','b')]);delete c.contentFingerprint;
  assert.throws(()=>assessBuyerGrantCoverage(c,grants([grant('a','b','e')])),/fingerprint_mismatch/);
});
test('duplicate grant identity across distinct sales rejected',()=>{
  assert.throws(()=>assessBuyerGrantCoverage(commerce([entry('a','b'),entry('c','d')]),grants([grant('a','b','e'),grant('c','d','e')])),/invalid_or_unbound_grant/);
});
test('unknown sale stage rejected even with valid fingerprint',()=>{
  const e=entry('a','b');e.stage='provider_paid_and_delivered';
  assert.throws(()=>assessBuyerGrantCoverage(commerce([e]),grants([])),/invalid_or_duplicate_sale/);
});
test('valid empty snapshots remain empty',()=>{
  const r=assessBuyerGrantCoverage(commerce([]),grants([]));assert.equal(r.sales,0);
});
