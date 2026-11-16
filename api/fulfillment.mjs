import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SKU_PATTERN = /^[A-Za-z0-9_-]{3,180}$/;
const EVENT_ID_PATTERN = /^evt_[A-Za-z0-9_]+$/;

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function recordHash(body) {
  return sha256Hex(canonical(body));
}

export function recipientDomainHash(email) {
  if (typeof email !== 'string') throw new TypeError('buyer email required');
  const domain = email.slice(email.lastIndexOf('@') + 1).trim().toLowerCase();
  if (!domain || !domain.includes('.')) throw new TypeError('buyer email domain required');
  return sha256Hex(domain);
}

export function recipientHash(email) {
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new TypeError('valid buyer email required');
  return sha256Hex(email.trim().toLowerCase());
}

export function validateFulfillmentManifest(manifest, heldSkus = new Set()) {
  if (!Array.isArray(manifest) || manifest.length === 0)
    throw new Error('automated fulfillment manifest required');
  const seen = new Set();
  for (const entry of manifest) {
    if (!entry || !SKU_PATTERN.test(entry.sku ?? ''))
      throw new Error('invalid automated fulfillment SKU');
    if (heldSkus.has(entry.sku))
      throw new Error(`held SKU must not be automated: ${entry.sku}`);
    if (seen.has(entry.sku)) throw new Error(`duplicate automated fulfillment SKU: ${entry.sku}`);
    seen.add(entry.sku);
    if (typeof entry.productName !== 'string' || entry.productName.length === 0)
      throw new Error(`automated fulfillment product name required: ${entry.sku}`);
    if (!Array.isArray(entry.deliverables) || entry.deliverables.length === 0)
      throw new Error(`automated fulfillment deliverables required: ${entry.sku}`);
    for (const file of entry.deliverables) {
      if (!file || typeof file.path !== 'string' || isAbsolute(file.path)
          || file.path.split(/[\\/]+/).includes('..') || file.path.includes('\\'))
        throw new Error(`unsafe deliverable path for ${entry.sku}`);
      if (!SHA256_PATTERN.test(file.sha256 ?? ''))
        throw new Error(`invalid deliverable SHA-256 for ${entry.sku}`);
      if (!Number.isSafeInteger(file.bytes) || file.bytes <= 0)
        throw new Error(`invalid deliverable byte count for ${entry.sku}`);
      if (typeof file.contentType !== 'string' || file.contentType.length === 0)
        throw new Error(`invalid deliverable content type for ${entry.sku}`);
      if (typeof file.filename !== 'string' || file.filename.length === 0
          || file.filename.includes('/') || file.filename.includes('\\'))
        throw new Error(`invalid deliverable filename for ${entry.sku}`);
    }
  }
  return manifest;
}

/**
 * Hash-chained append-only delivery log. It deliberately stores no buyer
 * email address: only a hash of the full recipient and a hash of its domain.
 */
export class DeliveryLog {
  constructor(directory, { fileName = 'delivery-log.jsonl', now = () => new Date() } = {}) {
    if (!isAbsolute(directory)) throw new Error('absolute delivery log directory required');
    if (!/^[A-Za-z0-9._-]+\.jsonl$/.test(fileName)) throw new Error('invalid delivery log filename');
    this.directory = directory;
    this.path = join(directory, fileName);
    this.now = now;
    this.appendQueue = Promise.resolve();
  }

  async records() {
    let text;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const records = text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    let previous = null;
    for (const record of records) {
      const { recordHash: storedHash, ...body } = record;
      if (record.prevHash !== previous || storedHash !== recordHash(body))
        throw new Error('delivery log hash chain is broken; refusing fulfillment');
      previous = storedHash;
    }
    return records;
  }

  async recordsForEvent(eventId) {
    return (await this.records()).filter((record) => record.eventId === eventId);
  }

