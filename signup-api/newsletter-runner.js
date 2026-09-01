'use strict';

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { createEbayClient } = require('./ebay');
const { collectSiteContent, selectRecentManga, readLibrary } = require('./newsletter-content');
const { ensureNewsletterTables, saveDraft, approveEdition, sendTestEdition, sendApprovedEdition } = require('./newsletter-service');
const { loadEnvFile } = require('./env-loader');

loadEnvFile(path.join(__dirname, '.env'));

function editionIdFor(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function subjectFor(date = new Date()) {
  return `${date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'Europe/London' })} at Dokkadoki`;
}

function commandConfirmationMatches(command, editionId, confirmation) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(editionId || ''))) return false;
  if (command === 'approve') return confirmation === editionId;
  if (command === 'test') return confirmation === `TEST-${editionId}`;
  if (command === 'send') return confirmation === `SEND-${editionId}`;
  return false;
}

function createNewsletterEbayClient({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const categoryIds = (env.EBAY_CATEGORY_IDS || '').split(',').map((value) => value.trim()).filter(Boolean);
  return createEbayClient({
    clientId: env.EBAY_CLIENT_ID || '',
    clientSecret: env.EBAY_CLIENT_SECRET || '',
    seller: env.EBAY_SELLER || 'dokkadokiltd',
    categoryIds: categoryIds.length ? categoryIds : undefined,
    userToken: env.EBAY_USER_TOKEN || '',
    fetchImpl,
  });
}

const MAX_PREVIEW_IMAGE_BYTES = 3_200_000;


async function makePortablePreview(html, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') return html;
  const imagePattern = /(<img\b[^>]*\bsrc=["'])([^"']+)(["'])/gi;
  const urls = [...new Set([...html.matchAll(imagePattern)]
    .map((match) => match[2])
    .filter((url) => url.startsWith('https://')))];
  const embedded = new Map();

  await Promise.all(urls.map(async (url) => {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
      const contentType = response.headers.get('content-type') || '';
      const declaredBytes = Number(response.headers.get('content-length') || 0);
      if (!response.ok || !contentType.startsWith('image/') || declaredBytes > MAX_PREVIEW_IMAGE_BYTES) return;
      const image = Buffer.from(await response.arrayBuffer());
      if (image.length > MAX_PREVIEW_IMAGE_BYTES) return;
      embedded.set(url, `data:${contentType.split(';', 1)[0]};base64,${image.toString('base64')}`);
    } catch {
      // Keep the original remote URL if a preview asset cannot be fetched.
    }
  }));

  return html.replace(imagePattern, (match, prefix, url, suffix) => `${prefix}${embedded.get(url) || url}${suffix}`);
}
async function buildDraft({ pool, root, libraryPath, siteUrl, publicApiUrl, ebayClient, now = new Date() }) {
  await ensureNewsletterTables(pool);
  const siteContent = collectSiteContent({ root, siteUrl, now });
  const ebayItems = await ebayClient.latestItems();
  const libraryItems = readLibrary(libraryPath);
  const [seenRows] = await pool.query('SELECT join_id FROM newsletter_manga_seen');
  const seen = new Set(seenRows.map((row) => String(row.join_id)));
  // The first run establishes a baseline. Without a previous snapshot there is
  // no honest way to label existing catalogue entries as newly added.
  const manga = seen.size === 0 ? [] : selectRecentManga(libraryItems, seen, 8);
  const content = {
    siteUrl,
    publicApiUrl,
    logoUrl: new URL('logo.png', siteUrl).href,
    blogPosts: siteContent.blogPosts,
    ebayItems,
    events: siteContent.events,
    manga,
  };
  const editionId = editionIdFor(now);
  const draft = await saveDraft({ pool, editionId, subject: subjectFor(now), content });
  if (seen.size === 0) {
    for (const item of libraryItems) {
      if (item && item.join_id) await pool.query('INSERT IGNORE INTO newsletter_manga_seen (join_id) VALUES (?)', [String(item.join_id)]);
    }
  }
  return { ...draft, counts: { blogs: content.blogPosts.length, ebay: content.ebayItems.length, events: content.events.length, manga: content.manga.length } };
}

function createPool() {
  return mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'dokkadoki',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'dokkadoki',
    connectionLimit: 2,
  });
}

async function main(argv = process.argv.slice(2)) {
  const command = argv[0];
  const editionId = argv[1];
  const confirmation = argv[2];
  const pool = createPool();
  try {
    if (command === 'draft') {
      const root = process.env.NEWSLETTER_CONTENT_ROOT || __dirname;
      const draft = await buildDraft({
        pool,
        root,
        libraryPath: process.env.LIBIB_LIBRARY_PATH || path.join(__dirname, 'data', 'library.json'),
        siteUrl: process.env.PUBLIC_SITE_URL || 'https://dokkadoki.co.uk/',
        publicApiUrl: process.env.PUBLIC_API_URL || 'https://api.dokkadoki.co.uk',
        ebayClient: createNewsletterEbayClient(),
      });
      const previewPath = process.env.NEWSLETTER_PREVIEW_PATH || path.join(__dirname, 'newsletter-preview.html');
      fs.writeFileSync(previewPath, await makePortablePreview(draft.previewHtml), { encoding: 'utf8', mode: 0o600 });
      console.log(JSON.stringify({ ok: true, action: 'drafted', editionId: draft.editionId, status: draft.status, counts: draft.counts, previewPath }));
      return;
    }
    if (command === 'approve') {
      if (!commandConfirmationMatches(command, editionId, confirmation)) throw new Error(`Approval confirmation must be ${editionId}`);
      const result = await approveEdition({ pool, editionId, confirmation });
      console.log(JSON.stringify({ ok: true, action: 'approved', ...result }));
      return;
    }
    if (command === 'test') {
      if (!commandConfirmationMatches(command, editionId, confirmation)) throw new Error(`Test confirmation must be TEST-${editionId}`);
      const result = await sendTestEdition({
        pool,
        editionId,
        resendApiKey: process.env.RESEND_API_KEY || '',
        tokenSecret: process.env.NEWSLETTER_TOKEN_SECRET || '',
        publicApiUrl: process.env.PUBLIC_API_URL || 'https://api.dokkadoki.co.uk',
        from: process.env.NEWSLETTER_FROM || 'Dokkadoki <newsletter@dokkadoki.co.uk>',
      });
      console.log(JSON.stringify({ ok: true, action: 'test-sent', editionId, ...result }));
      return;
    }
    if (command === 'send') {
      if (!commandConfirmationMatches(command, editionId, confirmation)) throw new Error(`Send confirmation must be SEND-${editionId}`);
      const result = await sendApprovedEdition({
        pool,
        editionId,
        resendApiKey: process.env.RESEND_API_KEY || '',
        tokenSecret: process.env.NEWSLETTER_TOKEN_SECRET || '',
        publicApiUrl: process.env.PUBLIC_API_URL || 'https://api.dokkadoki.co.uk',
        from: process.env.NEWSLETTER_FROM || 'Dokkadoki <newsletter@dokkadoki.co.uk>',
      });
      console.log(JSON.stringify({ ok: true, action: 'sent', editionId, ...result }));
      return;
    }
    throw new Error('Usage: node newsletter-runner.js draft | approve YYYY-MM YYYY-MM | test YYYY-MM TEST-YYYY-MM | send YYYY-MM SEND-YYYY-MM');
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Newsletter command failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { buildDraft, editionIdFor, subjectFor, commandConfirmationMatches, createNewsletterEbayClient, makePortablePreview, main };
