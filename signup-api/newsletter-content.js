'use strict';

const fs = require('fs');
const path = require('path');

function parseScalar(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  return trimmed;
}

function frontMatter(file) {
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/);
  if (!match) return {};
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (field) data[field[1]] = parseScalar(field[2]);
  }
  return data;
}

function markdownFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...markdownFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== '_index.md') files.push(full);
  }
  return files;
}

function pageSlug(file, sectionRoot, data) {
  if (data.slug) return String(data.slug).replace(/^\/+|\/+$/g, '');
  const relative = path.relative(sectionRoot, file).replace(/\\/g, '/').replace(/\.md$/, '');
  return relative.endsWith('/index') ? relative.slice(0, -6) : relative;
}

function contentDate(value) {
  const text = String(value || '').trim();
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00Z` : text);
}

function decodeEntities(value) {
  return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[lower] || match;
  });
}

function textContent(value) {
  return decodeEntities(String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function tagValue(block, tag) {
  const match = String(block).match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? textContent(match[1]) : '';
}

function attributeValue(attributes, name) {
  const match = String(attributes).match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? decodeEntities(match[1] || match[2] || match[3] || '') : '';
}

function publishedUrl(value, base) {
  try {
    const url = new URL(value, base);
    return /^https?:$/.test(url.protocol) && url.origin === base.origin ? url.href : '';
  } catch {
    return '';
  }
}

async function publishedText(url, label, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { Accept: 'text/html, application/rss+xml;q=0.9' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${label} request failed (${response.status})`);
  const text = await response.text();
  if (text.length > 2_000_000) throw new Error(`${label} response is too large`);
  return text;
}

