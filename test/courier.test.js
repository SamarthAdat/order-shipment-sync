const test = require('node:test');
const assert = require('node:assert');
const { createMockCourier } = require('../mock-courier');
const { createCourier } = require('../src/courier');

// The mock picks its behaviour from random(); we fix it per test.
let r = 0.9;
let mock;
let courier;

test.before(async () => {
  mock = createMockCourier({ random: () => r, hangMs: 300 });
  await new Promise((resolve) => mock.listen(0, resolve));
  courier = createCourier(`http://localhost:${mock.address().port}`, 100);
});

test.after(() => {
  mock.closeAllConnections();
  mock.close();
});

const body = (reference) => ({ reference, address: {}, items: [] });

test('201 returns shipment id', async () => {
  r = 0.9;
  const result = await courier.createShipment(body('a'));
  assert.equal(result.ok, true);
  assert.match(result.shipmentId, /^shp_/);
});

test('500 returns status', async () => {
  r = 0.1;
  assert.deepEqual(await courier.createShipment(body('b')), { ok: false, status: 500, retryAfter: null });
});

test('429 returns retryAfter', async () => {
  r = 0.25;
  assert.deepEqual(await courier.createShipment(body('c')), { ok: false, status: 429, retryAfter: 2 });
});

test('hang throws but shipment exists', async () => {
  r = 0.35;
  await assert.rejects(courier.createShipment(body('d')));
  const found = await courier.findShipments('d');
  assert.equal(found.length, 1);
});
