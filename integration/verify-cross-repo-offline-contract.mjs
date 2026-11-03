#!/usr/bin/env node
/**
 * Executable cross-repository CONTRACT proof using both REAL compiled modules.
 * All purchase and buyer records are explicitly OFFLINE fixtures. The harness
 * invokes the REAL compiled FacturForge invoice generator and persists its
 * output through the real prepaid grant. No provider payment, independently
 * delivered customer invoice, or external customer acceptance is represented.
 */
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PurchaseLedger } from '../api/purchase-ledger.mjs';
import { reconcileBuyerGrantStatus } from '../scripts/reconcile-buyer-grant-status.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw new Error('cross_repo_offline_contract:' + message); };

export async function verifyCrossRepoOfflineContract(env = process.env) {
  const modulePath = env.SAVAGE_MARKETPLACE_PREPAID_MODULE;
  const cliPath = env.SAVAGE_MARKETPLACE_GRANT_STATUS_CLI;
  const invoiceModulePath = env.SAVAGE_MARKETPLACE_INVOICE_MODULE;
  const invoiceFixturePath = env.SAVAGE_MARKETPLACE_INVOICE_FIXTURE;
  if (typeof modulePath !== 'string' || !isAbsolute(modulePath)
      || basename(modulePath) !== 'prepaid.js'
      || typeof cliPath !== 'string' || !isAbsolute(cliPath)
      || basename(cliPath) !== 'inspect-commerce-grant.js'
      || dirname(resolve(modulePath)) !== dirname(resolve(cliPath))
      || typeof invoiceModulePath !== 'string' || !isAbsolute(invoiceModulePath)
      || basename(invoiceModulePath) !== 'index.js'
      || dirname(resolve(invoiceModulePath)) !== dirname(resolve(modulePath))
      || typeof invoiceFixturePath !== 'string' || !isAbsolute(invoiceFixturePath)
      || basename(invoiceFixturePath) !== 'invoice-en16931.json'
      || dirname(resolve(invoiceFixturePath)) !== resolve(dirname(modulePath), '../fixtures'))
    fail('compiled_marketplace_modules_required');
  // Actual Marketplace compiled code and its transitive dependencies must exist.
  const { FacturForgePrepaidStore, FACTURFORGE_PACK } =
    await import(pathToFileURL(resolve(modulePath)).href);
  const { generateInvoice } = await import(pathToFileURL(resolve(invoiceModulePath)).href);
  const invoice = JSON.parse(await readFile(invoiceFixturePath, 'utf8'));
  assert.equal(typeof generateInvoice, 'function');
  const root = await mkdtemp(join(tmpdir(), 'savage-cross-repo-offline-'));
  try {
    const ledger = join(root, 'sales');
    const markers = join(root, 'markers');
    const grants = join(root, 'grants');
    for (const dir of [ledger, markers, grants]) await mkdir(dir, { mode: 0o700 });
    const accountId = 'acct_offline_cross_repo';
    const checkoutSessionId = 'cs_test_cross_repo';
    const buyerEmail = 'offline-buyer@example.invalid';
    const eventId = 'evt_offline_cross_repo';
    const store = new FacturForgePrepaidStore({
      directory: grants, accountId, livemode: false,
    });
    const receipt = {
      provider: 'stripe', accountId, livemode: false, checkoutSessionId,
      customerEmail: buyerEmail, paymentStatus: 'paid',
      sku: FACTURFORGE_PACK.sku, paymentLink: FACTURFORGE_PACK.paymentLink,
      amountTotal: FACTURFORGE_PACK.amountTotal,
      currency: FACTURFORGE_PACK.currency, quantity: 1,
      verification: {
        method: 'test-fixture', reviewer: 'offline-cross-repo-contract',
        observedAt: '2026-11-02T00:00:00Z',
        evidenceRef: 'local test fixture; no Stripe request or payment',
      },
    };
    const grant = await store.provisionVerifiedPurchase(receipt);
    assert.ok(grant.credential);
    const saved = await new PurchaseLedger(ledger).record({
      eventId, sessionId: checkoutSessionId, customerEmail: buyerEmail,
      sku: FACTURFORGE_PACK.sku, amountTotal: FACTURFORGE_PACK.amountTotal,
      currency: FACTURFORGE_PACK.currency, accountId, livemode: false,
      observedAt: '2026-11-02T00:00:00Z', fulfillmentMode: 'manual',
    });
    await writeFile(join(markers, digest(eventId) + '.json'), JSON.stringify({
      schema: 'savage.facturforge.provision.v1', eventId,
      purchaseBinding: saved.row.purchaseBinding, checkoutSessionId,
      grantId: grant.grantId,
      status: 'provisioned_pending_buyer_receipt', customerNotified: false,
    }), { mode: 0o600 });
    const operator = {
      SAVAGE_PURCHASE_LEDGER_DIR: ledger,
      SAVAGE_FULFILLMENT_RECEIPT_DIR: markers,
      SAVAGE_STRIPE_PRODUCTS_JSON: JSON.stringify([{
        accountId, livemode: false, paymentLinkId: 'plink_offline_cross_repo',
        priceId: 'price_offline_cross_repo', sku: FACTURFORGE_PACK.sku,
        amountTotal: FACTURFORGE_PACK.amountTotal,
        currency: FACTURFORGE_PACK.currency, fulfillmentMode: 'manual',
      }]),
      FACTURFORGE_PREPAID_DIR: grants,
      SAVAGE_MARKETPLACE_GRANT_STATUS_CLI: cliPath,
      PATH: process.env.PATH ?? '',
      ...(process.platform === 'win32' ? {
        SystemRoot: process.env.SystemRoot ?? '', WINDIR: process.env.WINDIR ?? '',
        TEMP: process.env.TEMP ?? '', TMP: process.env.TMP ?? '',
      } : {}),
    };
    const inspect = async (expectedStatus, expectedRemaining) => {
      const report = await reconcileBuyerGrantStatus(operator);
      assert.equal(report.inspectedCount, 1);
      assert.equal(report.entries.length, 1);
      const row = report.entries[0];
      assert.equal(row.grantId, grant.grantId);
      assert.equal(row.purchaseBinding, saved.row.purchaseBinding);
      assert.equal(row.status, expectedStatus);
      assert.equal(row.remaining, expectedRemaining);
      assert.equal(row.providerPaymentIndependentlyRechecked, false);
      assert.equal(row.buyerReceiptIndependentlyVerified, false);
      assert.equal(row.localPaymentEvidenceMethod, 'test-fixture');
      assert.equal(report.providerPaymentIndependentlyRechecked, false);
      assert.equal(report.buyerReceiptIndependentlyVerified, false);
      assert.equal(JSON.stringify(report).includes(grant.credential), false);
      assert.equal(JSON.stringify(report).includes(buyerEmail), false);
      return row;
    };
    await inspect('awaiting_buyer_possession', 100);
    const issuer = 'https://identity.example.invalid/';
    const subject = 'offline-buyer-subject';
    const jti = 'cross-repo-offline-0001';
    const begun = await store.beginBuyerCredentialPossession(
      grant.grantId, checkoutSessionId, buyerEmail, grant.credential,
      issuer, subject, jti, Date.now() + 120000,
    );
    const proof = createHmac('sha256', grant.credential)
      .update(JSON.stringify(['facturforge-credential-possession-v1',
        grant.grantId, issuer, subject, jti, begun.challenge]))
      .digest('base64url');
    await store.acknowledgeBuyerCredentialPossession(
      grant.grantId, checkoutSessionId, buyerEmail, grant.credential,
      issuer, subject, jti, begun.challenge, proof,
    );
    await inspect('local_buyer_possession_acknowledged_unverified', 100);
    // Generate a REAL EN16931 invoice from Marketplace's existing offline
    // fixture, through the actual durable prepaid delivery transaction.
    const invoiceBytes = Buffer.from(JSON.stringify(invoice));
    const generated = await store.deliver(grant.credential,
      'cross-repo-offline-real-invoice-0001', invoiceBytes,
      () => generateInvoice(invoice));
    assert.equal(generated.ok, true);
    assert.match(generated.data.xml, /CrossIndustryInvoice/);
    assert.match(generated.data.xmlDigest, /^sha256:[a-f0-9]{64}$/);
    const used = await inspect('local_buyer_possession_acknowledged_unverified', 99);
    assert.equal(used.used, 1);
    // Restart the actual store: same idempotency key must return persisted
    // invoice bytes without calling the generator or spending another credit.
    const restarted = new FacturForgePrepaidStore({
      directory: grants, accountId, livemode: false,
    });
    const replay = await restarted.deliver(grant.credential,
      'cross-repo-offline-real-invoice-0001', invoiceBytes,
      async () => { throw new Error('invoice_must_not_regenerate_on_replay'); });
    assert.deepEqual(replay, generated);
    await inspect('local_buyer_possession_acknowledged_unverified', 99);
    // A genuinely invalid input to the real generator cannot consume quota.
    const invalidInvoice = structuredClone(invoice);
    invalidInvoice.lines[0].vat.ratePercent = '0.00';
    const rejected = await restarted.deliver(grant.credential,
      'cross-repo-offline-invalid-invoice-0002',
      Buffer.from(JSON.stringify(invalidInvoice)),
      () => generateInvoice(invalidInvoice));
    assert.equal(rejected.ok, false);
    assert.equal(rejected.data, null);
    await inspect('local_buyer_possession_acknowledged_unverified', 99);
    await store.revoke(grant.grantId, 'offline cross-repo revocation check');
    await inspect('revoked', 99);
    return {
      schema: 'savage.cross-repo.offline-contract-proof.v1',
      checks: ['compiled_marketplace_cli', 'real_site_sale_marker',
        'local_buyer_acknowledgment', 'real_offline_invoice_generation',
        'durable_quota_debit', 'restart_idempotent_invoice_replay',
        'invalid_invoice_no_debit', 'revocation', 'redaction',
        'original_buyer_checkout_account_binding'],
      paymentProviderContacted: false, actualPaymentVerified: false,
      actualInvoiceGeneratedFromOfflineFixture: true,
      invoiceDeliveredToRealCustomer: false,
      independentBuyerReceiptVerified: false,
      productionAccepted: false,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  verifyCrossRepoOfflineContract().then(
    result => console.log(JSON.stringify(result)),
    error => {
      // No raw provider, customer or private path details in public CI output.
      console.error('Cross-repo offline contract refused: ' +
        (error.message === 'cross_repo_offline_contract:compiled_marketplace_modules_required'
          ? 'compiled_marketplace_modules_required' : 'integration_failed'));
      process.exitCode = 1;
    },
  );
}
