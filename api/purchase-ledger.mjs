import { createHash, randomBytes } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { mkdir, open, link, lstat, readdir, rename, unlink } from 'node:fs/promises';
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

async function syncDirectory(directory) {
  if (process.platform === 'win32') return;
  const parent = await open(directory, 'r');
  try { await parent.sync(); } finally { await parent.close(); }
}

/** Write one JSON document durably: complete temp file, fsync, then publish. */
async function writeDurableTemp(directory, tag, value) {
  const temp = join(directory, `.${tag}.${randomBytes(12).toString('hex')}.tmp`);
  const handle = await open(temp, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(value) + '\n');
    await handle.sync();
  } finally { await handle.close(); }
  return temp;
}

/** Atomically publish a temp file only if the destination does not exist. */
async function publishExclusive(directory, temp, destination) {
  try {
    await link(temp, destination); // link is atomic/exclusive on the same filesystem
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  } finally {
    await unlink(temp).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
}

/** Atomically replace a file with a durable temp file (claim state flips). */
async function publishReplace(directory, temp, destination) {
  try { await rename(temp, destination); }
  catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

const EVENT_ID_PATTERN = /^evt_[A-Za-z0-9_]+$/;
const PAYMENT_INTENT_PATTERN = /^pi_[A-Za-z0-9_]+$/;
const CHARGE_ID_PATTERN = /^ch_[A-Za-z0-9_]+$/;
const RECORD_NAME_PATTERN = /^[a-f0-9]{64}\.json$/;
const CLAIM_NAME_PATTERN = /^[a-f0-9]{64}\.claim$/;

/**
 * The idempotency key for fulfillment is the Stripe Checkout session,
 * namespaced by mode: one paid session may be fulfilled exactly once, no
 * matter how many distinct provider events Stripe delivers for it. Event
 * IDs stay an audit index (one durable record file per event, as before);
 * a per-session claim file is the atomic gatekeeper that decides which
 * event — if any — may create that session's fulfillment.
 */
export function checkoutSessionClaimKey(livemode, sessionId) {
  return `${livemode ? 'live' : 'test'}:${sessionId}`;
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assertValidClaimShape(claim, claimKey, sessionId, livemode) {
  const corrupt = () => {
    throw new Error('conflicting or corrupt checkout session claim; refusing webhook acknowledgment');
  };
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) corrupt();
  if (claim.schemaVersion !== 2 || claim.kind !== 'checkout-session-claim') corrupt();
  if (claim.claimKey !== claimKey || claim.sessionId !== sessionId || claim.livemode !== livemode) corrupt();
  if (claim.state !== 'pending' && claim.state !== 'fulfilled' && claim.state !== 'revoked') corrupt();
  if (claim.state === 'revoked') {
    // A revocation is a state transition on the original claim, never a
    // rewrite of it: the revocation block must identify the verified
    // refund event that caused it.
    if (!EVENT_ID_PATTERN.test(claim.revocationEventId ?? '')) corrupt();
    if (claim.revocationReason !== 'charge.refunded') corrupt();
    if (!Number.isSafeInteger(claim.revokedAtMs) || claim.revokedAtMs <= 0) corrupt();
    if (typeof claim.revokedAt !== 'string' || Number.isNaN(Date.parse(claim.revokedAt))) corrupt();
    if (claim.revocationChargeId !== null && claim.revocationChargeId !== undefined &&
        !CHARGE_ID_PATTERN.test(claim.revocationChargeId)) corrupt();
    if (claim.revocationAmountRefunded !== null && claim.revocationAmountRefunded !== undefined &&
        (!Number.isSafeInteger(claim.revocationAmountRefunded) || claim.revocationAmountRefunded < 0)) corrupt();
  }
  if (typeof claim.leaseId !== 'string' || !/^[a-f0-9]{32}$/.test(claim.leaseId)) corrupt();
  if (!Number.isSafeInteger(claim.claimedAtMs) || claim.claimedAtMs <= 0) corrupt();
  if (!EVENT_ID_PATTERN.test(claim.eventId ?? '')) corrupt();
  if (claim.paymentIntentId !== null && claim.paymentIntentId !== undefined &&
      !PAYMENT_INTENT_PATTERN.test(claim.paymentIntentId)) corrupt();
  if (typeof claim.recordFile !== 'string' && claim.recordFile !== null) corrupt();
  if (typeof claim.recordFile === 'string' && !RECORD_NAME_PATTERN.test(claim.recordFile)) corrupt();
  if (claim.state === 'fulfilled' && typeof claim.recordFile !== 'string') corrupt();
}

/**
 * Durable idempotent sale + fulfillment queue, committed in one atomic file
 * per Stripe event. The work is not considered delivered merely because a
 * checkout succeeded. No user PII is served through a public read endpoint.
 *
 * Fulfillment idempotency is keyed by checkout session (see the claim
 * protocol in record()): two distinct events for one session produce one
 * fulfillment. A claim left "pending" by a crash is not a permanent
 * duplicate: a later event recovers it once its lease is stale, while a
 * fresh pending claim blocks as a duplicate-in-progress.
 */
export class PurchaseLedger {
  constructor(directory, { claimLeaseMs = 60_000 } = {}) {
    if (!isAbsolute(directory)) throw new Error('A private absolute purchase ledger directory is required');
    if (!Number.isSafeInteger(claimLeaseMs) || claimLeaseMs <= 0) throw new Error('invalid claim lease');
    this.directory = directory;
    this.claimLeaseMs = claimLeaseMs;
  }

  /** Read a descriptor-verified JSON file, or return null when absent. */
  async #readIfPresent(path, unsafeMessage) {
    try { return await readSafeReplay(path); }
    catch (error) {
      if (error.code === 'ENOENT') return null;
      throw new Error(unsafeMessage);
    }
  }

  async #readRecordIfPresent(path) {
    return this.#readIfPresent(path, 'existing purchase ledger is unsafe or unreadable; refusing webhook acknowledgment');
  }

  async #readClaimIfPresent(path) {
    return this.#readIfPresent(path, 'existing checkout session claim is unsafe or unreadable; refusing webhook acknowledgment');
  }

  /** Verify a stored event record is exactly the replay of this purchase. */
  #assertReplayBinding(existing, purchase, binding) {
    if (existing.schemaVersion !== 1 || existing.eventId !== purchase.eventId
      || existing.purchaseBinding !== binding || !existing.sale || !existing.fulfillment)
      throw new Error('conflicting or corrupt replay for this Stripe event ID');
  }

  #newClaim({ claimKey, sessionId, livemode, eventId, paymentIntentId, state, recordFile }) {
    const now = Date.now();
    return {
      schemaVersion: 2, kind: 'checkout-session-claim',
      claimKey, sessionId, livemode,
      state, leaseId: randomBytes(16).toString('hex'),
      claimedAt: new Date(now).toISOString(), claimedAtMs: now,
      eventId, recordFile: recordFile ?? null,
      paymentIntentId: paymentIntentId ?? null
    };
  }

  /** Flip a claim to fulfilled, pointing at the durable event record file. */
  async #fulfillClaim(claimPath, claim, recordFile) {
    const fulfilled = { ...claim, state: 'fulfilled', recordFile };
    const temp = await writeDurableTemp(this.directory, 'claim', fulfilled);
    await publishReplace(this.directory, temp, claimPath);
    await syncDirectory(this.directory);
    return fulfilled;
  }

  /** Create the fulfilled claim for a session that already has a record. */
  async #adoptExistingRecord(claimPath, context, recordFile) {
    const claim = this.#newClaim({ ...context, state: 'fulfilled', recordFile });
    const temp = await writeDurableTemp(this.directory, 'claim', claim);
    const created = await publishExclusive(this.directory, temp, claimPath);
    if (created) { await syncDirectory(this.directory); return claim; }
    const existing = await this.#readClaimIfPresent(claimPath);
    if (!existing) throw new Error('conflicting or corrupt checkout session claim; refusing webhook acknowledgment');
    assertValidClaimShape(existing, context.claimKey, context.sessionId, context.livemode);
    return existing;
  }

  /**
   * Sessions recorded before session idempotency existed have an
   * event-keyed record but no claim. Find such a record for this session;
   * any unreadable record file fails closed, because it cannot be proven
   * not to belong to this session.
   */
  async #findLegacyRecord(sessionId, livemode) {
    let names;
    try { names = await readdir(this.directory); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    for (const name of names.filter((entry) => RECORD_NAME_PATTERN.test(entry)).sort()) {
      const row = await this.#readRecordIfPresent(join(this.directory, name));
      if (row?.schemaVersion === 1 && row.sale?.checkoutSessionId === sessionId
        && row.sale?.livemode === livemode)
        return { row, recordFile: name };
    }
    return null;
  }

  /**
   * Find the checkout session a payment intent is linked to, using only
   * link records this ledger itself stored (claims and sale rows).
   * Returns null when no stored link exists. A payment intent linked to
   * two different sessions is a conflict and fails closed.
   */
  async #findSessionForPaymentIntent(paymentIntentId, livemode) {
    if (!PAYMENT_INTENT_PATTERN.test(paymentIntentId ?? '')) throw new Error('invalid payment intent ID');
    const sessions = new Set();
    let names;
    try { names = await readdir(this.directory); }
    catch (error) { if (error.code === 'ENOENT') names = []; else throw error; }
    for (const name of names.filter((entry) => RECORD_NAME_PATTERN.test(entry)).sort()) {
      const row = await this.#readRecordIfPresent(join(this.directory, name));
      if (row?.sale?.paymentIntentId === paymentIntentId && typeof row.sale?.checkoutSessionId === 'string')
        sessions.add(row.sale.checkoutSessionId);
    }
    for (const name of names.filter((entry) => CLAIM_NAME_PATTERN.test(entry)).sort()) {
      const claim = await this.#readClaimIfPresent(join(this.directory, name));
      if (claim?.paymentIntentId === paymentIntentId && typeof claim.sessionId === 'string')
        sessions.add(claim.sessionId);
    }
    if (sessions.size > 1) throw new Error('conflicting payment intent link: multiple checkout sessions');
    if (sessions.size === 0) return null;
    const [sessionId] = sessions;
    const pattern = livemode ? /^cs_live_[A-Za-z0-9_]+$/ : /^cs_test_[A-Za-z0-9_]+$/;
    if (!pattern.test(sessionId)) throw new Error('conflicting payment intent link: mode mismatch');
    return sessionId;
  }

  /**
   * Resolve a payment intent to its checkout session; an unresolvable
   * link fails closed (used where a purchase cannot proceed without it).
   */
  async #resolveSessionForPaymentIntent(paymentIntentId, livemode) {
    const sessionId = await this.#findSessionForPaymentIntent(paymentIntentId, livemode);
    if (sessionId === null) throw new Error('unresolvable payment intent: no stored checkout session link');
    return sessionId;
  }

  /** Commit the event record for a claim this call owns, then fulfill it. */
  async #commitRecord({ purchase, binding, destination, recordFile, claimPath, claim }) {
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
        purchasedAt: purchase.observedAt,
        ...(purchase.paymentIntentId ? { paymentIntentId: purchase.paymentIntentId } : {})
      },
      fulfillment: {
        sku: purchase.sku,
        status: 'pending',
        method: purchase.fulfillmentMode,
        sourceEventId: purchase.eventId
      }
    };
    const temp = await writeDurableTemp(this.directory, 'record', row);
    const created = await publishExclusive(this.directory, temp, destination);
    if (!created) {
      // A concurrent delivery of the same event committed first.
      const existing = await this.#readRecordIfPresent(destination);
      if (!existing) throw new Error('existing purchase ledger is unsafe or unreadable; refusing webhook acknowledgment');
      this.#assertReplayBinding(existing, purchase, binding);
      await this.#fulfillClaim(claimPath, claim, recordFile);
      return { recorded: false, duplicate: true, row: existing };
    }
    await syncDirectory(this.directory);
    await this.#fulfillClaim(claimPath, claim, recordFile);
    return { recorded: true, duplicate: false, row };
  }

  /** Handle an already-existing claim for this session. */
  async #handleExistingClaim(claim, context) {
    const { purchase, claimPath } = context;
    assertValidClaimShape(claim, context.claimKey, context.sessionId, context.livemode);
    if (claim.state === 'fulfilled') {
      const row = await this.#readRecordIfPresent(join(this.directory, claim.recordFile));
      if (!row || row.sale?.checkoutSessionId !== context.sessionId || row.sale?.livemode !== context.livemode)
        throw new Error('conflicting or corrupt checkout session claim; refusing webhook acknowledgment');
      return { recorded: false, duplicate: true, row };
    }
    if (claim.state === 'revoked') {
      // Revocation is terminal for the session: no later delivery may
      // create or resurrect a fulfillment for it. The claim's durable
      // record (when one was committed) stands as the evidence.
      const row = typeof claim.recordFile === 'string'
        ? await this.#readRecordIfPresent(join(this.directory, claim.recordFile))
        : null;
      return { recorded: false, duplicate: true, revoked: true, row };
    }
    // Pending claim. The claiming event's own record may already be durable
    // (crash between record commit and claim flip): adopt it, at any age.
    const crashedFile = `${sha256Hex(claim.eventId)}.json`;
    const crashedRow = await this.#readRecordIfPresent(join(this.directory, crashedFile));
    if (crashedRow) {
      if (crashedRow.sale?.checkoutSessionId !== context.sessionId || crashedRow.sale?.livemode !== context.livemode)
        throw new Error('conflicting or corrupt checkout session claim; refusing webhook acknowledgment');
      await this.#fulfillClaim(claimPath, claim, crashedFile);
      return { recorded: false, duplicate: true, row: crashedRow };
    }
    const fresh = Date.now() - claim.claimedAtMs <= this.claimLeaseMs;
    if (fresh && claim.eventId !== purchase.eventId) {
      // Another delivery is mid-flight for this session. Acknowledge as a
      // duplicate with zero side effects; a later retry after the lease
      // expires recovers the claim if the owner never finishes.
      return { recorded: false, duplicate: true, inProgress: true, row: null };
    }
    // Stale claim (or this event's own abandoned claim): take over the
    // lease and commit this purchase as the session's one fulfillment.
    const takeover = this.#newClaim({ ...context, state: 'pending', recordFile: null });
    const temp = await writeDurableTemp(this.directory, 'claim', takeover);
    await publishReplace(this.directory, temp, claimPath);
    await syncDirectory(this.directory);
    return this.#commitRecord({ ...context, claim: takeover });
  }

  async record(purchase) {
    if (!EVENT_ID_PATTERN.test(purchase?.eventId ?? '')) throw new Error('invalid event ID');
    if (typeof purchase?.livemode !== 'boolean') throw new Error('invalid livemode');
    if (purchase?.paymentIntentId != null && !PAYMENT_INTENT_PATTERN.test(purchase.paymentIntentId))
      throw new Error('invalid payment intent ID');
    await assertPrivateLedgerPath(this.directory);

    // The fulfillment key is the checkout session. Events that carry only
    // a payment intent resolve it through this ledger's stored link records.
    let sessionId = purchase.sessionId;
    const sessionPattern = purchase.livemode ? /^cs_live_[A-Za-z0-9_]+$/ : /^cs_test_[A-Za-z0-9_]+$/;
    if (typeof sessionId !== 'string' || !sessionPattern.test(sessionId)) {
      if (purchase.paymentIntentId) {
        sessionId = await this.#resolveSessionForPaymentIntent(purchase.paymentIntentId, purchase.livemode);
      } else {
        throw new Error('invalid checkout session ID');
      }
    }
    const effective = { ...purchase, sessionId };

    // Purchase identity in the verifier's field order, minus observation
    // time (Stripe re-signs retries) and the payment-intent link hint (the
    // session already binds the payment). This reproduces the binding of
    // records written before session idempotency existed.
    const identity = {
      eventId: effective.eventId, sessionId: effective.sessionId,
      customerEmail: effective.customerEmail, sku: effective.sku,
      amountTotal: effective.amountTotal, currency: effective.currency,
      accountId: effective.accountId, livemode: effective.livemode,
      fulfillmentMode: effective.fulfillmentMode
    };
    const binding = sha256Hex(JSON.stringify(identity));
    const recordFile = `${sha256Hex(effective.eventId)}.json`;
    const destination = join(this.directory, recordFile);
    const claimKey = checkoutSessionClaimKey(effective.livemode, sessionId);
    const claimPath = join(this.directory, `${sha256Hex(claimKey)}.claim`);
    const context = {
      purchase: effective, binding, claimKey, sessionId,
      livemode: effective.livemode, claimPath,
      eventId: effective.eventId, paymentIntentId: effective.paymentIntentId ?? null,
      destination, recordFile
    };

    // Same-event replay: the durable record is authoritative. Heal a claim
    // left pending by a crash after the record committed.
    const prior = await this.#readRecordIfPresent(destination);
    if (prior) {
      this.#assertReplayBinding(prior, effective, binding);
      const claim = await this.#readClaimIfPresent(claimPath);
      if (!claim) {
        await this.#adoptExistingRecord(claimPath, context, recordFile);
      } else {
        assertValidClaimShape(claim, claimKey, sessionId, effective.livemode);
        if (claim.state === 'pending') {
          await this.#fulfillClaim(claimPath, claim, recordFile);
        } else if (claim.state === 'revoked') {
          // This session was revoked (possibly while its claim was still
          // pending, so its recordFile may be null). The durable record
          // stands as evidence; the entitlement stays revoked and this
          // redelivery changes nothing.
          return { recorded: false, duplicate: true, revoked: true, row: prior };
        } else if (claim.recordFile !== recordFile) {
          throw new Error('conflicting or corrupt checkout session claim; refusing webhook acknowledgment');
        }
      }
      return { recorded: false, duplicate: true, row: prior };
    }

    const claim = await this.#readClaimIfPresent(claimPath);
    if (claim) return this.#handleExistingClaim(claim, context);

    // No claim: reconcile sessions recorded before session idempotency.
    const legacy = await this.#findLegacyRecord(sessionId, effective.livemode);
    if (legacy) {
      await this.#adoptExistingRecord(claimPath, context, legacy.recordFile);
      return { recorded: false, duplicate: true, row: legacy.row };
    }

    // Claim the session atomically before writing any fulfillment record.
    const pending = this.#newClaim({ ...context, state: 'pending', recordFile: null });
    const temp = await writeDurableTemp(this.directory, 'claim', pending);
    const created = await publishExclusive(this.directory, temp, claimPath);
    if (!created) {
      const raced = await this.#readClaimIfPresent(claimPath);
      if (!raced) throw new Error('conflicting or corrupt checkout session claim; refusing webhook acknowledgment');
      return this.#handleExistingClaim(raced, context);
    }
    await syncDirectory(this.directory);
    return this.#commitRecord({ ...context, claim: pending });
  }

  /**
   * Mark a revoked claim's durable record so its fulfillment is no
   * longer actionable. The revocation block is copied from the claim —
   * the claim is the single source of truth for which refund revoked
   * the session — and the sale is never altered. Idempotent: an
   * already-marked record is returned unchanged, which also heals a
   * crash between the claim flip and this write.
   */
  async #markRecordRevoked(claim) {
    let recordFile = claim.recordFile;
    let row = null;
    if (typeof recordFile === 'string') {
      row = await this.#readRecordIfPresent(join(this.directory, recordFile));
    } else {
      // A claim revoked while still pending may have its claiming
      // event's record durable under that event's own file name.
      const candidate = `${sha256Hex(claim.eventId)}.json`;
      row = await this.#readRecordIfPresent(join(this.directory, candidate));
      if (row) recordFile = candidate;
    }
    if (!row) return null;
    if (row.sale?.checkoutSessionId !== claim.sessionId || row.sale?.livemode !== claim.livemode)
      throw new Error('conflicting or corrupt checkout session claim; refusing webhook acknowledgment');
    if (row.fulfillment?.status === 'revoked' && row.revocation) return row;
    const marked = {
      ...row,
      fulfillment: { ...row.fulfillment, status: 'revoked' },
      revocation: {
        reason: claim.revocationReason,
        eventId: claim.revocationEventId,
        chargeId: claim.revocationChargeId ?? null,
        paymentIntentId: claim.paymentIntentId ?? null,
        amountRefunded: claim.revocationAmountRefunded ?? null,
        revokedAt: claim.revokedAt
      }
    };
    const temp = await writeDurableTemp(this.directory, 'record', marked);
    await publishReplace(this.directory, temp, join(this.directory, recordFile));
    await syncDirectory(this.directory);
    return marked;
  }

  /**
   * Revoke the entitlement a verified charge refund cancels. The
   * refund reaches its checkout session only through the payment-intent
   * link stored at checkout time (the claim's link hint and the sale
   * row's paymentIntentId) — the same links record() resolves in
   * reverse. Outcomes:
   *   matched:false            — no stored link/claim for this payment
   *                              intent; nothing is written (no phantom
   *                              revocation) and the caller acknowledges.
   *   revoked:true             — this refund transitioned the claim.
   *   duplicate:true           — the claim was already revoked; the
   *                              FIRST revocation stands unchanged.
   * The original claim and record are never deleted: revocation is a
   * state transition plus a timestamp and a reason.
   */
  async revokeForRefund(refund) {
    if (!EVENT_ID_PATTERN.test(refund?.eventId ?? '')) throw new Error('invalid event ID');
    if (!PAYMENT_INTENT_PATTERN.test(refund?.paymentIntentId ?? '')) throw new Error('invalid payment intent ID');
    if (typeof refund?.livemode !== 'boolean') throw new Error('invalid livemode');
    if (refund?.chargeId != null && !CHARGE_ID_PATTERN.test(refund.chargeId)) throw new Error('invalid charge ID');
    if (refund?.amountRefunded != null &&
        (!Number.isSafeInteger(refund.amountRefunded) || refund.amountRefunded < 0))
      throw new Error('invalid refunded amount');
    await assertPrivateLedgerPath(this.directory);

    const sessionId = await this.#findSessionForPaymentIntent(refund.paymentIntentId, refund.livemode);
    if (sessionId === null)
      return { matched: false, revoked: false, duplicate: false, claim: null, row: null };

    const claimKey = checkoutSessionClaimKey(refund.livemode, sessionId);
    const claimPath = join(this.directory, `${sha256Hex(claimKey)}.claim`);
    let claim = await this.#readClaimIfPresent(claimPath);
    if (!claim) {
      // Sessions recorded before session claims existed have a record
      // but no claim. Adopt that record into a claim so the revocation
      // has a durable home; without any record there is nothing to
      // revoke and the refund is simply unmatched.
      const legacy = await this.#findLegacyRecord(sessionId, refund.livemode);
      if (!legacy)
        return { matched: false, revoked: false, duplicate: false, claim: null, row: null };
      claim = this.#newClaim({
        claimKey, sessionId, livemode: refund.livemode,
        eventId: legacy.row.eventId, paymentIntentId: refund.paymentIntentId,
        state: 'fulfilled', recordFile: legacy.recordFile
      });
    } else {
      assertValidClaimShape(claim, claimKey, sessionId, refund.livemode);
    }

    if (claim.state === 'revoked') {
      const row = await this.#markRecordRevoked(claim);
      return { matched: true, revoked: false, duplicate: true, claim, row };
    }

    const parsedObserved = Date.parse(refund.observedAt ?? '');
    const revokedAtMs = Number.isSafeInteger(parsedObserved) && parsedObserved > 0
      ? parsedObserved : Date.now();
    const revoked = {
      ...claim, state: 'revoked',
      revokedAt: new Date(revokedAtMs).toISOString(), revokedAtMs,
      revocationEventId: refund.eventId, revocationReason: 'charge.refunded',
      revocationChargeId: refund.chargeId ?? null,
      revocationAmountRefunded: refund.amountRefunded ?? null
    };
    const temp = await writeDurableTemp(this.directory, 'claim', revoked);
    await publishReplace(this.directory, temp, claimPath);
    await syncDirectory(this.directory);
    const row = await this.#markRecordRevoked(revoked);
    return { matched: true, revoked: true, duplicate: false, claim: revoked, row };
  }
}
