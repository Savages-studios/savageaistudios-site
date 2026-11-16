import { createServer } from 'node:http';
import { join } from 'node:path';
import { createStripeWebhookRoute } from './api/stripe-webhook.mjs';
import {
  AutomatedFulfillment,
  DeliveryLog,
  createEmailSenderFromEnv
} from './api/fulfillment.mjs';
import {
  AUTOMATED_FULFILLMENT_MANIFEST,
  HELD_FULFILLMENT_SKUS
} from './api/fulfillment-manifest.mjs';

const offers = JSON.parse(process.env.SAVAGE_STRIPE_PRODUCTS_JSON ?? 'null');
let fulfillment;
if (Array.isArray(offers) && offers.some((offer) => offer?.fulfillmentMode === 'automated')) {
  const goodsDirectory = process.env.SAVAGE_FULFILLMENT_GOODS_DIR;
  const ledgerDirectory = process.env.SAVAGE_PURCHASE_LEDGER_DIR;
  if (!goodsDirectory) throw new Error('SAVAGE_FULFILLMENT_GOODS_DIR required for automated fulfillment');
  if (!ledgerDirectory) throw new Error('SAVAGE_PURCHASE_LEDGER_DIR required for automated fulfillment');
  const deliveryLogDirectory = process.env.SAVAGE_DELIVERY_LOG_DIR
    ?? join(ledgerDirectory, 'delivery-log');
  fulfillment = new AutomatedFulfillment({
    manifest: AUTOMATED_FULFILLMENT_MANIFEST,
    goodsDirectory,
    deliveryLog: new DeliveryLog(deliveryLogDirectory),
    sender: createEmailSenderFromEnv(process.env),
    heldSkus: HELD_FULFILLMENT_SKUS
  });
}
const route = createStripeWebhookRoute({
  signingSecret: process.env.STRIPE_WEBHOOK_SECRET,
  stripeApiKey: process.env.STRIPE_API_READ_KEY,
  offers,
  ledgerDirectory: process.env.SAVAGE_PURCHASE_LEDGER_DIR,
  fulfillment
});
const port = Number(process.env.PORT ?? '8080');
const host = process.env.HOST ?? '127.0.0.1';
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const server = createServer(async (request, response) => {
  try {
    if (await route(request, response)) return;
    response.writeHead(404).end();
  } catch { response.writeHead(500).end(); }
});
server.listen(port, host, () => console.log(`Stripe webhook listening on ${host}:${port}`));
