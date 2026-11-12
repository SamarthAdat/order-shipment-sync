// Background worker: takes one due order at a time and creates its shipment.

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
}

async function processOrder(db, courier, row, now = Date.now()) {
  // Check first: an earlier attempt may have created the shipment and then
  // timed out. If so, we use it and never post again.
  const existing = await courier.findShipments(row.id);
  if (existing.length > 0) {
    return markShipped(db, row.id, existing[0].shipmentId, now);
  }

  const order = JSON.parse(row.payload);
  const result = await courier.createShipment({
    reference: row.id,
    address: order.shipping_address,
    items: order.line_items,
  });
  if (result.ok) return markShipped(db, row.id, result.shipmentId, now);

  throw new Error(`courier returned ${result.status}`);
}

module.exports = { claimNext, markShipped, processOrder };
