'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchLatestEbayItems } = require('../ebay');

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
