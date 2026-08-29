'use strict';

const crypto = require('crypto');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeUrl(value, fallback = '') {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : fallback;
  } catch {
    return fallback;
  }
}

function section(title, content, emptyMessage) {
  const body = content || `<p style="margin:0;color:#625b63;">${escapeHtml(emptyMessage)}</p>`;
  return `<section style="margin:24px 0;padding:20px;background:#fff;border:1px solid #eadde1;border-radius:12px;">
<h2 style="margin:0 0 14px;color:#6d3047;font-size:22px;">${escapeHtml(title)}</h2>${body}</section>`;
}

function linkedTitle(item) {
  const title = escapeHtml(item.title || 'Untitled');
  const url = safeUrl(item.url);
  return url ? `<a href="${escapeHtml(url)}" style="color:#6d3047;">${title}</a>` : title;
}

function formatPrice(value, currency = 'GBP') {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amount);
  } catch {
    return `£${amount.toFixed(2)}`;
  }
}

function generateNewsletterHtml({
  siteUrl,
  logoUrl,
  blogPosts = [],
  ebayItems = [],
  events = [],
  manga = [],
  unsubscribeUrl,
} = {}) {
  const safeSite = safeUrl(siteUrl, 'https://zayninrevolt.github.io/dokkadoki-site/');
  const safeLogo = safeUrl(logoUrl, new URL('logo.png', safeSite).href);
  const safeUnsubscribe = safeUrl(unsubscribeUrl);

  const blogs = blogPosts.slice(0, 4).map((post) => `<article style="margin:0 0 16px;"><strong>${linkedTitle(post)}</strong>${post.summary ? `<p style="margin:4px 0 0;color:#4a4450;">${escapeHtml(post.summary)}</p>` : ''}</article>`).join('');
  const ebay = ebayItems.slice(0, 6).map((item) => {
    const image = safeUrl(item.image);
    const price = formatPrice(item.price, item.currency);
    return `<article class="ebay-item" style="margin:0 0 18px;">${image ? `<img src="${escapeHtml(image)}" alt="" width="120" style="display:block;width:120px;max-width:100%;height:auto;margin:0 0 8px;border-radius:8px;">` : ''}<strong>${linkedTitle(item)}</strong>${price ? `<p style="margin:4px 0 0;color:#4a4450;">${escapeHtml(price)}</p>` : ''}</article>`;
  }).join('');
  const upcoming = events.slice(0, 8).map((event) => `<article style="margin:0 0 16px;"><strong>${linkedTitle(event)}</strong>${event.date ? `<p style="margin:4px 0 0;color:#4a4450;">${escapeHtml(event.date)}</p>` : ''}${event.venue ? `<p style="margin:2px 0 0;color:#4a4450;">${escapeHtml(event.venue)}</p>` : ''}</article>`).join('');
  const recentManga = manga.slice(0, 8).map((item) => `<article style="margin:0 0 14px;"><strong>${escapeHtml(item.title || item.series || 'Untitled')}</strong>${item.author ? `<p style="margin:4px 0 0;color:#4a4450;">${escapeHtml(item.author)}</p>` : ''}</article>`).join('');
  const membershipsUrl = new URL('memberships/', safeSite).href;

  return `<!doctype html><html lang="en-GB"><body style="margin:0;padding:0;background:#f7f2f4;font-family:Arial,sans-serif;color:#2d2730;line-height:1.5;">
<main style="max-width:600px;margin:0 auto;padding:28px 16px;">
<header style="text-align:center;margin:0 0 28px;"><img src="${escapeHtml(safeLogo)}" alt="Dokkadoki" width="180" style="display:block;width:180px;max-width:100%;height:auto;margin:0 auto;"></header>
${section('Latest from the Blog', blogs, 'No new blog posts this month.')}
${section('Latest on eBay', ebay, 'No eBay listings are available right now.')}
${section('Upcoming Events', upcoming, 'No events are scheduled in the next 30 days.')}
${section('Recently Added Manga', recentManga, 'No newly added manga were recorded this month.')}
<section style="margin:24px 0;padding:20px;text-align:center;background:#6d3047;border-radius:12px;color:#fff;"><h2 style="margin:0 0 8px;color:#fff;font-size:22px;">Memberships are coming soon</h2><p style="margin:0 0 14px;">Our reading passes are nearly ready. See what will be available when the café opens.</p><a href="${escapeHtml(membershipsUrl)}" style="display:inline-block;padding:10px 18px;background:#fff;color:#6d3047;text-decoration:none;border-radius:999px;font-weight:bold;">View membership details</a></section>
<footer style="padding:18px 0;text-align:center;font-size:13px;color:#625b63;">${safeUnsubscribe ? `<a href="${escapeHtml(safeUnsubscribe)}" style="color:#6d3047;">Unsubscribe</a>` : 'You can unsubscribe from any future edition.'}</footer>
</main></body></html>`;
}

function encryptionKey(secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('NEWSLETTER_TOKEN_SECRET must be at least 32 characters');
  return crypto.createHash('sha256').update(secret).digest();
}

function makeUnsubscribeToken(email, secret) {
  const normalized = String(email || '').trim().toLowerCase();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, encrypted, tag].map((part) => part.toString('base64url')).join('.');
}

function verifyUnsubscribeToken(token, secret) {
  try {
    const [ivPart, encryptedPart, tagPart, extra] = String(token || '').split('.');
    if (!ivPart || !encryptedPart || !tagPart || extra) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(secret), Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(encryptedPart, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

module.exports = { generateNewsletterHtml, makeUnsubscribeToken, verifyUnsubscribeToken, safeUrl };
