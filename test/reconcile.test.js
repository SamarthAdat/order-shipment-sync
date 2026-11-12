const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { reconcile } = require('../src/reconcile');
const { addOrder, getOrder, fakeCourier } = require('./helpers');

const NOW = 10 * 60 * 1000; // orders with updated_at 0 are 10 minutes old

test('stuck order found at courier is marked shipped without posting', async () => {
  const db = openDb(':memory:');
  addOrder(db, '1', { status: 'processing' });
  const courier = fakeCourier({ existing: [{ shipmentId: 's1', reference: '1' }] });

  const result = await reconcile(db, courier, NOW);

  assert.deepEqual(result, { shipped: 1, requeued: 0, skipped: 0 });
  assert.equal(getOrder(db, '1').status, 'shipped');
  assert.equal(getOrder(db, '1').shipment_id, 's1');
  assert.equal(courier.createCalls, 0);
});

test('stuck order not at courier goes back to pending', async () => {
  const db = openDb(':memory:');
  addOrder(db, '1', { status: 'processing' });
  const courier = fakeCourier();

  const result = await reconcile(db, courier, NOW);

  assert.deepEqual(result, { shipped: 0, requeued: 1, skipped: 0 });
  assert.equal(getOrder(db, '1').status, 'pending');
  assert.equal(getOrder(db, '1').next_attempt_at, NOW);
  assert.equal(courier.createCalls, 0);
});

test('recent and failed orders are left alone', async () => {
  const db = openDb(':memory:');
  addOrder(db, '1', { status: 'processing', updated_at: NOW });
  addOrder(db, '2', { status: 'failed' });

  const result = await reconcile(db, fakeCourier(), NOW);

  assert.deepEqual(result, { shipped: 0, requeued: 0, skipped: 0 });
  assert.equal(getOrder(db, '1').status, 'processing');
  assert.equal(getOrder(db, '2').status, 'failed');
});

test('lookup error is skipped', async () => {
  const db = openDb(':memory:');
  addOrder(db, '1', { status: 'processing' });

  const result = await reconcile(db, fakeCourier({ findError: new Error('down') }), NOW);

  assert.deepEqual(result, { shipped: 0, requeued: 0, skipped: 1 });
  assert.equal(getOrder(db, '1').status, 'processing');
});
