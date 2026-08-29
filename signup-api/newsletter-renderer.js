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

function linkedTitle(item, colour = '#42556b') {
  const title = escapeHtml(item.title || 'Untitled');
  const url = safeUrl(item.url);
  return url ? `<a href="${escapeHtml(url)}" style="color:${colour};text-decoration:none;">${title}</a>` : title;
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

function gridRows(items, columns, className, render) {
  if (!items.length) return '';
  const rows = [];
  for (let index = 0; index < items.length; index += columns) {
    const cells = [];
    for (let column = 0; column < columns; column += 1) {
      const item = items[index + column];
      const width = columns === 3 ? '33.333%' : '50%';
      cells.push(item
        ? `<td class="stack-column ${className}" width="${width}" valign="top" style="width:${width};padding:6px;">${render(item)}</td>`
        : `<td class="stack-column ${className}-empty" width="${width}" style="width:${width};padding:6px;">&nbsp;</td>`);
    }
    rows.push(`<tr>${cells.join('')}</tr>`);
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join('')}</table>`;
}

function sectionHeading(eyebrow, title, colour = '#42556b') {
  return `<tr><td style="padding:0 8px 14px;"><p style="margin:0 0 3px;color:#1f6f99;font-size:11px;line-height:1.4;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">${escapeHtml(eyebrow)}</p><h2 style="margin:0;color:${colour};font-size:24px;line-height:1.2;">${escapeHtml(title)}</h2></td></tr>`;
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
  const membershipsUrl = new URL('memberships/', safeSite).href;

  const blogs = blogPosts.slice(0, 4);
  const blogGrid = blogs.length ? gridRows(blogs, 2, 'blog-card', (post) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="height:100%;background:#f6fafd;border:1px solid #bfe3f2;border-radius:14px;"><tr><td style="padding:18px;"><p style="margin:0 0 8px;color:#1f6f99;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Story</p><h3 style="margin:0 0 8px;font-size:17px;line-height:1.3;">${linkedTitle(post)}</h3>${post.summary ? `<p style="margin:0;color:#6b7f95;font-size:14px;line-height:1.55;">${escapeHtml(post.summary)}</p>` : ''}</td></tr></table>`) : `<p style="margin:0 8px;color:#6b7f95;">No new blog posts this month.</p>`;

  const products = ebayItems.slice(0, 6);
  const ebayGrid = products.length ? gridRows(products, 3, 'ebay-product', (item) => {
    const image = safeUrl(item.image);
    const price = formatPrice(item.price, item.currency);
    return `<div class="ebay-item"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="height:100%;background:#ffffff;border:1px solid #e6edf3;border-radius:14px;"><tr><td style="padding:10px;text-align:center;">${image ? `<img src="${escapeHtml(image)}" alt="" width="160" style="display:block;width:100%;max-width:160px;height:145px;object-fit:contain;margin:0 auto 10px;border-radius:10px;background:#f7f9fb;">` : '<div style="height:145px;background:#f7f9fb;border-radius:10px;margin-bottom:10px;">&nbsp;</div>'}<h3 style="margin:0 0 7px;font-size:14px;line-height:1.35;">${linkedTitle(item)}</h3>${price ? `<p style="margin:0;color:#1f6f99;font-size:17px;font-weight:800;">${escapeHtml(price)}</p>` : ''}</td></tr></table></div>`;
  }) : `<p style="margin:0 8px;color:#6b7f95;">No eBay listings are available right now.</p>`;

  const upcoming = events.slice(0, 8);
  const eventsGrid = upcoming.length ? gridRows(upcoming, 2, 'event-card', (event) => {
    const image = safeUrl(event.image);
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="height:100%;background:#eaf6fc;border:1px solid #bfe3f2;border-radius:14px;"><tr>${image ? `<td width="118" valign="top" style="width:118px;padding:8px 0 8px 8px;"><img src="${escapeHtml(image)}" alt="" width="110" style="display:block;width:110px;height:110px;object-fit:cover;border-radius:10px;"></td>` : ''}<td style="padding:15px 16px;"><h3 style="margin:0 0 7px;font-size:16px;line-height:1.35;">${linkedTitle(event, '#42556b')}</h3>${event.date ? `<p style="margin:0 0 4px;color:#1f6f99;font-size:13px;font-weight:700;">${escapeHtml(event.date)}</p>` : ''}${event.venue ? `<p style="margin:0;color:#6b7f95;font-size:13px;line-height:1.4;">${escapeHtml(event.venue)}</p>` : ''}</td></tr></table>`;
  }) : `<p style="margin:0 8px;color:#6b7f95;">No events are scheduled in the next 30 days.</p>`;

  const mangaItems = manga.slice(0, 8).map((item) => `<tr><td style="padding:9px 0;border-bottom:1px solid #bfe3f2;"><strong style="color:#42556b;">${escapeHtml(item.title || item.series || 'Untitled')}</strong>${item.author ? `<span style="display:block;margin-top:2px;color:#6b7f95;font-size:13px;">${escapeHtml(item.author)}</span>` : ''}</td></tr>`).join('');
  const mangaBody = mangaItems || '<tr><td style="padding:4px 0;color:#6b7f95;">No newly added manga were recorded this month.</td></tr>';

  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>@media only screen and (max-width:620px){.email-shell{width:100%!important}.stack-column{display:block!important;width:100%!important;box-sizing:border-box!important}.hero-pad{padding:26px 18px!important}.section-pad{padding:24px 12px!important}.ebay-product img{height:auto!important;max-width:220px!important}.hide-mobile{display:none!important}}</style></head>
<body style="margin:0;padding:0;background:#eaf6fc;font-family:Arial,Helvetica,sans-serif;color:#42556b;line-height:1.5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#eaf6fc;"><tr><td align="center" style="padding:24px 10px;">
<table class="email-shell" role="presentation" width="680" cellpadding="0" cellspacing="0" border="0" style="width:680px;max-width:680px;background:#ffffff;border-radius:22px;overflow:hidden;box-shadow:0 8px 30px rgba(66,85,107,.16);">
<tr><td class="newsletter-hero hero-pad" align="center" style="padding:38px 32px;background:#bfe3f2;background-image:linear-gradient(135deg,#8fcbe6 0%,#bfe3f2 62%,#ffd7e0 100%);">
<img src="${escapeHtml(safeLogo)}" alt="Dokkadoki" width="176" style="display:block;width:176px;max-width:70%;height:auto;margin:0 auto 20px;">
<p style="margin:0 0 6px;color:#42556b;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Manga, coffee and community</p>
<h1 style="margin:0;color:#42556b;font-size:32px;line-height:1.15;">Your monthly Dokkadoki drop</h1>
<p style="margin:12px auto 0;max-width:500px;color:#42556b;font-size:16px;line-height:1.55;">Fresh stories, new finds and brilliant events from the world of Dokkadoki.</p>
</td></tr>
<tr><td class="section-pad" style="padding:32px 26px 20px;">${`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${sectionHeading('Read', 'Latest from the Blog')}<tr><td>${blogGrid}</td></tr></table>`}</td></tr>
<tr><td class="section-pad" style="padding:26px;background:#eaf6fc;">${`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${sectionHeading('Shop', 'Latest on eBay')}<tr><td>${ebayGrid}</td></tr></table>`}</td></tr>
<tr><td class="section-pad" style="padding:30px 26px;">${`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${sectionHeading('Save the date', 'Upcoming Events', '#42556b')}<tr><td>${eventsGrid}</td></tr></table>`}</td></tr>
<tr><td class="section-pad" style="padding:28px 32px;background:#fff2f6;border-top:1px solid #bfe3f2;border-bottom:1px solid #bfe3f2;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="54" valign="top" style="width:54px;font-size:34px;line-height:1;">📚</td><td><p style="margin:0 0 3px;color:#1f6f99;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">The shelves</p><h2 style="margin:0 0 10px;color:#42556b;font-size:23px;">Recently Added Manga</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${mangaBody}</table></td></tr></table></td></tr>
<tr><td class="section-pad" style="padding:30px 26px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#42556b;border-radius:18px;"><tr><td align="center" style="padding:30px 22px;color:#ffffff;"><p style="margin:0 0 5px;color:#bfe3f2;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">Coming soon</p><h2 style="margin:0 0 9px;color:#ffffff;font-size:25px;">Memberships are coming soon</h2><p style="margin:0 auto 18px;max-width:480px;color:#eaf6fc;">Reading passes are nearly ready. Take a peek at what will be available when the café opens.</p><a href="${escapeHtml(membershipsUrl)}" style="display:inline-block;padding:12px 21px;background:#ffffff;color:#42556b;text-decoration:none;border-radius:999px;font-weight:700;">View membership details</a></td></tr></table></td></tr>
<tr><td align="center" style="padding:20px 24px 28px;background:#f6fafd;color:#6b7f95;font-size:12px;"><p style="margin:0 0 7px;">You are receiving this because you opted in to Dokkadoki updates.</p>${safeUnsubscribe ? `<a href="${escapeHtml(safeUnsubscribe)}" style="color:#1f6f99;text-decoration:underline;">Unsubscribe</a>` : 'You can unsubscribe from any future edition.'}</td></tr>
</table></td></tr></table></body></html>`;
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
