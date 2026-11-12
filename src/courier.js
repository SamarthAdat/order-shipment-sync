// Small client for the courier API. Timeouts and network errors throw;
// HTTP errors from createShipment are returned so the worker can decide.

function parseRetryAfter(value) {
  const seconds = Number(value);
  return value !== null && value.trim() !== '' && Number.isFinite(seconds) && seconds >= 0
    ? seconds
    : null;
}

function createCourier(baseUrl, timeoutMs = 5000) {
  async function createShipment({ reference, address, items }) {
    const res = await fetch(`${baseUrl}/shipments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reference, address, items }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 201) {
      const data = await res.json();
      return { ok: true, shipmentId: data.shipmentId };
    }
    return { ok: false, status: res.status, retryAfter: parseRetryAfter(res.headers.get('retry-after')) };
  }

  async function findShipments(reference) {
    const url = `${baseUrl}/shipments?reference=${encodeURIComponent(reference)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`courier lookup returned ${res.status}`);
    return res.json();
  }

  return { createShipment, findShipments };
}

module.exports = { createCourier };
