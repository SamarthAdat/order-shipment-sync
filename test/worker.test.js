const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { claimNext, processOrder } = require('../src/worker');
const { addOrder, getOrder, fakeCourier } = require('./helpers');

test('claimNext picks a due pending order', () => {
  const db = openDb(':memory:');
  addOrder(db, '1');
  assert.equal(claimNext(db, 1).id, '1');
  assert.equal(getOrder(db, '1').status, 'processing');
  assert.equal(claimNext(db, 1), undefined);
});

test('claimNext skips orders not yet due', () => {
  const db = openDb(':memory:');
  addOrder(db, '1', { next_attempt_at: 1000 });
  assert.equal(claimNext(db, 999), undefined);
});

test('creates shipment and marks shipped', async () => {
  const db = openDb(':memory:');
  addOrder(db, '1');
  const courier = fakeCourier({ create: [{ ok: true, shipmentId: 's1' }] });
  await processOrder(db, courier, claimNext(db, 1), 1);
  const order = getOrder(db, '1');
  assert.equal(order.status, 'shipped');
  assert.equal(order.shipment_id, 's1');
  assert.equal(courier.createCalls, 1);
});

test('uses existing shipment instead of posting', async () => {
  const db = openDb(':memory:');
  addOrder(db, '1');
  const courier = fakeCourier({ existing: [{ shipmentId: 's9', reference: '1' }] });
  await processOrder(db, courier, claimNext(db, 1), 1);
  const order = getOrder(db, '1');
  assert.equal(order.status, 'shipped');
  assert.equal(order.shipment_id, 's9');
  assert.equal(courier.createCalls, 0);
});
