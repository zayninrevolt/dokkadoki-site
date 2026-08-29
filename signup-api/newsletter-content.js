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
      dateValue: new Date(`${data.date || '1970-01-01'}T00:00:00Z`),
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

module.exports = { collectSiteContent, selectRecentManga, readLibrary, frontMatter };
