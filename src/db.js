const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

// The order row is also the job: the worker picks up 'pending' orders
// whose next_attempt_at has passed. Unique keys give us idempotency.
const schema = `
  CREATE TABLE IF NOT EXISTS webhooks (
    webhook_id  TEXT PRIMARY KEY,
    order_id    TEXT NOT NULL,
    received_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id              TEXT PRIMARY KEY,
    payload         TEXT NOT NULL,
    status          TEXT NOT NULL,  -- pending | processing | shipped | failed
    shipment_id     TEXT,
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL,
    last_error      TEXT,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  );
`;

function openDb(path = config.dbPath) {
  const db = new DatabaseSync(path);
  db.exec(schema);
  return db;
}

module.exports = { openDb };
