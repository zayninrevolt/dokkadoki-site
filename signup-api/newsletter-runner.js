'use strict';

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { createEbayClient } = require('./ebay');
const { collectSiteContent, selectRecentManga, readLibrary } = require('./newsletter-content');
const { ensureNewsletterTables, saveDraft, approveEdition, sendApprovedEdition } = require('./newsletter-service');

function editionIdFor(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function subjectFor(date = new Date()) {
  return `${date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'Europe/London' })} at Dokkadoki`;
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
      const root = path.resolve(__dirname, '..');
      const draft = await buildDraft({
        pool,
        root,
        libraryPath: process.env.LIBIB_LIBRARY_PATH || '/opt/data/projects/dokkadoki-site/data/library.json',
        siteUrl: process.env.PUBLIC_SITE_URL || 'https://zayninrevolt.github.io/dokkadoki-site/',
        publicApiUrl: process.env.PUBLIC_API_URL || 'https://api.dokkadoki.co.uk',
        ebayClient: createEbayClient({
          clientId: process.env.EBAY_CLIENT_ID || '',
          clientSecret: process.env.EBAY_CLIENT_SECRET || '',
          seller: process.env.EBAY_SELLER || 'dokkadokiltd',
        }),
      });
      const previewPath = process.env.NEWSLETTER_PREVIEW_PATH || path.join(__dirname, 'newsletter-preview.html');
      fs.writeFileSync(previewPath, draft.previewHtml, { encoding: 'utf8', mode: 0o600 });
      console.log(JSON.stringify({ ok: true, action: 'drafted', editionId: draft.editionId, status: draft.status, counts: draft.counts, previewPath }));
      return;
    }
    if (command === 'approve') {
      const result = await approveEdition({ pool, editionId, confirmation });
      console.log(JSON.stringify({ ok: true, action: 'approved', ...result }));
      return;
    }
    if (command === 'send') {
      if (confirmation !== `SEND-${editionId}`) throw new Error(`Send confirmation must be SEND-${editionId}`);
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
    throw new Error('Usage: node newsletter-runner.js draft | approve YYYY-MM YYYY-MM | send YYYY-MM SEND-YYYY-MM');
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

module.exports = { buildDraft, editionIdFor, subjectFor, main };
