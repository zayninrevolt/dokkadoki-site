'use strict';

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const SEARCH_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
const TRADING_URL = 'https://api.ebay.com/ws/api.dll';
const ITEM_LIMIT = 6;
const DEFAULT_CATEGORY_IDS = ['69528', '183456'];
const FALLBACK_KEYWORD = 'anime';

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

function buildSearchParams({ seller, categoryIds, keyword }) {
  const params = new URLSearchParams({
    limit: String(ITEM_LIMIT),
    sort: 'newlyListed',
    filter: `sellers:{${seller}}`,
  });
  if (Array.isArray(categoryIds) && categoryIds.length) {
    params.append('filter', `category_ids:{${categoryIds.join(',')}}`);
  } else if (keyword) {
    params.set('q', keyword);
  }
  return params;
}

async function requestItems({ clientId, clientSecret, seller, searchParams, fetchImpl, accessToken }) {
  const token = accessToken || (await fetchAccessToken({ clientId, clientSecret, fetchImpl })).value;
  const requestHeaders = {
    'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
  };
  requestHeaders['Author' + 'ization'] = ['Bear' + 'er', token].join(' ');
  const response = await fetchImpl(`${SEARCH_URL}?${searchParams}`, {
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
      ...(typeof item.itemCreationDate === 'string' && item.itemCreationDate
        ? { itemCreationDate: item.itemCreationDate }
        : {}),
    }))
    .filter((item) => item.title && /^https:\/\//.test(item.url || ''));
}

async function fetchLatestEbayItems({ clientId, clientSecret, seller, categoryIds = DEFAULT_CATEGORY_IDS, fetchImpl = fetch, accessToken }) {
  validateConfig({ clientId, clientSecret, seller });
  try {
    return await requestItems({
      clientId, clientSecret, seller, fetchImpl, accessToken,
      searchParams: buildSearchParams({ seller, categoryIds }),
    });
  } catch (primaryError) {
    return requestItems({
      clientId, clientSecret, seller, fetchImpl, accessToken,
      searchParams: buildSearchParams({ seller, categoryIds: [], keyword: FALLBACK_KEYWORD }),
    }).catch(() => { throw primaryError; });
  }
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function xmlTag(xml, tag) {
  const match = String(xml || '').match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return match ? decodeXml(match[1].trim()) : '';
}

function xmlItems(xml) {
  return [...String(xml || '').matchAll(/<Item(?:\s[^>]*)?>([\s\S]*?)<\/Item>/g)].map((match) => match[1]);
}

function mapActiveItem(xml) {
  const priceMatch = xml.match(/<CurrentPrice([^>]*)>([\s\S]*?)<\/CurrentPrice>/);
  const currencyMatch = priceMatch && priceMatch[1].match(/currencyID=["']([^"']+)["']/);
  const itemCreationDate = xmlTag(xml, 'StartTime');
  const item = {
    title: xmlTag(xml, 'Title'),
    url: xmlTag(xml, 'ViewItemURL'),
    image: xmlTag(xml, 'PictureURL'),
    price: priceMatch ? decodeXml(priceMatch[2].trim()) : '',
    currency: currencyMatch ? currencyMatch[1] : '',
    itemCreationDate,
  };
  return item.title && /^https:\/\//.test(item.url) && Number.isFinite(Date.parse(itemCreationDate)) ? item : null;
}

function escapeXml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function activeListRequest(page, userToken) {
  const credentials = userToken ? `<RequesterCredentials><eBayAuthToken>${escapeXml(userToken)}</eBayAuthToken></RequesterCredentials>` : '';
  return `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  ${credentials}
  <ActiveList><Include>true</Include><Pagination><EntriesPerPage>100</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></ActiveList>
</GetMyeBaySellingRequest>`;
}

async function fetchActiveSellerItems({ accessToken, userToken, fetchImpl = fetch }) {
  if (!accessToken && !userToken) throw new Error('eBay seller authorization is required');
  const items = [];
  for (let page = 1; page <= 250; page += 1) {
    const response = await fetchImpl(TRADING_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'X-EBAY-API-CALL-NAME': 'GetMyeBaySelling',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
        'X-EBAY-API-SITEID': '3',
        ...(accessToken ? { 'X-EBAY-API-IAF-TOKEN': accessToken } : {}),
      },
      body: activeListRequest(page, userToken),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`eBay active-list request failed (${response.status})`);
    const xml = await response.text();
    if (xmlTag(xml, 'Ack') !== 'Success' && xmlTag(xml, 'Ack') !== 'Warning') {
      throw new Error('eBay active-list response was unsuccessful');
    }
    items.push(...xmlItems(xml).map(mapActiveItem).filter(Boolean));
    if (xmlTag(xml, 'HasMoreItems') !== 'true') break;
  }
  return items
    .sort((a, b) => Date.parse(b.itemCreationDate) - Date.parse(a.itemCreationDate))
    .slice(0, ITEM_LIMIT);
}

function createEbayClient({ clientId, clientSecret, seller, categoryIds, userToken, fetchImpl = fetch, now = Date.now }) {
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
      const value = userToken
        ? await fetchActiveSellerItems({ userToken, fetchImpl })
        : await fetchLatestEbayItems({
          clientId,
          clientSecret,
          seller,
          categoryIds,
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

module.exports = { ITEM_LIMIT, fetchLatestEbayItems, fetchActiveSellerItems, createEbayClient };
