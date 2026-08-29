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
