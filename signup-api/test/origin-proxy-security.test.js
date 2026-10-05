'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { requestOriginAllowed } = require('../server');

function request(origin, forwardedHost) {
  return { method: 'GET', headers: { host: 'api.dokkadoki.co.uk', origin, 'x-forwarded-host': forwardedHost }, socket: { remoteAddress: '127.0.0.1' } };
}

test('does not authorize an untrusted origin from caller-supplied forwarded-host', () => {
  const response = {};
  assert.equal(requestOriginAllowed(request('https://not-authorised.invalid', 'not-authorised.invalid'), response, '/api/health'), false);
  assert.equal(response.corsOrigin, undefined);
});

test('allows the API actual same-origin host without trusting forwarded-host', () => {
  const response = {};
  assert.equal(requestOriginAllowed(request('https://api.dokkadoki.co.uk', 'not-authorised.invalid'), response, '/api/health'), true);
  assert.equal(response.corsOrigin, 'https://api.dokkadoki.co.uk');
});
