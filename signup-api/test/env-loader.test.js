'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadEnvFile } = require('../env-loader');

test('loads quoted private values without overriding Docker environment', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dokkadoki-env-'));
  const file = path.join(dir, '.env');
  fs.writeFileSync(file, [
    '# private runtime values',
    'EBAY_CLIENT_ID=from-file',
    'EBAY_CLIENT_SECRET="secret with spaces"',
    "EBAY_SELLER='dokkadokiltd'",
    'INVALID-NAME=ignored',
    'BROKEN_LINE',
  ].join('\n'));
  const target = { EBAY_CLIENT_ID: 'from-docker' };

  const result = loadEnvFile(file, target);

  assert.deepEqual(result, { loaded: 2, skippedExisting: 1 });
  assert.equal(target.EBAY_CLIENT_ID, 'from-docker');
  assert.equal(target.EBAY_CLIENT_SECRET, 'secret with spaces');
  assert.equal(target.EBAY_SELLER, 'dokkadokiltd');
  assert.equal(target['INVALID-NAME'], undefined);
});

test('missing env file is non-fatal', () => {
  const target = {};
  assert.deepEqual(loadEnvFile('/does/not/exist', target), { loaded: 0, skippedExisting: 0 });
});
