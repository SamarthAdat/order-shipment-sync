// Parked orders are orders with status 'failed'.
//   npm run replay              -> list parked orders
//   npm run replay -- <orderId> -> put one back in the queue

function listParked(db) {
  return db.prepare(`SELECT id, attempts, last_error FROM orders
    WHERE status = 'failed' ORDER BY updated_at`).all();
}

function replay(db, orderId, now = Date.now()) {
  const result = db.prepare(`UPDATE orders
    SET status = 'pending', attempts = 0, next_attempt_at = ?, updated_at = ?
    WHERE id = ? AND status = 'failed'`).run(now, now, orderId);
  return result.changes === 1;
}

if (require.main === module) {
  const { openDb } = require('./db');
  const db = openDb();
  const orderId = process.argv[2];

  if (orderId) {
    console.log(replay(db, orderId) ? `replayed ${orderId}` : `${orderId} is not parked`);
  } else {
    const parked = listParked(db);
    if (parked.length === 0) console.log('no parked orders');
    for (const o of parked) console.log(`${o.id}  attempts=${o.attempts}  ${o.last_error}`);
  }
}

module.exports = { listParked, replay };
