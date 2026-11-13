const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { claimNext, processOrder, backoffMs } = require('../src/worker');
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

// --- retries, backoff, rate limits, parking ---

const NOW = 10_000;

async function runOnce(db, courier) {
  await processOrder(db, courier, claimNext(db, NOW), NOW);
  return getOrder(db, '1');
}

test('backoff doubles and caps', () => {
  assert.equal(backoffMs(1), 1000);
  assert.equal(backoffMs(2), 2000);
  assert.equal(backoffMs(4), 8000);
  assert.equal(backoffMs(10), 60000);
});

test('500 schedules a retry with backoff', async () => {
  const db = openDb(':memory:');
  addOrder(db, '1');
  const order = await runOnce(db, fakeCourier({ create: [{ ok: false, status: 500, retryAfter: null }] }));
  assert.equal(order.status, 'pending');
  assert.equal(order.attempts, 1);
  assert.equal(order.next_attempt_at, 11_000);
  assert.match(order.last_error, /500/);
});

test('429 waits for Retry-After', async () => {
  const db = openDb(':memory:');
  addOrder(db, '1');
  const order = await runOnce(db, fakeCourier({ create: [{ ok: false, status: 429, retryAfter: 2 }] }));
  assert.equal(order.status, 'pending');
  assert.equal(order.next_attempt_at, 12_000);
});

test('429 without Retry-After falls back to backoff', async () => {
  const db = openDb(':memory:');
  addOrder(db, '1');
  const order = await runOnce(db, fakeCourier({ create: [{ ok: false, status: 429, retryAfter: null }] }));
  assert.equal(order.next_attempt_at, 11_000);
});

test('timeout then retry finds the shipment and does not post again', async () => {
  const db = openDb(':memory:');
  addOrder(db, '1');
  const courier = fakeCourier({ create: [new Error('timeout')] });
  assert.equal((await runOnce(db, courier)).status, 'pending');

  // The courier did create it before timing out.
  courier.existing.push({ shipmentId: 's1', reference: '1' });
  await processOrder(db, courier, claimNext(db, NOW + 60_000), NOW + 60_000);

  const order = getOrder(db, '1');
  assert.equal(order.status, 'shipped');
  assert.equal(order.shipment_id, 's1');
  assert.equal(courier.createCalls, 1);
});

test('lookup failure is retried, not stuck', async () => {
  const db = openDb(':memory:');
  addOrder(db, '1');
  const order = await runOnce(db, fakeCourier({ findError: new Error('network down') }));
  assert.equal(order.status, 'pending');
  assert.equal(order.attempts, 1);
});

test('parks after 5 failed attempts', async () => {
  const db = openDb(':memory:');
  addOrder(db, '1', { attempts: 4 });
  const order = await runOnce(db, fakeCourier({ create: [{ ok: false, status: 500, retryAfter: null }] }));
  assert.equal(order.status, 'failed');
  assert.equal(order.attempts, 5);
});

test('other 4xx parks at once', async () => {
  const db = openDb(':memory:');
  addOrder(db, '1');
  const order = await runOnce(db, fakeCourier({ create: [{ ok: false, status: 400, retryAfter: null }] }));
  assert.equal(order.status, 'failed');
  assert.equal(order.attempts, 1);
});

test('timeout after the POST waits 30s before checking again', async () => {
  // The courier may still be saving the shipment. Checking again after 1s
  // could find nothing and post a second time.
  const db = openDb(':memory:');
  addOrder(db, '1');
  const order = await runOnce(db, fakeCourier({ create: [new Error('timeout')] }));
  assert.equal(order.status, 'pending');
  assert.equal(order.next_attempt_at, NOW + 30_000);
});

test('lookup failure before any POST uses normal backoff', async () => {
  const db = openDb(':memory:');
  addOrder(db, '1');
  const order = await runOnce(db, fakeCourier({ findError: new Error('network down') }));
  assert.equal(order.next_attempt_at, NOW + 1000);
});
