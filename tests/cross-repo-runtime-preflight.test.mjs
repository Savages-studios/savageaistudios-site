/** Local negative operator tests only; successful cross-repo execution needs both real checkouts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyCrossRepoOfflineContract } from '../integration/verify-cross-repo-offline-contract.mjs';

const script = fileURLToPath(new URL('../integration/verify-cross-repo-offline-contract.mjs', import.meta.url));

test('cross-repo verifier refuses absent compiled Marketplace code before creating grants', async () => {
  await assert.rejects(verifyCrossRepoOfflineContract({}),
    /compiled_marketplace_modules_required/);
});

test('cross-repo verifier refuses mismatched or noncompiled module locations', async () => {
  for (const env of [
    { SAVAGE_MARKETPLACE_PREPAID_MODULE: '/tmp/prepaid.ts',
      SAVAGE_MARKETPLACE_GRANT_STATUS_CLI: '/tmp/inspect-commerce-grant.js' },
    { SAVAGE_MARKETPLACE_PREPAID_MODULE: '/tmp/one/prepaid.js',
      SAVAGE_MARKETPLACE_GRANT_STATUS_CLI: '/tmp/two/inspect-commerce-grant.js' },
    { SAVAGE_MARKETPLACE_PREPAID_MODULE: 'prepaid.js',
      SAVAGE_MARKETPLACE_GRANT_STATUS_CLI: 'inspect-commerce-grant.js' },
  ]) await assert.rejects(verifyCrossRepoOfflineContract(env),
    /compiled_marketplace_modules_required/);
});

test('cross-repo verifier requires compiled invoice generator and real fixture from same Marketplace build', async () => {
  const base = {
    SAVAGE_MARKETPLACE_PREPAID_MODULE: '/tmp/facturforge/dist/prepaid.js',
    SAVAGE_MARKETPLACE_GRANT_STATUS_CLI: '/tmp/facturforge/dist/inspect-commerce-grant.js',
  };
  for (const change of [
    {},
    { SAVAGE_MARKETPLACE_INVOICE_MODULE: '/tmp/other/dist/index.js',
      SAVAGE_MARKETPLACE_INVOICE_FIXTURE: '/tmp/facturforge/fixtures/invoice-en16931.json' },
    { SAVAGE_MARKETPLACE_INVOICE_MODULE: '/tmp/facturforge/dist/index.ts',
      SAVAGE_MARKETPLACE_INVOICE_FIXTURE: '/tmp/facturforge/fixtures/invoice-en16931.json' },
    { SAVAGE_MARKETPLACE_INVOICE_MODULE: '/tmp/facturforge/dist/index.js',
      SAVAGE_MARKETPLACE_INVOICE_FIXTURE: '/tmp/other/fixtures/invoice-en16931.json' },
  ]) await assert.rejects(verifyCrossRepoOfflineContract({ ...base, ...change }),
    /compiled_marketplace_modules_required/);
});

test('actual CLI exits nonzero without Marketplace modules and never claims success', () => {
  const run = spawnSync(process.execPath, [script], {
    encoding: 'utf8', env: { PATH: process.env.PATH ?? '' },
  });
  assert.equal(run.status, 1);
  assert.equal(run.stdout, '');
  assert.match(run.stderr, /compiled_marketplace_modules_required/);
  assert.doesNotMatch(run.stderr, /productionAccepted.*true/);
});
