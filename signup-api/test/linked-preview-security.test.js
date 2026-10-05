'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makePortablePreview } = require('../newsletter-runner');

test('preserves linked newsletter images without server-side fetching or embedding', async () => {
  const html = '<img src="https://assets.example/cover.png"><img src="http://127.0.0.1/private">';
  const fetched = [];
  const preview = await makePortablePreview(html, async (url) => {
    fetched.push(url);
    return { ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => Buffer.from('fixture-image') };
  });
  assert.deepEqual(fetched, []);
  assert.equal(preview, html);
});
