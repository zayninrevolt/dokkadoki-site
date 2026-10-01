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
    blogPosts: Array.from({ length: 4 }, (_, index) => ({
      title: index === 0 ? '<Opening>' : `Blog ${index + 1}`,
      url: `https://example.com/blog/${index + 1}/`,
      summary: index === 0 ? 'Hello & welcome' : `Summary ${index + 1}`,
    })),
    ebayItems: Array.from({ length: 8 }, (_, index) => ({
      title: `Listing ${index + 1}`,
      url: index === 0 ? 'javascript:alert(1)' : `https://www.ebay.co.uk/itm/${index + 1}`,
      image: `https://i.ebayimg.com/${index + 1}.jpg`,
      price: '12.50',
      currency: 'GBP',
    })),
    events: Array.from({ length: 6 }, (_, index) => ({
      title: `Event ${index + 1}`,
      url: `https://example.com/events/${index + 1}/`,
      date: `${12 + index} September 2026`,
      venue: 'Bury',
      image: `https://example.com/events/${index + 1}/cover.png`,
    })),
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
  assert.match(html, /class="newsletter-hero(?:\s|\")/);
  assert.match(html, /@media only screen and \(max-width:620px\)/);
  assert.equal((html.match(/class="stack-column blog-card"/g) || []).length, 4);
  assert.equal((html.match(/class="stack-column ebay-product"/g) || []).length, 6);
  assert.equal((html.match(/class="stack-column event-card"/g) || []).length, 6);
  assert.match(html, /https:\/\/example\.com\/events\/1\/cover\.png/);
  assert.match(html, /#bfe3f2/i);
  assert.match(html, /#8fcbe6/i);
  assert.match(html, /#42556b/i);
  assert.match(html, /role="presentation"/);
});

test('uses equal-height desktop product and event cards with automatic mobile heights', () => {
  const html = generateNewsletterHtml({
    siteUrl: 'https://dokkadoki.co.uk/',
    ebayItems: [
      { title: 'Short', url: 'https://www.ebay.co.uk/itm/1', image: 'https://i.ebayimg.com/1.jpg', price: '5', currency: 'GBP' },
      { title: 'A much longer product title that wraps across several lines', url: 'https://www.ebay.co.uk/itm/2', image: 'https://i.ebayimg.com/2.jpg', price: '15', currency: 'GBP' },
    ],
    events: [
      { title: 'Short event', url: 'https://dokkadoki.co.uk/events/short/', date: '1 October 2026', venue: 'Bury', image: 'https://dokkadoki.co.uk/events/short/cover.png' },
      { title: 'Long event title', url: 'https://dokkadoki.co.uk/events/long/', date: '2 October 2026', venue: 'A deliberately long venue and address that wraps across several lines in the card', image: 'https://dokkadoki.co.uk/events/long/cover.png' },
    ],
  });

  assert.equal((html.match(/class="ebay-card-table"[^>]*height="330"/g) || []).length, 2);
  assert.equal((html.match(/class="event-card-table"[^>]*height="230"/g) || []).length, 2);
  assert.equal((html.match(/class="ebay-title-cell"[^>]*height="105"/g) || []).length, 2);
  assert.equal((html.match(/class="ebay-price-cell"[^>]*valign="bottom"/g) || []).length, 2);
  assert.match(html, /\.ebay-card-table,\.event-card-table,\.ebay-title-cell,\.ebay-price-cell\{height:auto!important\}/);
});

test('creates tamper-evident unsubscribe tokens without exposing the email', () => {
  const token = makeUnsubscribeToken('reader@example.com', 'a'.repeat(32));
  assert.equal(token.includes('reader@example.com'), false);
  assert.equal(verifyUnsubscribeToken(token, 'a'.repeat(32)), 'reader@example.com');
  assert.equal(verifyUnsubscribeToken(token + 'x', 'a'.repeat(32)), null);
});
