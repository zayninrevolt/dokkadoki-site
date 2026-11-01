'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { collectSiteContent, collectPublishedSiteContent, fetchPublishedLibrary, selectRecentManga } = require('../newsletter-content');

test('collects latest blogs and only non-cancelled events in the next 30 days', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dokkadoki-newsletter-'));
  fs.mkdirSync(path.join(root, 'content', 'blog'), { recursive: true });
  fs.mkdirSync(path.join(root, 'content', 'events', 'soon'), { recursive: true });
  fs.mkdirSync(path.join(root, 'content', 'events', 'late'), { recursive: true });
  fs.mkdirSync(path.join(root, 'content', 'events', 'cancelled'), { recursive: true });
  fs.writeFileSync(path.join(root, 'content', 'blog', 'new.md'), '---\ntitle: "New post"\ndate: 2026-08-28\ndescription: "Latest news"\n---\nBody');
  fs.writeFileSync(path.join(root, 'content', 'blog', 'timestamped.md'), '---\ntitle: "Timestamped post"\ndate: 2026-08-30T08:00:37+01:00\ndescription: "Newest news"\n---\nBody');
  fs.writeFileSync(path.join(root, 'content', 'blog', 'archived.md'), '---\ntitle: "Archived post"\ndate: 2026-08-29\ndraft: true\n---\nOld body');
  fs.writeFileSync(path.join(root, 'content', 'events', 'soon', 'index.md'), '---\ntitle: "Soon"\nevent_start: "2026-09-10T12:00:00"\nlocation: "Bury"\n---');
  fs.writeFileSync(path.join(root, 'content', 'events', 'soon', 'cover.png'), 'image marker');
  fs.writeFileSync(path.join(root, 'content', 'events', 'late', 'index.md'), '---\ntitle: "Too late"\nevent_start: "2026-10-20T12:00:00"\n---');
  fs.writeFileSync(path.join(root, 'content', 'events', 'cancelled', 'index.md'), '---\ntitle: "Cancelled - Nope"\nevent_start: "2026-09-12T12:00:00"\n---');

  const content = collectSiteContent({
    root,
    siteUrl: 'https://zayninrevolt.github.io/dokkadoki-site/',
    now: new Date('2026-08-29T00:00:00Z'),
  });

  assert.equal(content.blogPosts.length, 2);
  assert.equal(content.blogPosts[0].title, 'Timestamped post');
  assert.equal(content.blogPosts[1].url, 'https://zayninrevolt.github.io/dokkadoki-site/blog/new/');
  assert.deepEqual(content.events.map((event) => event.title), ['Soon']);
  assert.equal(content.events[0].venue, 'Bury');
  assert.equal(content.events[0].image, 'https://zayninrevolt.github.io/dokkadoki-site/events/soon/cover.png');
  assert.equal(content.blogPosts.some((post) => post.title === 'Archived post'), false);
});

test('selects only catalogue entries not present in the previous snapshot', () => {
  const items = [
    { join_id: 'old', title: 'Old manga' },
    { join_id: 'new-1', title: 'New manga 1' },
    { join_id: 'new-2', title: 'New manga 2' },
  ];
  assert.deepEqual(
    selectRecentManga(items, new Set(['old']), 8).map((item) => item.title),
    ['New manga 1', 'New manga 2']
  );
});

test('collects current blogs and upcoming events from the published site', async () => {
  const rss = `<?xml version="1.0"?><rss><channel>
    <item><title>Newest &amp; best</title><link>https://dokkadoki.co.uk/blog/newest/</link><pubDate>Fri, 23 Oct 2026 08:00:37 +0100</pubDate><description>&lt;p&gt;Fresh &amp;amp; safe&lt;/p&gt;</description></item>
    <item><title>Older post</title><link>https://dokkadoki.co.uk/blog/older/</link><pubDate>Thu, 22 Oct 2026 08:00:37 +0100</pubDate><description>Older news</description></item>
  </channel></rss>`;
  const events = `<div data-events-list><a class="card event-card" href=/events/soon/ data-event-start=2026-11-03T18:00:00Z data-event-end=2026-11-03T20:00:00Z data-event-status=https://schema.org/EventScheduled><img class=event-thumb src=/events/soon/cover.png><time class=event-when>📅 3 November 2026</time><h3>Live &amp; current</h3><p class=event-meta>📍 Bury</p></a><a class="card event-card" href=/events/late/ data-event-start=2027-01-03T18:00:00Z data-event-end=2027-01-03T20:00:00Z data-event-status=https://schema.org/EventScheduled><h3>Too late</h3></a></div>`;
  const fetchImpl = async (url) => ({
    ok: true,
    status: 200,
    text: async () => String(url).includes('/blog/') ? rss : events,
  });

  const content = await collectPublishedSiteContent({
    siteUrl: 'https://dokkadoki.co.uk/',
    now: new Date('2026-11-01T10:00:00Z'),
    fetchImpl,
  });

  assert.deepEqual(content.blogPosts.map((post) => post.title), ['Newest & best', 'Older post']);
  assert.equal(content.blogPosts[0].summary, 'Fresh & safe');
  assert.deepEqual(content.events, [{
    title: 'Live & current',
    venue: 'Bury',
    date: '3 November 2026',
    url: 'https://dokkadoki.co.uk/events/soon/',
    image: 'https://dokkadoki.co.uk/events/soon/cover.png',
  }]);
});

test('collects the live public Libib catalogue without credentials', async () => {
  const requests = [];
  const itemInfo = `<div class="item cover book " data-join-id="101"><div class="cover-wrapper"><img src="https://covers.example/one.jpg"></div><div class="item-group"><span>Series One</span></div><div class="item-title">Series One, Vol. 1</div><div class="item-author">Author One</div></div><div class="item cover book " data-join-id="102"><div class="cover-wrapper"><img src="https://covers.example/two.jpg"></div><div class="item-group"><span>Standalone</span></div><div class="item-title">Standalone</div><div class="item-author"></div></div>`;
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (!options.method) {
      return {
        ok: true,
        status: 200,
        headers: { get: (name) => name.toLowerCase() === 'set-cookie' ? 'PHPSESSID=session-value; Path=/' : null },
        text: async () => '<button data-library-id="2292257">Manga</button>',
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ outcome: 'success', 'item-info': itemInfo, empty_set_of_items: true }),
    };
  };

  const items = await fetchPublishedLibrary({ fetchImpl });

  assert.deepEqual(items, [
    { join_id: '101', series: 'Series One', title: 'Series One, Vol. 1', author: 'Author One', cover: 'https://covers.example/one.jpg' },
    { join_id: '102', series: 'Standalone', title: 'Standalone', author: '', cover: 'https://covers.example/two.jpg' },
  ]);
  assert.equal(requests.length, 2);
  assert.match(requests[1].options.headers.Cookie, /^PHPSESSID=/);
  assert.equal(requests[1].options.body.includes('library_id=2292257'), true);
});
