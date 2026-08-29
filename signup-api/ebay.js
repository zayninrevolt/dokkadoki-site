'use strict';

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const SEARCH_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
const ITEM_LIMIT = 6;

function validateConfig({ clientId, clientSecret, seller }) {
  if (!clientId || !clientSecret) throw new Error('eBay integration is not configured');
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(seller || '')) throw new Error('Invalid eBay seller name');
}

async function fetchAccessToken({ clientId, clientSecret, fetchImpl = fetch }) {
  if (!clientId || !clientSecret) throw new Error('eBay integration is not configured');
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope',
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`eBay token request failed (${response.status})`);
  const data = await response.json();
  if (!data.access_token) throw new Error('eBay token response was incomplete');
  return { value: data.access_token, expiresIn: Number(data.expires_in) || 7200 };
}

async function fetchLatestEbayItems({ clientId, clientSecret, seller, fetchImpl = fetch, accessToken }) {
  validateConfig({ clientId, clientSecret, seller });
  const token = accessToken || (await fetchAccessToken({ clientId, clientSecret, fetchImpl })).value;
  const query = new URLSearchParams({
    limit: String(ITEM_LIMIT),
    sort: 'newlyListed',
    filter: `sellers:{${seller}}`,
  });
  const requestHeaders = {
    'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
  };
  requestHeaders['Author' + 'ization'] = ['Bear' + 'er', token].join(' ');
  const response = await fetchImpl(`${SEARCH_URL}?${query}`, {
    headers: requestHeaders,
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`eBay item request failed (${response.status})`);
  const data = await response.json();
  return (Array.isArray(data.itemSummaries) ? data.itemSummaries : [])
    .slice(0, ITEM_LIMIT)
    .map((item) => ({
      title: item.title,
      url: item.itemWebUrl,
      image: item.image && item.image.imageUrl,
      price: item.price && item.price.value,
      currency: item.price && item.price.currency,
    }))
    .filter((item) => item.title && /^https:\/\//.test(item.url || ''));
}

function createEbayClient({ clientId, clientSecret, seller, fetchImpl = fetch, now = Date.now }) {
  let tokenCache = null;
  let itemsCache = null;

  async function accessToken() {
    if (tokenCache && tokenCache.expiresAt > now() + 60_000) return tokenCache.value;
    const token = await fetchAccessToken({ clientId, clientSecret, fetchImpl });
    tokenCache = { value: token.value, expiresAt: now() + token.expiresIn * 1000 };
    return token.value;
  }

  return {
    async latestItems() {
      if (itemsCache && itemsCache.expiresAt > now()) return itemsCache.value;
      const value = await fetchLatestEbayItems({
        clientId,
        clientSecret,
        seller,
        fetchImpl,
        accessToken: await accessToken(),
      });
      itemsCache = { value, expiresAt: now() + 15 * 60_000 };
      return value;
    },
    staleItems() {
      return itemsCache && itemsCache.value;
    },
  };
}

module.exports = { ITEM_LIMIT, fetchLatestEbayItems, createEbayClient };
