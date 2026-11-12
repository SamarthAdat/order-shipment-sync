// Background worker: takes one due order at a time and creates its shipment.

const MAX_ATTEMPTS = 5;

// 1s, 2s, 4s, 8s ... capped at 60s.
function backoffMs(attempts) {
  return Math.min(1000 * 2 ** (attempts - 1), 60000);
}

function claimNext(db, now = Date.now()) {
  return db.prepare(`
    UPDATE orders SET status = 'processing', updated_at = :now
    WHERE id = (SELECT id FROM orders
                WHERE status = 'pending' AND next_attempt_at <= :now
                ORDER BY next_attempt_at LIMIT 1)
    RETURNING *`).get({ now });
}

function markShipped(db, id, shipmentId, now = Date.now()) {
  db.prepare(`UPDATE orders SET status = 'shipped', shipment_id = ?, last_error = NULL, updated_at = ?
    WHERE id = ?`).run(shipmentId, now, id);
  return `shipped ${shipmentId}`;
}

function park(db, id, attempts, error, now) {
  db.prepare(`UPDATE orders SET status = 'failed', attempts = ?, last_error = ?, updated_at = ?
    WHERE id = ?`).run(attempts, error, now, id);
  return `parked after ${attempts} attempt(s): ${error}`;
}

function retry(db, row, error, retryAfterSeconds, now) {
  const attempts = row.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) return park(db, row.id, attempts, error, now);

  const delay = retryAfterSeconds !== null ? retryAfterSeconds * 1000 : backoffMs(attempts);
  db.prepare(`UPDATE orders SET status = 'pending', attempts = ?, next_attempt_at = ?, last_error = ?,
    updated_at = ? WHERE id = ?`).run(attempts, now + delay, error, now, row.id);
  return `retry in ${delay}ms: ${error}`;
}

// Never throws. Returns a short description of what happened, for logs.
async function processOrder(db, courier, row, now = Date.now()) {
  try {
    // Check first: an earlier attempt may have created the shipment and then
    // timed out. If so, we use it and never post again.
    const existing = await courier.findShipments(row.id);
    if (existing.length > 0) return markShipped(db, row.id, existing[0].shipmentId, now);

    const order = JSON.parse(row.payload);
    const result = await courier.createShipment({
      reference: row.id,
      address: order.shipping_address,
      items: order.line_items,
    });
    if (result.ok) return markShipped(db, row.id, result.shipmentId, now);

    const error = `courier returned ${result.status}`;
    if (result.status === 429) return retry(db, row, error, result.retryAfter, now);
    // Other 4xx means our request is wrong; retrying will not help.
    if (result.status >= 400 && result.status < 500) return park(db, row.id, row.attempts + 1, error, now);
    return retry(db, row, error, null, now);
  } catch (err) {
    // Timeouts and network errors. The shipment may exist; the next
    // attempt's check will find it.
    return retry(db, row, err.message, null, now);
  }
}

function startWorker(db, courier, intervalMs = 500) {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const row = claimNext(db);
      if (row) console.log(`order ${row.id}: ${await processOrder(db, courier, row)}`);
    } catch (err) {
      console.error('worker error:', err);
    } finally {
      busy = false;
    }
  }, intervalMs);
  return () => clearInterval(timer);
}

module.exports = { MAX_ATTEMPTS, backoffMs, claimNext, markShipped, processOrder, startWorker };
