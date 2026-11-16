import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { inspectPrivateClaimLedger } from '../scripts/inspect-private-claim-ledger.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const eventId='evt_claimread1', checkoutSessionId='cs_test_claimread1';
const accountId='acct_claimread1', purchaseBinding='a'.repeat(64);
const purchase={schemaVersion:1,eventId,purchaseBinding,
  sale:{sku:'COMM-20260908-MARKETPLACE-FACTURFORGE-PACK100',checkoutSessionId,accountId,livemode:false},
  fulfillment:{status:'pending'}};
const claim={schema:'savage.facturforge.session-claim.v1',eventId,checkoutSessionId,purchaseBinding};
async function setup(t){
  const root=await mkdtemp(join(tmpdir(),'claim-read-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const ledger=join(root,'ledger'),markers=join(root,'markers');
  await mkdir(ledger,{mode:0o700});await mkdir(markers,{mode:0o700});
  const saleFile=join(ledger,hash(eventId)+'.json');
  const claimFile=join(markers,'session-'+hash(JSON.stringify([accountId,false,checkoutSessionId]))+'.claim');
  await writeFile(saleFile,JSON.stringify(purchase),{mode:0o600});
  await writeFile(claimFile,JSON.stringify(claim),{mode:0o600});
  return {ledger,markers,saleFile,claimFile};
}
test('reads actual private claim records and refuses automatic retry',async t=>{
 const x=await setup(t);
 const r=await inspectPrivateClaimLedger({ledgerDirectory:x.ledger,markerDirectory:x.markers});
 assert.equal(r.count,1);assert.equal(r.entries[0].automaticRetryAllowed,false);
 assert.equal(r.providerPaymentVerified,false);assert.equal(r.buyerDeliveryVerified,false);
});
test('orphaned claim fails closed',async t=>{
 const x=await setup(t);await rm(x.saleFile);
 await assert.rejects(inspectPrivateClaimLedger({ledgerDirectory:x.ledger,markerDirectory:x.markers}),/claim_purchase_binding_conflict/);
});
test('corrupt claim filename fails closed',async t=>{
 const x=await setup(t);
 await writeFile(join(x.markers,'session-not-a-digest.claim'),'{}',{mode:0o600});
 await assert.rejects(inspectPrivateClaimLedger({ledgerDirectory:x.ledger,markerDirectory:x.markers}),/invalid_claim_filename/);
});
test('orphan provision marker fails closed',async t=>{
 const x=await setup(t);
 await writeFile(join(x.markers,hash('evt_unknown')+'.json'),
 JSON.stringify({schema:'savage.facturforge.provision.v1',eventId:'evt_unknown'}),{mode:0o600});
 await assert.rejects(inspectPrivateClaimLedger({ledgerDirectory:x.ledger,markerDirectory:x.markers}),/orphan_provision_marker/);
});
test('corrupt private claim cannot be read as trusted evidence',async t=>{
 const x=await setup(t);await writeFile(x.claimFile,'{bad json',{mode:0o600});
 await assert.rejects(inspectPrivateClaimLedger({ledgerDirectory:x.ledger,markerDirectory:x.markers}),/private_record_unreadable/);
});

test('rejects purchase whose filename does not bind to event identity',async t=>{
 const x=await setup(t);
 await writeFile(x.saleFile,JSON.stringify({...purchase,eventId:'evt_forged_claimread2'}),{mode:0o600});
 await assert.rejects(inspectPrivateClaimLedger({ledgerDirectory:x.ledger,markerDirectory:x.markers}),/purchase_filename_identity_mismatch/);
});
test('rejects duplicate checkout session across distinct event records',async t=>{
 const x=await setup(t);
 const duplicate={...purchase,eventId:'evt_duplicate_claimread2'};
 await writeFile(join(x.ledger,hash(duplicate.eventId)+'.json'),JSON.stringify(duplicate),{mode:0o600});
 await assert.rejects(inspectPrivateClaimLedger({ledgerDirectory:x.ledger,markerDirectory:x.markers}),/duplicate_checkout_session/);
});
test('rejects provisioning marker without durable claim',async t=>{
 const x=await setup(t);
 await rm(x.claimFile);
 await writeFile(join(x.markers,hash(eventId)+'.json'),JSON.stringify({
  schema:'savage.facturforge.provision.v1',eventId,purchaseBinding,
  checkoutSessionId,grantId:'b'.repeat(64),status:'provisioned_pending_buyer_receipt'
 }),{mode:0o600});
 await assert.rejects(inspectPrivateClaimLedger({ledgerDirectory:x.ledger,markerDirectory:x.markers}),/marker_without_session_claim/);
});
test('rejects unexpected JSON purchase filenames',async t=>{
 const x=await setup(t);
 await writeFile(join(x.ledger,'unbound.json'),'{}',{mode:0o600});
 await assert.rejects(inspectPrivateClaimLedger({ledgerDirectory:x.ledger,markerDirectory:x.markers}),/unexpected_purchase_filename/);
});
