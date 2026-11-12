// A fake courier API that fails in the same ways the real one does.
//
//   POST /shipments              -> 201 { shipmentId, reference }
//     20% -> 500
//     10% -> 429 with Retry-After: 2
//     10% -> creates the shipment, then hangs before replying (timeout)
//     Not idempotent: the same reference twice creates two shipments.
//   GET /shipments?reference=X   -> list of shipments for X (always works)

const http = require('node:http');
const config = require('./src/config');

function createMockCourier({ random = Math.random, hangMs = 10000 } = {}) {
  const shipments = [];
  let counter = 0;

  function addShipment(body) {
    counter += 1;
    const shipment = { shipmentId: `shp_${counter}`, reference: String(body.reference) };
    shipments.push({ ...shipment, address: body.address, items: body.items });
    return shipment;
  }

  function send(res, status, data, headers = {}) {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(data));
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/shipments') {
      const reference = url.searchParams.get('reference');
      const found = shipments
        .filter((s) => s.reference === reference)
        .map(({ shipmentId, reference }) => ({ shipmentId, reference }));
      console.log(`GET  ref=${reference} -> ${found.length} found`);
      return send(res, 200, found);
    }

    if (req.method === 'POST' && url.pathname === '/shipments') {
      let body;
      try {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        body = JSON.parse(raw);
      } catch {
        return send(res, 400, { error: 'invalid json' });
      }
      if (!body || body.reference === undefined) {
        return send(res, 400, { error: 'reference is required' });
      }

      const r = random();
      if (r < 0.2) {
        console.log(`POST ref=${body.reference} -> 500`);
        return send(res, 500, { error: 'internal error' });
      }
      if (r < 0.3) {
        console.log(`POST ref=${body.reference} -> 429`);
        return send(res, 429, { error: 'rate limited' }, { 'retry-after': '2' });
      }
      const shipment = addShipment(body);
      if (r < 0.4) {
        console.log(`POST ref=${body.reference} -> created ${shipment.shipmentId}, hanging ${hangMs}ms`);
        return setTimeout(() => send(res, 201, shipment), hangMs);
      }
      console.log(`POST ref=${body.reference} -> 201 ${shipment.shipmentId}`);
      return send(res, 201, shipment);
    }

    send(res, 404, { error: 'not found' });
  });
}

if (require.main === module) {
  createMockCourier().listen(config.courierPort, () => {
    console.log(`mock courier on :${config.courierPort}`);
  });
}

module.exports = { createMockCourier };
