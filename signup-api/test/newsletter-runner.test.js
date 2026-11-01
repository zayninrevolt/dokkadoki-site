'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildDraft, commandConfirmationMatches, makePortablePreview, createNewsletterEbayClient } = require('../newsletter-runner');

function writeInputMetadata(root, generatedAt) {
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'newsletter-inputs.json'), JSON.stringify({
    generatedAt,
    siteCommit: 'a'.repeat(40),
  }));
}

test('requires exact edition confirmations for test and real sends', () => {
  assert.equal(commandConfirmationMatches('test', '2026-09', 'TEST-2026-09'), true);
  assert.equal(commandConfirmationMatches('send', '2026-09', 'SEND-2026-09'), true);
  assert.equal(commandConfirmationMatches('approve', '2026-09', '2026-09'), true);
  assert.equal(commandConfirmationMatches('test', '2026-09', 'TEST-2026-08'), false);
  assert.equal(commandConfirmationMatches('send', '2026-09', 'TEST-2026-09'), false);
  assert.equal(commandConfirmationMatches('approve', '2026-09', 'SEND-2026-09'), false);
});

test('builds and stores a draft without approving or sending it', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dokkadoki-draft-'));
  const now = new Date('2026-09-02T10:00:00Z');
  fs.mkdirSync(path.join(root, 'content', 'blog'), { recursive: true });
  fs.mkdirSync(path.join(root, 'content', 'events'), { recursive: true });
  fs.writeFileSync(path.join(root, 'content', 'blog', 'hello.md'), '---\ntitle: "Hello"\ndate: 2026-09-01\ndescription: "News"\n---');
  writeInputMetadata(root, now.toISOString());
  const libraryPath = path.join(root, 'library.json');
  fs.writeFileSync(libraryPath, JSON.stringify({ scraped_at: now.toISOString(), items: [{ join_id: 'new', title: 'New manga' }] }));
  const calls = [];
  const pool = { query: async (sql, values = []) => {
    calls.push({ sql, values });
    if (/SELECT join_id FROM newsletter_manga_seen/i.test(sql)) return [[]];
    if (/SELECT status FROM newsletter_editions/i.test(sql)) return [[]];
    return [{ affectedRows: 1 }];
  } };

  const draft = await buildDraft({
    pool,
    root,
    libraryPath,
    siteUrl: 'https://example.com/',
    publicApiUrl: 'https://api.example.com',
    ebayClient: { latestItems: async () => Array.from({ length: 6 }, (_, i) => ({ title: `Item ${i}`, url: `https://ebay.example/${i}` })) },
    now,
  });

  assert.equal(draft.editionId, '2026-09');
  assert.equal(draft.status, 'draft');
  assert.deepEqual(draft.counts, { blogs: 1, ebay: 6, events: 0, manga: 0 });
  assert.equal(calls.some((call) => /INSERT IGNORE INTO newsletter_manga_seen/i.test(call.sql) && call.values[0] === 'new'), true);
  assert.equal(calls.some((call) => /status = 'approved'/i.test(call.sql)), false);
  assert.equal(calls.some((call) => /api\.resend\.com/i.test(call.sql)), false);
});

test('rejects stale website content before accessing the database', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dokkadoki-stale-content-'));
  const now = new Date('2026-11-01T10:00:00Z');
  writeInputMetadata(root, '2026-09-01T10:00:00Z');
  const libraryPath = path.join(root, 'library.json');
  fs.writeFileSync(libraryPath, JSON.stringify({ scraped_at: now.toISOString(), items: [] }));

  await assert.rejects(() => buildDraft({
    pool: { query: async () => { throw new Error('database must not be touched'); } },
    root,
    libraryPath,
    siteUrl: 'https://example.com/',
    publicApiUrl: 'https://api.example.com',
    ebayClient: { latestItems: async () => { throw new Error('eBay must not be touched'); } },
    now,
  }), /Newsletter website content snapshot is stale/);
});

test('rejects a stale Libib catalogue before accessing the database', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dokkadoki-stale-library-'));
  const now = new Date('2026-11-01T10:00:00Z');
  writeInputMetadata(root, now.toISOString());
  const libraryPath = path.join(root, 'library.json');
  fs.writeFileSync(libraryPath, JSON.stringify({ scraped_at: '2026-10-26T03:32:37Z', items: [] }));

  await assert.rejects(() => buildDraft({
    pool: { query: async () => { throw new Error('database must not be touched'); } },
    root,
    libraryPath,
    siteUrl: 'https://example.com/',
    publicApiUrl: 'https://api.example.com',
    ebayClient: { latestItems: async () => { throw new Error('eBay must not be touched'); } },
    now,
  }), /Newsletter Libib catalogue snapshot is stale/);
});

test('newsletter eBay client uses the seller-authorized active inventory', async () => {
  const requests = [];
  const activeXml = `<?xml version="1.0"?><GetMyeBaySellingResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack><ActiveList><HasMoreItems>false</HasMoreItems><ItemArray><Item><ItemID>42</ItemID><Title>Latest active upload</Title><ListingDetails><StartTime>2026-09-01T12:00:00.000Z</StartTime><ViewItemURL>https://www.ebay.co.uk/itm/42</ViewItemURL></ListingDetails><PictureDetails><PictureURL>https://i.ebayimg.com/images/g/example/s-l1600.jpg</PictureURL></PictureDetails><SellingStatus><CurrentPrice currencyID="GBP">12.50</CurrentPrice></SellingStatus></Item></ItemArray></ActiveList></GetMyeBaySellingResponse>`;
  const client = createNewsletterEbayClient({
    env: {
      EBAY_CLIENT_ID: 'client',
      EBAY_CLIENT_SECRET: 'secret',
      EBAY_SELLER: 'dokkadokiltd',
      EBAY_USER_TOKEN: 'private-user-token',
    },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, text: async () => activeXml };
    },
  });

  const items = await client.latestItems();
  assert.equal(items[0].title, 'Latest active upload');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.headers['X-EBAY-API-CALL-NAME'], 'GetMyeBaySelling');
});


test('preserves linked preview images without making any image requests', async () => {
  const fetched = [];
  const html = '<img src="https://assets.example/cover.png" alt="Cover"><img src="http://assets.example/insecure.png" alt="Insecure">';
  const preview = await makePortablePreview(html, async (url) => {
    fetched.push(url);
    throw new Error('Image fetching must not occur');
  });

  assert.deepEqual(fetched, []);
  assert.equal(preview, html);
});

test('preserves an existing data-image URI without fetching or rewriting it', async () => {
  const html = '<img src="data:image/png;base64,aW1hZ2UtYnl0ZXM=">';
  let calls = 0;
  const preview = await makePortablePreview(html, async () => {
    calls += 1;
    throw new Error('Image fetching must not occur');
  });

  assert.equal(calls, 0);
  assert.equal(preview, html);
});
