const http = require('node:http');
const { verify } = require('./hmac');

function send(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

// Returns the order id as a string, or null if the body isn't a valid order.
function parseOrderId(raw) {
  // Order ids can be bigger than JavaScript numbers hold exactly, so we keep
  // the id's original text from the body instead of the parsed number.
  const idText = new WeakMap();
  let order;
  try {
    order = JSON.parse(raw, function (key, value, context) {
      if (key === 'id' && typeof value === 'number') idText.set(this, context.source);
      return value;
    });
  } catch {
    return null;
  }
  if (!order || typeof order !== 'object' || Array.isArray(order)) return null;
  if (typeof order.id === 'number') return idText.get(order);
  if (typeof order.id === 'string' && order.id !== '') return order.id;
  return null;
}

// Saves the webhook and the order in one transaction.
// Returns true if this webhook (or this order) was already seen.
function saveOrder(db, webhookId, orderId, payload) {
  const now = Date.now();
  db.exec('BEGIN');
  try {
    let duplicate = false;
    if (webhookId) {
      const seen = db
        .prepare('INSERT OR IGNORE INTO webhooks (webhook_id, order_id, received_at) VALUES (?, ?, ?)')
        .run(webhookId, orderId, now);
      duplicate = seen.changes === 0;
    }
    if (!duplicate) {
      const added = db
        .prepare(`INSERT OR IGNORE INTO orders
          (id, payload, status, next_attempt_at, created_at, updated_at)
          VALUES (?, ?, 'pending', ?, ?, ?)`)
        .run(orderId, payload, now, now, now);
      duplicate = added.changes === 0;
    }
    db.exec('COMMIT');
    return duplicate;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function createServer({ db, secret }) {
  return http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/webhooks/orders-create') {
      return send(res, 404, { error: 'not found' });
    }

    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks);

      if (!verify(raw, secret, req.headers['x-shop-hmac-sha256'])) {
        return send(res, 401, { error: 'invalid signature' });
      }

      const body = raw.toString();
      const orderId = parseOrderId(body);
      if (!orderId) return send(res, 400, { error: 'invalid order' });

      // No courier call here: the worker picks the order up later,
      // so we can answer the store right away.
      const duplicate = saveOrder(db, req.headers['x-shop-webhook-id'], orderId, body);
      send(res, 200, duplicate ? { ok: true, duplicate: true } : { ok: true });
    } catch (err) {
      console.error('webhook error:', err);
      send(res, 500, { error: 'internal error' });
    }
  });
}

module.exports = { createServer };
