'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createReviewFixture } = require('./manga-review-fixture.cjs');

async function fixture(t) {
  const app = await createReviewFixture();
  t.after(() => app.close());
  return app;
}

// no-referrer pages send Origin: null on browser form POSTs.
test('opaque-origin approval publishes the exact pending snapshot once', async (t) => {
  const app = await fixture(t);
  const before = await fetch(app.base + '/api/requests');
  assert.deepEqual((await before.json()).requests, []);
  const review = await fetch(app.base + app.reviewPath);
  assert.equal(review.status, 200);
  assert.equal(review.headers.get('referrer-policy'), 'no-referrer');
  assert.match(await review.text(), /Fixture &amp; &lt;Manga&gt;/);
  const approve = () => fetch(app.base + app.reviewPath + '&decision=approved', { method: 'POST', headers: { Origin: 'null' } });
  const response = await approve();
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Rankings approved and published/);
  assert.equal(app.state.status, 'approved');
  const after = await fetch(app.base + '/api/requests');
  assert.deepEqual((await after.json()).requests, app.rankings);
  assert.equal((await approve()).status, 400);
  assert.equal(app.state.updates, 1);
  assert.equal((await fetch(app.base + app.reviewPath)).status, 404);
});

test('opaque-origin rejection stays unpublished and cannot be reversed', async (t) => {
  const app = await fixture(t);
  const response = await fetch(app.base + app.reviewPath + '&decision=rejected', { method: 'POST', headers: { Origin: 'null' } });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Rankings rejected/);
  assert.equal(app.state.status, 'rejected');
  assert.equal((await fetch(app.base + app.reviewPath + '&decision=approved', { method: 'POST', headers: { Origin: 'null' } })).status, 400);
  assert.deepEqual((await (await fetch(app.base + '/api/requests')).json()).requests, []);
  assert.equal(app.state.updates, 1);
});

test('missing, short, incorrect tokens and invalid decisions cannot change rankings', async (t) => {
  const app = await fixture(t);
  for (const query of ['decision=approved', 'token=short&decision=approved', `token=${'x'.repeat(64)}&decision=approved`, `token=${app.token}&decision=invalid`]) {
    const response = await fetch(app.base + '/api/manga-results/review?' + query, { method: 'POST', headers: { Origin: 'null' } });
    assert.equal(response.status, 400);
    assert.match(await response.text(), /invalid, expired, or already used/);
  }
  assert.equal(app.state.status, 'pending');
  assert.equal(app.state.updates, 0);
});

test('origin exception stays limited to the exact token-protected POST route', async (t) => {
  const app = await fixture(t);
  for (const [method, path] of [['GET', app.reviewPath], ['POST', '/api/manga-results/review/extra'], ['POST', '/api/subscribe'], ['POST', '/api/request-manga']]) {
    for (const origin of ['null', 'https://untrusted.invalid']) {
      const response = await fetch(app.base + path, { method, headers: { Origin: origin, 'X-Forwarded-Host': 'untrusted.invalid' } });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error, 'Origin not allowed.');
    }
  }
  assert.equal(app.state.queries, 0);
  assert.equal(app.state.updates, 0);
});
