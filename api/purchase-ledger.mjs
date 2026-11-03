import { createHash, randomBytes } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { mkdir, open, link, lstat, unlink } from 'node:fs/promises';
import { isAbsolute, join, parse, sep } from 'node:path';

/**
 * A sale record contains personal information and controls a paid delivery.
 * Filesystem permissions are part of the security boundary, not a deployment
 * suggestion. Reject symlinks anywhere in the ledger path and refuse shared
 * directories before creating or reading a purchase.
 */
async function assertPrivateLedgerPath(directory) {
  const root = parse(directory).root;
  const components = directory.slice(root.length).split(sep).filter(Boolean);
  const checkPath = async (allowMissing) => {
    let cursor = root;
    for (const component of components) {
      cursor = join(cursor, component);
      let part;
      try { part = await lstat(cursor); }
      catch (error) {
        if (allowMissing && error.code === 'ENOENT') return;
        throw error;
      }
      if (part.isSymbolicLink()) throw new Error('purchase ledger path must not contain symlinks');
    }
  };
  // Check BEFORE mkdir: recursive creation would otherwise traverse an
  // attacker-selected symlink and create private files in the wrong tree.
  await checkPath(true);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await checkPath(false);
  const state = await lstat(directory);
  if (!state.isDirectory()) throw new Error('purchase ledger path must be a directory');
  if (process.platform !== 'win32' &&
      ((state.mode & 0o077) !== 0 || state.uid !== process.getuid()))
    throw new Error('purchase ledger directory must be private and process-owned');
}

/** Verify an existing replay record through the same descriptor we read. */
async function readSafeReplay(path) {
  const noFollow = process.platform === 'win32' ? 0 : (fsConstants.O_NOFOLLOW ?? 0);
  const handle = await open(path, fsConstants.O_RDONLY | noFollow);
  try {
    const state = await handle.stat();
    if (!state.isFile() || state.nlink !== 1 || state.size < 2 || state.size > 512 * 1024 ||
        (process.platform !== 'win32' && ((state.mode & 0o077) !== 0 ||
          state.uid !== process.getuid())))
      throw new Error('unsafe existing purchase ledger record');
    return JSON.parse(await handle.readFile('utf8'));
  } finally {
    await handle.close();
  }
}

/**
 * Durable idempotent sale + fulfillment queue, committed in one atomic file
 * per Stripe event. The work is not considered delivered merely because a
 * checkout succeeded. No user PII is served through a public read endpoint.
 */
export class PurchaseLedger {
  constructor(directory) {
    if (!isAbsolute(directory)) throw new Error('A private absolute purchase ledger directory is required');
    this.directory = directory;
  }

  async record(purchase) {
    if (!/^evt_[A-Za-z0-9_]+$/.test(purchase?.eventId ?? '')) throw new Error('invalid event ID');
    await assertPrivateLedgerPath(this.directory);
    const key = createHash('sha256').update(purchase.eventId).digest('hex');
    const destination = join(this.directory, `${key}.json`);
    // Stripe signs each retry at a fresh timestamp. Signature observation time
    // must not change the identity of an otherwise identical purchase.
    const { observedAt, ...identity } = purchase;
    const binding = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
    const row = {
      schemaVersion: 1, eventId: purchase.eventId, purchaseBinding: binding,
      sale: {
        checkoutSessionId: purchase.sessionId,
        buyerEmail: purchase.customerEmail,
        sku: purchase.sku,
        amountTotal: purchase.amountTotal,
        currency: purchase.currency,
        accountId: purchase.accountId,
        livemode: purchase.livemode,
        providerEventId: purchase.eventId,
        purchasedAt: purchase.observedAt
      },
      fulfillment: {
        sku: purchase.sku,
        status: 'pending',
        method: purchase.fulfillmentMode,
        sourceEventId: purchase.eventId
      }
    };
    const temp = join(this.directory, `.${key}.${randomBytes(12).toString('hex')}.tmp`);
    const handle = await open(temp, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(row) + '\n');
      await handle.sync();
    } finally { await handle.close(); }
    try {
      await link(temp, destination); // link is atomic/exclusive on the same filesystem
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let existing;
      try { existing = await readSafeReplay(destination); }
      catch { throw new Error('existing purchase ledger is unsafe or unreadable; refusing webhook acknowledgment'); }
      if (existing.schemaVersion !== 1 || existing.eventId !== purchase.eventId
        || existing.purchaseBinding !== binding || !existing.sale || !existing.fulfillment)
        throw new Error('conflicting or corrupt replay for this Stripe event ID');
      return { recorded: false, duplicate: true, row: existing };
    } finally {
      await unlink(temp).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    }
    if (process.platform !== 'win32') {
      const parent = await open(this.directory, 'r');
      try { await parent.sync(); } finally { await parent.close(); }
    }
    return { recorded: true, duplicate: false, row };
  }
}
