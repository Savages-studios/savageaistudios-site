#!/usr/bin/env node
/**
 * Read-only commercial operations reconciliation across the existing
 * signed-webhook sale ledger and private FacturForge provisioning markers.
 *
 * A local record is NOT independent Stripe verification, customer delivery,
 * bank settlement, or a cryptographically authenticated proof of payment.
 */
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateOfferCatalog } from '../api/stripe-verifier.mjs';
import {
  FACTURFORGE_SKU, privateDirectory, readPrivateJson,
} from './provision-facturforge-purchases.mjs';

const hex = /^[a-f0-9]{64}$/;
const claimName = /^[a-f0-9]{64}\.claim$/;
const eventId = /^evt_[A-Za-z0-9_]+$/;
const sessionId = /^cs_(test|live)_[A-Za-z0-9_]+$/;
const buyerEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sha = (value) => createHash('sha256').update(value).digest('hex');
const fail = (reason) => { throw new Error('commercial_reconciliation:' + reason); };

function checkSale(row, filename, offers) {
  const sale = row?.sale;
  const fulfillment = row?.fulfillment;
  if (row?.schemaVersion !== 1 || !eventId.test(row?.eventId ?? '')
      || filename !== sha(row.eventId) + '.json'
      || !hex.test(row.purchaseBinding ?? '')
      || !sale || !fulfillment || !sessionId.test(sale.checkoutSessionId ?? '')
      || !buyerEmail.test(sale.buyerEmail ?? '') || sale.buyerEmail.length > 254
      || !/^[A-Za-z0-9_-]{3,180}$/.test(sale.sku ?? '')
      || !Number.isSafeInteger(sale.amountTotal) || sale.amountTotal <= 0
      || !/^[a-z]{3}$/.test(sale.currency ?? '')
      || !/^acct_[A-Za-z0-9_]+$/.test(sale.accountId ?? '')
      || typeof sale.livemode !== 'boolean'
      || sale.checkoutSessionId.startsWith('cs_live_') !== sale.livemode
      || sale.providerEventId !== row.eventId
      || fulfillment.sku !== sale.sku || !['pending', 'revoked'].includes(fulfillment.status)
      || fulfillment.sourceEventId !== row.eventId
      || !['manual', 'automated'].includes(fulfillment.method))
    fail('invalid_sale_record');
  const identity = {
    eventId: row.eventId, sessionId: sale.checkoutSessionId,
    customerEmail: sale.buyerEmail, sku: sale.sku,
    amountTotal: sale.amountTotal, currency: sale.currency,
    accountId: sale.accountId, livemode: sale.livemode,
    fulfillmentMode: fulfillment.method,
  };
  if (sha(JSON.stringify(identity)) !== row.purchaseBinding)
    fail('sale_binding_mismatch');
  const offer = offers.get(sale.sku);
  if (offer && (offer.accountId !== sale.accountId
      || offer.livemode !== sale.livemode
      || offer.amountTotal !== sale.amountTotal
      || offer.currency !== sale.currency
      || offer.fulfillmentMode !== fulfillment.method))
    fail('trusted_offer_terms_mismatch');
  return { sale, offer };
}

function checkMarker(marker, row) {
  if (marker?.schema !== 'savage.facturforge.provision.v1'
      || marker.eventId !== row.eventId
      || marker.purchaseBinding !== row.purchaseBinding
      || marker.checkoutSessionId !== row.sale.checkoutSessionId
      || !hex.test(marker.grantId ?? '')
      || marker.status !== 'provisioned_pending_buyer_receipt'
      || marker.customerNotified !== false)
    fail('invalid_or_conflicting_provision_marker');
}

