'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchLatestEbayItems, createEbayClient } = require('../ebay');

test('requests and returns the six newest valid listings for the configured seller', async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes('/identity/v1/oauth2/token')) {
      return { ok: true, json: async () => ({ access_token: 'token', expires_in: 7200 }) };
    }
    return {
      ok: true,
      json: async () => ({
        itemSummaries: Array.from({ length: 8 }, (_, index) => ({
          title: `Item ${index + 1}`,
          itemWebUrl: `https://www.ebay.co.uk/itm/${index + 1}`,
          image: { imageUrl: `https://i.ebayimg.com/${index + 1}.jpg` },
          price: { value: String(index + 1), currency: 'GBP' },
          itemCreationDate: `2026-08-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
        })),
      }),
    };
  };

  const items = await fetchLatestEbayItems({
    clientId: 'client',
    clientSecret: 'secret',
    seller: 'dokkadokiltd',
    fetchImpl,
  });

  assert.equal(items.length, 6);
  const search = new URL(requests[1].url);
  assert.equal(search.searchParams.get('q'), null);
  assert.equal(search.searchParams.get('limit'), '6');
  assert.equal(search.searchParams.get('sort'), 'newlyListed');
  assert.equal(search.searchParams.get('filter'), 'sellers:{dokkadokiltd}');
  assert.ok(String(search.searchParams.getAll('filter')).includes('category_ids:{69528,183456}'));
  assert.deepEqual(items[0], {
    title: 'Item 1',
    url: 'https://www.ebay.co.uk/itm/1',
    image: 'https://i.ebayimg.com/1.jpg',
    price: '1',
    currency: 'GBP',
    itemCreationDate: '2026-08-01T12:00:00.000Z',
  });
});

test('rejects unsafe seller identifiers before making a request', async () => {
  await assert.rejects(
    fetchLatestEbayItems({
      clientId: 'client',
      clientSecret: 'secret',
      seller: 'bad seller}',
      fetchImpl: async () => { throw new Error('must not fetch'); },
    }),
    /Invalid eBay seller name/
  );
});

test('falls back to a keyword search when the category query fails', async () => {
  const requests = [];
  let searchCalls = 0;
  const fetchImpl = async (url, options = {}) => {
    requests.push(String(url));
    if (String(url).includes('/identity/v1/oauth2/token')) {
      return { ok: true, json: async () => ({ access_token: 'token', expires_in: 7200 }) };
    }
    searchCalls += 1;
    if (searchCalls === 1) return { ok: false };
    return {
      ok: true,
      json: async () => ({ itemSummaries: [{ title: 'Fallback item', itemWebUrl: 'https://www.ebay.co.uk/itm/1', price: { value: '9.99', currency: 'GBP' } }] }),
    };
  };

  const items = await fetchLatestEbayItems({
    clientId: 'client',
    clientSecret: 'secret',
    seller: 'dokkadokiltd',
    fetchImpl,
    accessToken: 'token',
  });

  assert.equal(items.length, 1);
  const searches = requests.filter((u) => u.includes('/item_summary/search'));
  assert.equal(searches.length, 2);
  const fallback = new URL(searches[1]);
  assert.equal(fallback.searchParams.get('q'), 'anime');
  assert.ok(!String(fallback.searchParams.getAll('filter')).includes('category_ids'));
});

test('keeps the active-list feed order and enriches those listings with their own eBay images', async () => {
  const activeXml = `<?xml version="1.0"?><GetMyeBaySellingResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack><ActiveList><HasMoreItems>false</HasMoreItems><ItemArray><Item><ItemID>3</ItemID><Title>Newest toy</Title><ListingDetails><StartTime>2026-08-04T12:00:00.000Z</StartTime><ViewItemURL>https://www.ebay.co.uk/itm/3</ViewItemURL></ListingDetails><SellingStatus><CurrentPrice currencyID="GBP">12.50</CurrentPrice></SellingStatus></Item><Item><ItemID>1</ItemID><Title>Older figure</Title><ListingDetails><StartTime>2026-08-02T12:00:00.000Z</StartTime><ViewItemURL>https://www.ebay.co.uk/itm/1</ViewItemURL></ListingDetails><SellingStatus><CurrentPrice currencyID="GBP">10.00</CurrentPrice></SellingStatus></Item></ItemArray></ActiveList></GetMyeBaySellingResponse>`;
  const imageXml = {
    3: `<?xml version="1.0"?><GetItemResponse><Ack>Success</Ack><Item><PictureDetails><PictureURL>https://i.ebayimg.com/newest.jpg</PictureURL></PictureDetails></Item></GetItemResponse>`,
    1: `<?xml version="1.0"?><GetItemResponse><Ack>Success</Ack><Item><PictureDetails><PictureURL>https://i.ebayimg.com/older.jpg</PictureURL></PictureDetails></Item></GetItemResponse>`,
  };
  const requests = [];
  const client = createEbayClient({
    clientId: 'client', clientSecret: 'secret', seller: 'dokkadokiltd', userToken: 'private-user-token',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (options.body.includes('<GetMyeBaySellingRequest')) return { ok: true, text: async () => activeXml };
      const id = options.body.match(/<ItemID>(\d+)<\/ItemID>/)[1];
      return { ok: true, text: async () => imageXml[id] };
    },
  });

  const items = await client.latestItems();
  assert.equal(requests.length, 3);
  assert.equal(requests[0].url, 'https://api.ebay.com/ws/api.dll');
  assert.match(requests[0].options.body, /<eBayAuthToken>private-user-token<\/eBayAuthToken>/);
  assert.equal(requests[0].options.headers['X-EBAY-API-IAF-TOKEN'], undefined);
  assert.deepEqual(items.map((item) => item.title), ['Newest toy', 'Older figure']);
  assert.deepEqual(items.map((item) => item.image), ['https://i.ebayimg.com/newest.jpg', 'https://i.ebayimg.com/older.jpg']);
  assert.equal(items[0].itemCreationDate, '2026-08-04T12:00:00.000Z');
});
