const crypto = require('node:crypto');

// Base64 HMAC-SHA256 of the raw body, the same way the store signs it.
function sign(body, secret) {
  return crypto.createHmac('sha256', secret).update(body).digest('base64');
}

function verify(body, secret, header) {
  if (typeof header !== 'string') return false;
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(header);
  // timingSafeEqual throws on different lengths, so check that first.
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

module.exports = { sign, verify };
