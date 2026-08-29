'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  generateNewsletterHtml,
  makeUnsubscribeToken,
  verifyUnsubscribeToken,
} = require('../newsletter-renderer');

test('renders a safe reviewable newsletter with all required sections', () => {
  const html = generateNewsletterHtml({
    siteUrl: 'https://zayninrevolt.github.io/dokkadoki-site/',
    logoUrl: 'https://zayninrevolt.github.io/dokkadoki-site/logo.png',
    blogPosts: [{ title: '<Opening>', url: 'https://example.com/blog/opening/', summary: 'Hello & welcome' }],
    ebayItems: Array.from({ length: 8 }, (_, index) => ({
      title: `Listing ${index + 1}`,
      url: index === 0 ? 'javascript:alert(1)' : `https://www.ebay.co.uk/itm/${index + 1}`,
      image: `https://i.ebayimg.com/${index + 1}.jpg`,
      price: '12.50',
      currency: 'GBP',
    })),
    events: [{ title: 'Event', url: 'https://example.com/events/event/', date: '12 September 2026', venue: 'Bury' }],
    manga: [{ title: 'Yotsuba&!, Vol. 1', author: 'Kiyohiko Azuma' }],
    unsubscribeUrl: 'https://api.example.com/api/newsletter/unsubscribe?token=safe',
  });

  assert.match(html, /text-align:center/);
  assert.match(html, /Latest from the Blog/);
  assert.match(html, /Latest on eBay/);
  assert.match(html, /Upcoming Events/);
  assert.match(html, /Recently Added Manga/);
  assert.match(html, /Memberships are coming soon/);
  assert.match(html, /Unsubscribe/);
  assert.match(html, /&lt;Opening&gt;/);
  assert.doesNotMatch(html, /javascript:/i);
  assert.equal((html.match(/class="ebay-item"/g) || []).length, 6);
});

test('creates tamper-evident unsubscribe tokens without exposing the email', () => {
  const token = makeUnsubscribeToken('reader@example.com', 'a'.repeat(32));
  assert.equal(token.includes('reader@example.com'), false);
  assert.equal(verifyUnsubscribeToken(token, 'a'.repeat(32)), 'reader@example.com');
  assert.equal(verifyUnsubscribeToken(token + 'x', 'a'.repeat(32)), null);
});