export async function reconcileCommercialFulfillment(env = process.env) {
  let offers;
  try {
    offers = validateOfferCatalog(JSON.parse(env.SAVAGE_STRIPE_PRODUCTS_JSON ?? 'null'));
  } catch { fail('trusted_offer_catalog_invalid'); }
  const bySku = new Map();
  for (const offer of offers) {
    if (bySku.has(offer.sku)) fail('duplicate_trusted_sku');
    bySku.set(offer.sku, offer);
  }
  const ledger = await privateDirectory(env.SAVAGE_PURCHASE_LEDGER_DIR);
  const markers = await privateDirectory(env.SAVAGE_FULFILLMENT_RECEIPT_DIR);
  if (resolve(ledger) === resolve(markers)) fail('distinct_storage_roots_required');

  // A sale row survives refunds. Its checkout-session claim is the
  // authoritative revocation gate. Never queue a refunded purchase again.
  // Legacy sales without claims remain visible for explicit migration review.
  const claims = new Map();
  for (const name of (await readdir(ledger)).sort()) {
    if (!name.endsWith('.claim')) continue;
    if (!claimName.test(name)) fail('unexpected_claim_filename');
    const claim = await readPrivateJson(join(ledger, name));
    if (claim?.schemaVersion !== 2 || claim.kind !== 'checkout-session-claim'
        || !['pending', 'fulfilled', 'revoked'].includes(claim.state)
        || typeof claim.sessionId !== 'string'
        || typeof claim.livemode !== 'boolean'
        || claim.claimKey !== `${claim.livemode ? 'live' : 'test'}:${claim.sessionId}`
        || name !== sha(claim.claimKey) + '.claim'
        || !eventId.test(claim.eventId ?? '')
        || (claim.recordFile !== null && !hex.test((claim.recordFile ?? '').replace(/\.json$/, '')))
        || (claim.recordFile !== null && !claim.recordFile.endsWith('.json')))
      fail('invalid_checkout_claim');
    if (claims.has(claim.claimKey)) fail('duplicate_checkout_claim');
    claims.set(claim.claimKey, claim);
  }

  const entries = [];
  const saleNames = new Set();
  for (const name of (await readdir(ledger)).sort()) {
    if (!name.endsWith('.json')) continue; // ignore temporary publication files
    if (!hex.test(name.slice(0, -5))) fail('unexpected_sale_filename');
    const row = await readPrivateJson(join(ledger, name));
    // Check the durable claim before interpreting a revoked sale as actionable.
    const rawSale = row?.sale;
    const claim = typeof rawSale?.livemode === 'boolean' && typeof rawSale?.checkoutSessionId === 'string'
      ? claims.get(`${rawSale.livemode ? 'live' : 'test'}:${rawSale.checkoutSessionId}`) : null;
    const { sale, offer } = checkSale(row, name, bySku);
    if (claim) {
      if (claim.state === 'revoked') {
        if (claim.recordFile !== name || claim.eventId !== row.eventId
            || row.fulfillment.status !== 'revoked'
            || row.revocation?.eventId !== claim.revocationEventId)
          fail('revoked_checkout_record_conflict');
        fail('revoked_checkout_must_not_be_reprovisioned');
      }
      if (claim.state !== 'fulfilled' || claim.recordFile !== name
          || claim.eventId !== row.eventId)
        fail('sale_checkout_claim_conflict');
    }
    if (row.fulfillment.status === 'revoked') fail('revoked_sale_without_matching_claim');
    saleNames.add(name);
    let marker;
    try { marker = await readPrivateJson(join(markers, name)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (marker) {
      if (sale.sku !== FACTURFORGE_SKU || !offer)
        fail('marker_for_unprovisionable_offer');
      checkMarker(marker, row);
    }
    entries.push({
      eventDigest: name.slice(0, -5),
      sku: sale.sku,
      stage: marker ? 'local_provision_marker_awaiting_buyer_receipt'
        : sale.sku === FACTURFORGE_SKU && offer
          ? 'queued_for_independent_provider_verification'
          : 'no_supported_provisioning_adapter',
      purchaseBinding: row.purchaseBinding,
    });
  }
  for (const name of await readdir(markers)) {
    if (!name.endsWith('.json')) continue;
    if (!hex.test(name.slice(0, -5)) || !saleNames.has(name))
      fail('orphan_or_unexpected_provision_marker');
  }
  const counts = {
    queuedForProviderVerification: 0,
    localProvisionMarkersAwaitingBuyerReceipt: 0,
    noSupportedProvisioningAdapter: 0,
  };
  for (const entry of entries) {
    if (entry.stage === 'queued_for_independent_provider_verification')
      counts.queuedForProviderVerification++;
    else if (entry.stage === 'local_provision_marker_awaiting_buyer_receipt')
      counts.localProvisionMarkersAwaitingBuyerReceipt++;
    else counts.noSupportedProvisioningAdapter++;
  }
  const report = {
    schema: 'savage.commercial.fulfillment.reconciliation.v1',
    count: entries.length, counts, entries,
    independentlyVerifiedProviderPayment: false,
    customerDeliveryVerified: false,
    bankSettlementVerified: false,
  };
  return { ...report, contentFingerprint: sha(JSON.stringify(report)) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  reconcileCommercialFulfillment().then(
    (result) => console.log(JSON.stringify(result)),
    () => {
      console.error('Commercial reconciliation failed; inspect private operator logs');
      process.exitCode = 1;
    },
  );
}
