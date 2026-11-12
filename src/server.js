const http = require('node:http');
const { verify } = require('./hmac');

function send(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

function parseOrder(raw) {
  try {
    const order = JSON.parse(raw);
    const id = order?.id;
    const validId = typeof id === 'number' || (typeof id === 'string' && id !== '');
    return order && !Array.isArray(order) && validId ? order : null;
  } catch {
    return null;
  }
}

// Saves the webhook and the order in one transaction.
// Returns true if this webhook (or this order) was already seen.
function saveOrder(db, webhookId, order) {
  const now = Date.now();
  const orderId = String(order.id);
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
        .run(orderId, JSON.stringify(order), now, now, now);
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

      const order = parseOrder(raw);
      if (!order) return send(res, 400, { error: 'invalid order' });

      // No courier call here: the worker picks the order up later,
      // so we can answer the store right away.
      const duplicate = saveOrder(db, req.headers['x-shop-webhook-id'], order);
      send(res, 200, duplicate ? { ok: true, duplicate: true } : { ok: true });
    } catch (err) {
      console.error('webhook error:', err);
      send(res, 500, { error: 'internal error' });
    }
  });
}

module.exports = { createServer };
