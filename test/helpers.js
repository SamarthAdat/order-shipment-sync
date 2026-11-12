// Shared helpers for worker / reconcile / replay tests.

function addOrder(db, id, fields = {}) {
  const row = {
    id,
    payload: JSON.stringify({ id, shipping_address: {}, line_items: [] }),
    status: 'pending',
    attempts: 0,
    next_attempt_at: 0,
    created_at: 0,
    updated_at: 0,
    ...fields,
  };
  db.prepare(`INSERT INTO orders (id, payload, status, attempts, next_attempt_at, created_at, updated_at)
    VALUES (:id, :payload, :status, :attempts, :next_attempt_at, :created_at, :updated_at)`).run(row);
}

function getOrder(db, id) {
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
}

// A courier double. `existing` is returned by findShipments (same array, so
// tests can push into it later). `create` is a list of results for
// createShipment, one per call; an Error in the list is thrown.
function fakeCourier({ existing = [], create = [], findError = null } = {}) {
  const courier = {
    existing,
    createCalls: 0,
    async findShipments() {
      if (courier.findError) throw courier.findError;
      return existing;
    },
    async createShipment() {
      const next = create[courier.createCalls];
      courier.createCalls += 1;
      if (next instanceof Error) throw next;
      return next;
    },
    findError,
  };
  return courier;
}

module.exports = { addOrder, getOrder, fakeCourier };
