// Sends a signed orders/create webhook, the same webhook again, and one
// with a bad signature. Run `npm start` first, then `npm run send-webhook`.

const crypto = require('node:crypto');
const config = require('../src/config');
const { sign } = require('../src/hmac');

const url = `http://localhost:${config.port}/webhooks/orders-create`;

const order = {
  id: crypto.randomInt(1_000_000, 9_999_999),
  email: 'customer@example.com',
  shipping_address: { name: 'Asha Rao', address1: '12 MG Road', city: 'Bengaluru', zip: '560001', country: 'IN' },
  line_items: [{ sku: 'TSHIRT-M', quantity: 2 }],
};
const body = JSON.stringify(order);
const webhookId = crypto.randomUUID();

async function send(label, signature) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-shop-webhook-id': webhookId,
      'x-shop-hmac-sha256': signature,
    },
    body,
  });
  console.log(`${label} -> ${res.status} ${await res.text()}`);
}

(async () => {
  console.log(`order id ${order.id}, webhook id ${webhookId}`);
  await send('1. new webhook  ', sign(body, config.webhookSecret));
  await send('2. duplicate    ', sign(body, config.webhookSecret));
  await send('3. bad signature', 'bad-signature');
})();
