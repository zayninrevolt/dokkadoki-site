'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { requestOriginAllowed } = require('../server');

function request(method, origin, host = 'api.dokkadoki.co.uk') {
  return { method, headers: { origin, host }, socket: { remoteAddress: '203.0.113.10' } };
}

test('allows signed unsubscribe confirmation POSTs from opaque email-client origins', () => {
  const response = {};
  assert.equal(requestOriginAllowed(request('POST', 'null'), response, '/api/newsletter/unsubscribe'), true);
  assert.equal(requestOriginAllowed(request('POST', 'https://mail.google.com'), response, '/api/newsletter/unsubscribe'), true);
});

test('continues to block unrelated untrusted cross-origin POST requests', () => {
  assert.equal(requestOriginAllowed(request('POST', 'https://evil.example'), {}, '/api/subscribe'), false);
});
