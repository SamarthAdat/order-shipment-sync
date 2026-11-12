const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { sign } = require('../src/hmac');
const { createServer } = require('../src/server');

const secret = 'test-secret';
let db;
let server;
let url;

test.beforeEach(async () => {
  db = openDb(':memory:');
  server = createServer({ db, secret });
  await new Promise((resolve) => server.listen(0, resolve));
  url = `http://localhost:${server.address().port}`;
});

test.afterEach(() => server.close());

async function post(body, headers = {}) {
  const res = await fetch(`${url}/webhooks/orders-create`, {
    method: 'POST',
    headers: { 'x-shop-hmac-sha256': sign(body, secret), ...headers },
    body,
  });
  return { status: res.status, body: await res.json() };
}

const countOrders = () => db.prepare('SELECT count(*) AS n FROM orders').get().n;

test('rejects bad signature with 401', async () => {
  const res = await post('{"id":1}', { 'x-shop-hmac-sha256': 'bad' });
  assert.equal(res.status, 401);
  assert.equal(countOrders(), 0);
});

test('accepts a signed webhook', async () => {
  const res = await post('{"id":1}', { 'x-shop-webhook-id': 'w1' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(countOrders(), 1);
  assert.equal(db.prepare('SELECT status FROM orders').get().status, 'pending');
});

test('same webhook id twice makes one order', async () => {
  await post('{"id":1}', { 'x-shop-webhook-id': 'w1' });
  const res = await post('{"id":1}', { 'x-shop-webhook-id': 'w1' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, duplicate: true });
  assert.equal(countOrders(), 1);
});

test('same order id with a new webhook id makes one order', async () => {
  await post('{"id":1}', { 'x-shop-webhook-id': 'w1' });
  const res = await post('{"id":1}', { 'x-shop-webhook-id': 'w2' });
  assert.deepEqual(res.body, { ok: true, duplicate: true });
  assert.equal(countOrders(), 1);
});

test('numeric and string id are the same order', async () => {
  await post('{"id":123}', { 'x-shop-webhook-id': 'w1' });
  const res = await post('{"id":"123"}', { 'x-shop-webhook-id': 'w2' });
  assert.deepEqual(res.body, { ok: true, duplicate: true });
  assert.equal(countOrders(), 1);
  assert.equal(db.prepare('SELECT id FROM orders').get().id, '123');
});

test('works without a webhook id header', async () => {
  const first = await post('{"id":1}');
  const second = await post('{"id":1}');
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(countOrders(), 1);
});

test('rejects bad JSON and non-orders with 400', async () => {
  for (const body of ['not json', 'null', '[]', '{}']) {
    const res = await post(body);
    assert.equal(res.status, 400, `body ${body}`);
  }
  assert.equal(countOrders(), 0);
});

test('unknown path is 404', async () => {
  const res = await fetch(`${url}/nope`);
  assert.equal(res.status, 404);
});

test('large numeric ids are kept exactly', async () => {
  // Bigger than Number.MAX_SAFE_INTEGER: JSON.parse alone would round both to ...500.
  await post('{"id":820982911946154508}', { 'x-shop-webhook-id': 'w1' });
  const res = await post('{"id":820982911946154509}', { 'x-shop-webhook-id': 'w2' });
  assert.deepEqual(res.body, { ok: true });
  const ids = db.prepare('SELECT id, payload FROM orders ORDER BY id').all();
  assert.deepEqual(ids.map((o) => o.id), ['820982911946154508', '820982911946154509']);
  assert.match(ids[0].payload, /820982911946154508/);
});
