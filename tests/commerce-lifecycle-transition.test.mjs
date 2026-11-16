import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assessCommerceLifecycleTransition } from '../scripts/commerce-lifecycle-transition.mjs';
const H = c => c.repeat(64);
const Q = 'queued_for_independent_provider_verification';
const P = 'local_provision_marker_awaiting_buyer_receipt';
const U = 'no_supported_provisioning_adapter';
function snapshot(entries) {
  const report = {schema:'savage.commercial.fulfillment.reconciliation.v1',count:entries.length,
    counts:{queuedForProviderVerification:entries.filter(e=>e.stage===Q).length,localProvisionMarkersAwaitingBuyerReceipt:entries.filter(e=>e.stage===P).length,noSupportedProvisioningAdapter:entries.filter(e=>e.stage===U).length},entries,
    independentlyVerifiedProviderPayment:false,customerDeliveryVerified:false,bankSettlementVerified:false};
  return {...report,contentFingerprint:createHash('sha256').update(JSON.stringify(report)).digest('hex')};
}
const sale=(eventDigest=H('a'),stage=Q)=>({eventDigest,purchaseBinding:H('b'),sku:'facturforge',stage});
const check=(a,b)=>assessCommerceLifecycleTransition(snapshot(a),snapshot(b));
test('empty snapshot stays empty and never proves payment',()=>{const x=check([],[]);assert.equal(x.productionAcceptance,false);assert.equal(x.newSales,0)});
test('new sales are counted',()=>assert.equal(check([],[sale()]).newSales,1));
test('legitimate queued to local marker transition',()=>assert.equal(check([sale()],[sale(H('a'),P)]).advancedToLocalProvisionMarker,1));
test('unchanged entries are counted',()=>assert.equal(check([sale()],[sale()]).unchanged,1));
test('sale disappearance refused',()=>assert.throws(()=>check([sale()],[]),/sale_disappeared/));
test('identity mutation refused',()=>assert.throws(()=>check([sale()],[{...sale(),purchaseBinding:H('c')}]),/sale_identity_mutated/));
test('reverse stage refused',()=>assert.throws(()=>check([sale(H('a'),P)],[sale()]),/invalid_stage_transition/));
test('unsupported stage cannot be provisioned',()=>assert.throws(()=>check([sale(H('a'),U)],[sale(H('a'),P)]),/invalid_stage_transition/));
test('duplicate sale IDs refused',()=>assert.throws(()=>check([], [sale(),sale()]),/invalid_or_duplicate_entry/));
test('altered fingerprint refused',()=>{const x=snapshot([sale()]);x.entries[0].stage=P;assert.throws(()=>assessCommerceLifecycleTransition(snapshot([]),x),/invalid_snapshot/)});
test('mismatched counts refused',()=>{const x=snapshot([sale()]);x.counts.queuedForProviderVerification=0;x.contentFingerprint=createHash('sha256').update(JSON.stringify({...x,contentFingerprint:undefined})).digest('hex');assert.throws(()=>assessCommerceLifecycleTransition(snapshot([]),x),/counts_mismatch/)});
test('fabricated independent acceptance flag refused',()=>{const x=snapshot([]);x.customerDeliveryVerified=true;assert.throws(()=>assessCommerceLifecycleTransition(snapshot([]),x),/invalid_snapshot/)});
