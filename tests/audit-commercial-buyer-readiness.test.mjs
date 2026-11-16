import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { auditBuyerReadiness } from '../scripts/audit-commercial-buyer-readiness.mjs';
const H = c => c.repeat(64);
const Q = 'queued_for_independent_provider_verification';
const P = 'local_provision_marker_awaiting_buyer_receipt';
const U = 'no_supported_provisioning_adapter';
const signed = value => ({ ...value, contentFingerprint: createHash('sha256').update(JSON.stringify(value)).digest('hex') });
const sale = (stage=P) => ({eventDigest:H('a'),purchaseBinding:H('b'),sku:'facturforge',stage});
function commerce(stage=P) {
  const entries = [sale(stage)];
  return signed({schema:'savage.commercial.fulfillment.reconciliation.v1',count:1,entries,
    counts:{queuedForProviderVerification:stage===Q?1:0,localProvisionMarkersAwaitingBuyerReceipt:stage===P?1:0,noSupportedProvisioningAdapter:stage===U?1:0},
    independentlyVerifiedProviderPayment:false,customerDeliveryVerified:false,bankSettlementVerified:false});
}
function grants(status='awaiting_buyer_possession') {
  return signed({schema:'savage.commercial.buyer-grant-reconciliation.v1',inspectedCount:1,pendingUninspected:0,
    providerPaymentIndependentlyRechecked:false,buyerReceiptIndependentlyVerified:false,
    entries:[{eventDigest:H('a'),purchaseBinding:H('b'),grantId:H('c'),status,used:2,remaining:98,
      providerPaymentIndependentlyRechecked:false,buyerReceiptIndependentlyVerified:false}]});
}
const audit = (readSales, readGrants) => auditBuyerReadiness({}, {readSales,readGrants});
test('reads actual injected ledgers twice and reports buyer pending without certifying delivery',async()=>{
  let reads=0;const report=await audit(async()=>{reads++;return commerce()},async()=>grants());
  assert.equal(reads,2);assert.equal(report.actionable.awaitingBuyerReceipt,1);
  assert.equal(report.independentProviderPaymentVerified,false);
  assert.equal(report.productionReady,false);
});
test('revoked grant remains a blocker',async()=>{
  const report=await audit(async()=>commerce(),async()=>grants('revoked'));
  assert.equal(report.actionable.revokedGrants,1);
});
test('local buyer acknowledgement is not independent receipt',async()=>{
  const report=await audit(async()=>commerce(),async()=>grants('local_buyer_possession_acknowledged_unverified'));
  assert.equal(report.actionable.locallyAcknowledgedButUnverified,1);
  assert.equal(report.independentBuyerDeliveryVerified,false);
});
test('refuses changed sales between inspection reads',async()=>{
  let reads=0;
  await assert.rejects(audit(async()=>++reads===1?commerce():commerce(Q),async()=>grants()),/sale_or_marker_changed_during_audit/);
});
test('refuses corrupted sale fingerprint',async()=>{
  const invalid=commerce();invalid.entries[0].sku='changed';
  await assert.rejects(audit(async()=>invalid,async()=>grants()),/invalid_report_fingerprint/);
});
test('refuses corrupted grant fingerprint',async()=>{
  const invalid=grants();invalid.entries[0].used=99;
  await assert.rejects(audit(async()=>commerce(),async()=>invalid),/invalid_report_fingerprint/);
});
test('refuses grant for another purchase',async()=>{
  const invalid=grants();invalid.entries[0].purchaseBinding=H('d');
  const corrected=signed(Object.fromEntries(Object.entries(invalid).filter(([key])=>key!=='contentFingerprint')));
  await assert.rejects(audit(async()=>commerce(),async()=>corrected),/invalid_or_unbound_grant/);
});
test('refuses missing buyer inspection',async()=>{
  const empty=signed({schema:'savage.commercial.buyer-grant-reconciliation.v1',inspectedCount:0,pendingUninspected:0,
    providerPaymentIndependentlyRechecked:false,buyerReceiptIndependentlyVerified:false,entries:[]});
  await assert.rejects(audit(async()=>commerce(),async()=>empty),/missing_pending_grant_inspection/);
});
test('rejects fabricated provider payment acceptance',async()=>{
  const altered=commerce();altered.independentlyVerifiedProviderPayment=true;
  const corrected=signed(Object.fromEntries(Object.entries(altered).filter(([key])=>key!=='contentFingerprint')));
  await assert.rejects(audit(async()=>corrected,async()=>grants()),/invalid_input_contract/);
});