  async append(input) {
    const run = this.appendQueue.then(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const existing = await this.records();
      const prevHash = existing.length ? existing[existing.length - 1].recordHash : null;
      const body = {
        schemaVersion: 1,
        sequence: existing.length,
        recordedAt: this.now().toISOString(),
        ...input,
        prevHash
      };
      const record = { ...body, recordHash: recordHash(body) };
      await appendFile(this.path, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
      return Object.freeze(record);
    });
    this.appendQueue = run.catch(() => {});
    return run;
  }
}

/** Test/development sender. It captures payloads and sends nothing. */
export class CaptureEmailSender {
  constructor() {
    this.messages = [];
  }

  async send(payload) {
    const id = `capture-${this.messages.length + 1}`;
    this.messages.push(payload);
    return { id, captured: true };
  }
}

/**
 * Production-shaped sender backed by a JSON email API. Attachments travel
 * as base64 in the API payload; the endpoint and credentials are supplied
 * by the deployment environment, never committed to this repository.
 */
export class HttpEmailSender {
  constructor({ endpoint, apiKey, from, fetchImpl = fetch } = {}) {
    if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint))
      throw new Error('HTTPS fulfillment email API endpoint required');
    if (typeof apiKey !== 'string' || apiKey.length < 8)
      throw new Error('fulfillment email API key required');
    if (typeof from !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from))
      throw new Error('valid fulfillment email sender required');
    this.endpoint = endpoint;
    this.apiKey = apiKey;
    this.from = from;
    this.fetchImpl = fetchImpl;
  }

  async send(payload) {
    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify({
        from: this.from,
        to: payload.to,
        subject: payload.subject,
        text: payload.text,
        attachments: payload.attachments.map((attachment) => ({
          filename: attachment.filename,
          contentType: attachment.contentType,
          sha256: attachment.sha256,
          contentBase64: attachment.content.toString('base64')
        })),
        metadata: payload.metadata
      }),
      signal: AbortSignal.timeout(15000)
    });
    if (!response?.ok) throw new Error('fulfillment email API rejected delivery');
    const data = await response.json().catch(() => ({}));
    return { id: data.id ?? data.messageId ?? 'accepted' };
  }
}

export function createEmailSenderFromEnv(env = process.env) {
  const mode = env.FULFILLMENT_EMAIL_SENDER;
  if (mode === 'capture') return new CaptureEmailSender();
  if (mode === 'http') {
    return new HttpEmailSender({
      endpoint: env.FULFILLMENT_EMAIL_API_URL,
      apiKey: env.FULFILLMENT_EMAIL_API_KEY,
      from: env.FULFILLMENT_EMAIL_FROM
    });
  }
  throw new Error('FULFILLMENT_EMAIL_SENDER must be explicitly set to http or capture');
}

export class AutomatedFulfillment {
  constructor({ manifest, goodsDirectory, deliveryLog, sender, heldSkus = new Set() } = {}) {
    validateFulfillmentManifest(manifest, heldSkus);
    if (!isAbsolute(goodsDirectory)) throw new Error('absolute fulfillment goods directory required');
    if (!deliveryLog || typeof deliveryLog.append !== 'function'
        || typeof deliveryLog.recordsForEvent !== 'function')
      throw new Error('delivery log required');
    if (!sender || typeof sender.send !== 'function') throw new Error('email sender required');
    this.manifest = new Map(manifest.map((entry) => [entry.sku, entry]));
    this.goodsDirectory = goodsDirectory;
    this.deliveryLog = deliveryLog;
    this.sender = sender;
    this.heldSkus = heldSkus;
    this.queue = Promise.resolve();
  }

  async fulfill(purchase) {
    const run = this.queue.then(() => this.fulfillSerialized(purchase));
    this.queue = run.catch(() => {});
    return run;
  }

