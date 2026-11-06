'use strict';

// Run with PLAYWRIGHT_MODULE and PLAYWRIGHT_CHROMIUM_EXECUTABLE pointing to an
// existing local browser installation. No installs, real tokens or live DB.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createReviewFixture } = require('./manga-review-fixture.cjs');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    for (const [button, decision, message] of [
      ['Approve and publish', 'approved', 'Rankings approved and published.'],
      ['Reject', 'rejected', 'Rankings rejected.'],
    ]) {
      const app = await createReviewFixture();
      const page = await browser.newPage();
      try {
        await page.goto(app.base + app.reviewPath);
        const requestPromise = page.waitForRequest((request) => request.method() === 'POST');
        const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST');
        await page.getByRole('button', { name: button, exact: true }).click();
        const request = await requestPromise;
        assert.equal(request.headers().origin, 'null');
        assert.equal((await responsePromise).status(), 200);
        assert.equal(await page.locator('h1').innerText(), message);
        assert.equal(app.state.status, decision);
        assert.equal(app.state.updates, 1);
        const replay = await fetch(app.base + app.reviewPath + '&decision=' + decision, { method: 'POST', headers: { Origin: 'null' } });
        assert.equal(replay.status, 400);
        assert.equal(app.state.updates, 1);
        const publicResult = await (await fetch(app.base + '/api/requests')).json();
        assert.deepEqual(publicResult.requests, decision === 'approved' ? app.rankings : []);
        console.log(`PASS browser ${decision}: Origin=null, HTTP=200, one-time token enforced, public visibility correct`);
      } finally { await page.close(); await app.close(); }
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
