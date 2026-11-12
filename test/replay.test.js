const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { listParked, replay } = require('../src/replay');
const { addOrder, getOrder } = require('./helpers');

test('replay resets a parked order', () => {
  const db = openDb(':memory:');
  addOrder(db, '1', { status: 'failed', attempts: 5 });

  assert.equal(replay(db, '1', 42), true);
  const order = getOrder(db, '1');
  assert.equal(order.status, 'pending');
  assert.equal(order.attempts, 0);
  assert.equal(order.next_attempt_at, 42);
});

test('replay ignores orders that are not parked', () => {
  const db = openDb(':memory:');
  addOrder(db, '1', { status: 'shipped' });

  assert.equal(replay(db, '1'), false);
  assert.equal(getOrder(db, '1').status, 'shipped');
});

test('listParked returns only failed orders', () => {
  const db = openDb(':memory:');
  addOrder(db, '1', { status: 'failed' });
  addOrder(db, '2', { status: 'shipped' });

  assert.deepEqual(listParked(db).map((o) => o.id), ['1']);
});
