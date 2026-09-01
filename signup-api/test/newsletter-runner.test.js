'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildDraft, commandConfirmationMatches, makePortablePreview, createNewsletterEbayClient } = require('../newsletter-runner');

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
  fs.mkdirSync(path.join(root, 'content', 'blog'), { recursive: true });
  fs.mkdirSync(path.join(root, 'content', 'events'), { recursive: true });
  fs.writeFileSync(path.join(root, 'content', 'blog', 'hello.md'), '---\ntitle: "Hello"\ndate: 2026-09-01\ndescription: "News"\n---');
  const libraryPath = path.join(root, 'library.json');
  fs.writeFileSync(libraryPath, JSON.stringify({ items: [{ join_id: 'new', title: 'New manga' }] }));
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
    now: new Date('2026-09-02T10:00:00Z'),
  });

  assert.equal(draft.editionId, '2026-09');
  assert.equal(draft.status, 'draft');
  assert.deepEqual(draft.counts, { blogs: 1, ebay: 6, events: 0, manga: 0 });
  assert.equal(calls.some((call) => /INSERT IGNORE INTO newsletter_manga_seen/i.test(call.sql) && call.values[0] === 'new'), true);
  assert.equal(calls.some((call) => /status = 'approved'/i.test(call.sql)), false);
  assert.equal(calls.some((call) => /api\.resend\.com/i.test(call.sql)), false);
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


test('embeds safe preview images while leaving unsafe image URLs untouched', async () => {
  const fetched = [];
  const html = '<img src="https://assets.example/cover.png" alt="Cover"><img src="http://assets.example/insecure.png" alt="Insecure">';
  const preview = await makePortablePreview(html, async (url) => {
    fetched.push(url);
    return {
      ok: true,
      headers: { get: (name) => name === 'content-type' ? 'image/png' : null },
      arrayBuffer: async () => Buffer.from('image-bytes'),
    };
  });

  assert.deepEqual(fetched, ['https://assets.example/cover.png']);
  assert.match(preview, /src="data:image\/png;base64,aW1hZ2UtYnl0ZXM="/);
  assert.match(preview, /src="http:\/\/assets\.example\/insecure\.png"/);
});

test('embeds a preview image up to the 3.2 MB review-artifact limit', async () => {
  const preview = await makePortablePreview('<img src="https://assets.example/large-cover.jpg">', async () => ({
    ok: true,
    headers: { get: (name) => name === 'content-type' ? 'image/jpeg' : '3100000' },
    arrayBuffer: async () => Buffer.from('large-cover'),
  }));

  assert.match(preview, /src="data:image\/jpeg;base64,bGFyZ2UtY292ZXI="/);
});