async function collectPublishedSiteContent({ siteUrl, now = new Date(), fetchImpl = globalThis.fetch }) {
  const base = new URL(siteUrl);
  const [rss, eventHtml] = await Promise.all([
    publishedText(new URL('blog/index.xml', base), 'Published blog feed', fetchImpl),
    publishedText(new URL('events/', base), 'Published events page', fetchImpl),
  ]);

  const blogPosts = [...rss.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => ({
    title: tagValue(match[1], 'title') || 'Untitled',
    summary: tagValue(match[1], 'description'),
    dateValue: new Date(tagValue(match[1], 'pubDate')),
    url: publishedUrl(tagValue(match[1], 'link'), base),
  })).filter((post) => post.url && !Number.isNaN(post.dateValue.getTime()))
    .sort((a, b) => b.dateValue - a.dateValue)
    .slice(0, 4)
    .map(({ dateValue, ...post }) => post);

  const cutoff = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const events = [];
  for (const match of eventHtml.matchAll(/<a\b([^>]*\bdata-event-start=(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attributes = match[1];
    const body = match[2];
    const start = new Date(attributeValue(attributes, 'data-event-start'));
    const status = attributeValue(attributes, 'data-event-status');
    if (Number.isNaN(start.getTime()) || start < now || start > cutoff || /EventCancelled/i.test(status)) continue;
    const title = textContent((body.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i) || [])[1]);
    const venue = textContent((body.match(/<p\b[^>]*class=(?:"event-meta"|'event-meta'|event-meta)[^>]*>([\s\S]*?)<\/p>/i) || [])[1]).replace(/^📍\s*/, '');
    const date = textContent((body.match(/<time\b[^>]*class=(?:"event-when"|'event-when'|event-when)[^>]*>([\s\S]*?)<\/time>/i) || [])[1]).replace(/^📅\s*/, '');
    const imageAttributes = (body.match(/<img\b([^>]*)>/i) || [])[1] || '';
    const url = publishedUrl(attributeValue(attributes, 'href'), base);
    if (!title || !url) continue;
    events.push({ title, venue, date, url, image: publishedUrl(attributeValue(imageAttributes, 'src'), base) });
  }

  return { blogPosts, events };
}

function eventCoverUrl(file, slug, base) {
  for (const name of ['cover.png', 'cover.jpg', 'cover.jpeg', 'cover.webp']) {
    if (fs.existsSync(path.join(path.dirname(file), name))) {
      return new URL(`events/${slug}/${name}`, base).href;
    }
  }
  return '';
}

function collectSiteContent({ root, siteUrl, now = new Date() }) {
  const base = new URL(siteUrl);
  const blogRoot = path.join(root, 'content', 'blog');
  const eventRoot = path.join(root, 'content', 'events');

  const blogPosts = markdownFiles(blogRoot).map((file) => {
    const data = frontMatter(file);
    return {
      title: data.title || 'Untitled',
      summary: data.description || '',
      archived: data.draft === true || data.archived === true,
      dateValue: contentDate(data.date || '1970-01-01'),
      url: new URL(`blog/${pageSlug(file, blogRoot, data)}/`, base).href,
    };
  }).filter((post) => !post.archived && !Number.isNaN(post.dateValue.getTime()))
    .sort((a, b) => b.dateValue - a.dateValue)
    .slice(0, 4)
    .map(({ dateValue, archived, ...post }) => post);

  const cutoff = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const events = markdownFiles(eventRoot).map((file) => {
    const data = frontMatter(file);
    const start = new Date(data.event_start || data.date || '');
    const slug = pageSlug(file, eventRoot, data);
    return {
      title: data.title || 'Untitled',
      venue: data.location || '',
      start,
      cancelled: data.draft === true || /^cancelled\b/i.test(data.title || '') || /cancelled/i.test(data.description || ''),
      url: new URL(`events/${slug}/`, base).href,
      image: eventCoverUrl(file, slug, base),
    };
  }).filter((event) => !event.cancelled && !Number.isNaN(event.start.getTime()) && event.start >= now && event.start <= cutoff)
    .sort((a, b) => a.start - b.start)
    .map(({ start, cancelled, ...event }) => ({
      ...event,
      date: start.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' }),
    }));

  return { blogPosts, events };
}

function parseLibibItems(html) {
  const source = String(html || '');
  const starts = [...source.matchAll(/<div\b[^>]*class="[^"]*\bitem\b[^"]*"[^>]*data-join-id="([^"]+)"[^>]*>/gi)];
  return starts.map((match, index) => {
    const block = source.slice(match.index, starts[index + 1]?.index ?? source.length);
    const field = (name) => textContent((block.match(new RegExp(`<div\\b[^>]*class="[^"]*\\b${name}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/div>`, 'i')) || [])[1]);
    const imageAttributes = (block.match(/<img\b([^>]*)>/i) || [])[1] || '';
    return {
      join_id: decodeEntities(match[1]),
      series: field('item-group'),
      title: field('item-title'),
      author: field('item-author'),
      cover: attributeValue(imageAttributes, 'src'),
    };
  }).filter((item) => item.join_id && item.title);
}

async function fetchPublishedLibrary({ fetchImpl = globalThis.fetch, baseUrl = 'https://www.libib.com/u/dokkadoki' } = {}) {
  const response = await fetchImpl(baseUrl, {
    headers: { Accept: 'text/html' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Published Libib page request failed (${response.status})`);
  const page = await response.text();
  if (page.length > 2_000_000) throw new Error('Published Libib page response is too large');
  const cookieHeader = response.headers?.get?.('set-cookie') || '';
  const session = cookieHeader.match(/PHPSESSID=([^;]+)/i)?.[1];
  if (!session) throw new Error('Published Libib page did not provide a session');
  const libraryIds = [...new Set([...page.matchAll(/data-library-id="(\d+)"/gi)].map((match) => match[1]))];
  if (!libraryIds.length) throw new Error('Published Libib page did not expose any libraries');

  const items = [];
  const seen = new Set();
  for (const libraryId of libraryIds) {
    for (let offset = 0; offset < 25_000; offset += 50) {
      const body = new URLSearchParams({ library_id: libraryId, offset: String(offset), prev_letter_break: '', active_letter: 'ALL' }).toString();
      const batchResponse = await fetchImpl(`${baseUrl}/get-account-items`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          Origin: new URL(baseUrl).origin,
          Referer: baseUrl,
          Cookie: `PHPSESSID=${session}`,
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      if (!batchResponse.ok) throw new Error(`Published Libib catalogue request failed (${batchResponse.status})`);
      const data = await batchResponse.json();
      if (data?.outcome !== 'success') throw new Error('Published Libib catalogue returned an unsuccessful outcome');
      const batch = parseLibibItems(data['item-info']);
      for (const item of batch) {
        if (!seen.has(item.join_id)) {
          seen.add(item.join_id);
          items.push(item);
        }
      }
      if (data.empty_set_of_items || batch.length === 0) break;
    }
  }
  if (!items.length) throw new Error('Published Libib catalogue returned no items');
  return items;
}

function selectRecentManga(items, seenIds, limit = 8) {
  const seen = seenIds instanceof Set ? seenIds : new Set(seenIds || []);
  return (Array.isArray(items) ? items : [])
    .filter((item) => item && item.join_id && !seen.has(String(item.join_id)))
    .slice(0, limit)
    .map((item) => ({
      joinId: String(item.join_id),
      title: item.title || item.series || 'Untitled',
      author: item.author || '',
      image: item.cover || '',
    }));
}

function readLibrary(libraryPath) {
  try {
    const data = JSON.parse(fs.readFileSync(libraryPath, 'utf8'));
    return Array.isArray(data.items) ? data.items : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

module.exports = { collectSiteContent, collectPublishedSiteContent, fetchPublishedLibrary, selectRecentManga, readLibrary, frontMatter };