  async fulfillSerialized(purchase) {
    if (!purchase || !EVENT_ID_PATTERN.test(purchase.eventId ?? '')
        || typeof purchase.sessionId !== 'string' || purchase.sessionId.length === 0
        || !SKU_PATTERN.test(purchase.sku ?? ''))
      throw new TypeError('verified purchase with event, session and SKU required');
    recipientHash(purchase.customerEmail);

    const base = {
      eventId: purchase.eventId,
      sessionId: purchase.sessionId,
      sku: purchase.sku,
      recipientHash: recipientHash(purchase.customerEmail),
      recipientDomainHash: recipientDomainHash(purchase.customerEmail)
    };
    const logRefusal = async (reason, deliverables = []) => {
      const record = await this.deliveryLog.append({
        ...base, outcome: 'refused', reason, deliverables
      });
      return { status: 'refused', reason, duplicate: false, record };
    };

    if (this.heldSkus.has(purchase.sku)) return logRefusal('held_sku');
    const entry = this.manifest.get(purchase.sku);
    if (!entry) return logRefusal('unknown_sku');
    if (purchase.fulfillmentMode !== 'automated')
      return logRefusal('offer_not_configured_for_automated_fulfillment');

    const prior = await this.deliveryLog.recordsForEvent(purchase.eventId);
    const delivered = prior.find((record) => record.outcome === 'delivered');
    if (delivered) return { status: 'delivered', duplicate: true, record: delivered };
    for (let index = 0; index < prior.length; index += 1) {
      if (prior[index].outcome !== 'reserved') continue;
      const closed = prior.slice(index + 1).some((record) =>
        ['delivered', 'failed', 'refused'].includes(record.outcome));
      if (!closed) return { status: 'in_progress', duplicate: true, record: prior[index] };
    }

    let attachments;
    try {
      attachments = await this.loadDeliverables(entry);
    } catch (error) {
      return logRefusal(error.code ?? 'deliverable_unavailable', entry.deliverables.map((file) => ({
        path: file.path, sha256: file.sha256
      })));
    }

    const deliverableHashes = attachments.map((attachment) => ({
      path: attachment.path, sha256: attachment.sha256
    }));
    await this.deliveryLog.append({
      ...base, outcome: 'reserved', reason: null, deliverables: deliverableHashes
    });

    const payload = {
      to: purchase.customerEmail,
      subject: `Your ${entry.productName}`,
      text: [
        `Thanks for your order — payment confirmed.`,
        `Your ${entry.productName} is attached to this email.`,
        `If anything does not arrive intact, reply to this email and we will sort it out.`
      ].join('\n\n'),
      attachments,
      metadata: { eventId: purchase.eventId, sku: purchase.sku }
    };

    let sent;
    try {
      sent = await this.sender.send(payload);
    } catch {
      const record = await this.deliveryLog.append({
        ...base, outcome: 'failed', reason: 'sender_failed', deliverables: deliverableHashes
      });
      return { status: 'failed', reason: 'sender_failed', duplicate: false, record };
    }

    const record = await this.deliveryLog.append({
      ...base,
      outcome: 'delivered',
      reason: null,
      deliverables: deliverableHashes,
      deliveryIdHash: sent?.id ? sha256Hex(String(sent.id)) : null
    });
    return { status: 'delivered', duplicate: false, record, deliveryId: sent?.id ?? null };
  }

  async loadDeliverables(entry) {
    const attachments = [];
    for (const file of entry.deliverables) {
      const path = resolve(this.goodsDirectory, file.path);
      const root = resolve(this.goodsDirectory);
      if (path !== root && !path.startsWith(root + sep))
        throw Object.assign(new Error('deliverable path escapes goods directory'), {
          code: 'deliverable_path_escape'
        });
      let content;
      try {
        content = await readFile(path);
      } catch {
        throw Object.assign(new Error('deliverable missing'), { code: 'deliverable_missing' });
      }
      const actualHash = sha256Hex(content);
      if (content.length !== file.bytes || actualHash !== file.sha256) {
        throw Object.assign(new Error('deliverable hash mismatch'), {
          code: 'deliverable_hash_mismatch'
        });
      }
      attachments.push({
        path: file.path,
        filename: file.filename,
        contentType: file.contentType,
        sha256: file.sha256,
        bytes: file.bytes,
        content
      });
    }
    return attachments;
  }
}
