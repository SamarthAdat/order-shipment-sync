const test = require('node:test');
const assert = require('node:assert');
const { sign, verify } = require('../src/hmac');

const secret = 'test-secret';
const body = Buffer.from('{"id":1}');

test('valid signature passes', () => {
  assert.equal(verify(body, secret, sign(body, secret)), true);
});

test('wrong secret fails', () => {
  assert.equal(verify(body, secret, sign(body, 'other')), false);
});

test('tampered body fails', () => {
  assert.equal(verify(Buffer.from('{"id":2}'), secret, sign(body, secret)), false);
});

test('missing header fails', () => {
  assert.equal(verify(body, secret, undefined), false);
});

test('different length header fails without throwing', () => {
  assert.equal(verify(body, secret, 'abc'), false);
});
