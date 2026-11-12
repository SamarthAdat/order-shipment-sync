const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');

test('creates tables and order id is unique', () => {
  const db = openDb(':memory:');
  const insert = db.prepare(`INSERT OR IGNORE INTO orders
    (id, payload, status, next_attempt_at, created_at, updated_at)
    VALUES ('1', '{}', 'pending', 0, 0, 0)`);

  assert.equal(insert.run().changes, 1);
  assert.equal(insert.run().changes, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM webhooks').get().n, 0);
});

test('waits for a busy database instead of failing at once', () => {
  // The service, reconcile and replay can write to the same file at once.
  const db = openDb(':memory:');
  assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout, 5000);
});
