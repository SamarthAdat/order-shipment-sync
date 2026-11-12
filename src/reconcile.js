// Finds orders with no confirmed shipment that have been stuck for a while
// and fixes them. It never posts to the courier: if the shipment exists we
// record it, otherwise we hand the order back to the worker.
// Run it with `npm run reconcile` (in production: on a schedule).

const { markShipped } = require('./worker');

const STALE_MS = 5 * 60 * 1000;

async function reconcile(db, courier, now = Date.now()) {
  const result = { shipped: 0, requeued: 0, skipped: 0 };
  const stuck = db.prepare(`SELECT id, updated_at FROM orders
    WHERE status IN ('pending', 'processing') AND updated_at < ?`).all(now - STALE_MS);

  for (const order of stuck) {
    let existing;
    try {
      existing = await courier.findShipments(order.id);
    } catch (err) {
      console.error(`order ${order.id}: lookup failed, skipping (${err.message})`);
      result.skipped += 1;
      continue;
    }

    if (existing.length > 0) {
      markShipped(db, order.id, existing[0].shipmentId, now);
      result.shipped += 1;
    } else {
      // Only if nothing touched the row while we were asking the courier.
      db.prepare(`UPDATE orders SET status = 'pending', next_attempt_at = ?, updated_at = ?
        WHERE id = ? AND updated_at = ?`).run(now, now, order.id, order.updated_at);
      result.requeued += 1;
    }
  }
  return result;
}

if (require.main === module) {
  const config = require('./config');
  const { openDb } = require('./db');
  const { createCourier } = require('./courier');

  reconcile(openDb(), createCourier(config.courierUrl)).then((r) => {
    console.log(`reconcile: ${r.shipped} shipped, ${r.requeued} requeued, ${r.skipped} skipped`);
  });
}

module.exports = { STALE_MS, reconcile };
