'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { collectSiteContent, selectRecentManga } = require('../newsletter-content');

test('collects latest blogs and only non-cancelled events in the next 30 days', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dokkadoki-newsletter-'));
  fs.mkdirSync(path.join(root, 'content', 'blog'), { recursive: true });
  fs.mkdirSync(path.join(root, 'content', 'events', 'soon'), { recursive: true });
  fs.mkdirSync(path.join(root, 'content', 'events', 'late'), { recursive: true });
  fs.mkdirSync(path.join(root, 'content', 'events', 'cancelled'), { recursive: true });
  fs.writeFileSync(path.join(root, 'content', 'blog', 'new.md'), '---\ntitle: "New post"\ndate: 2026-08-28\ndescription: "Latest news"\n---\nBody');
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

  assert.equal(content.blogPosts.length, 1);
  assert.equal(content.blogPosts[0].url, 'https://zayninrevolt.github.io/dokkadoki-site/blog/new/');
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
