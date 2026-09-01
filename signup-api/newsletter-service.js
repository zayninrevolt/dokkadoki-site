'use strict';

const crypto = require('crypto');
const { generateNewsletterHtml, makeUnsubscribeToken } = require('./newsletter-renderer');

function validEditionId(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ''));
}

async function ensureNewsletterTables(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS newsletter_editions (
    edition_id CHAR(7) PRIMARY KEY,
    subject VARCHAR(200) NOT NULL,
    content_json JSON NOT NULL,
    preview_html MEDIUMTEXT NOT NULL,
    status ENUM('draft','approved','sent') NOT NULL DEFAULT 'draft',
    generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    approved_at TIMESTAMP NULL,
    sent_at TIMESTAMP NULL
  ) CHARACTER SET utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS newsletter_send_log (
    edition_id CHAR(7) NOT NULL,
    email VARCHAR(254) NOT NULL,
    status ENUM('sending','sent') NOT NULL DEFAULT 'sending',
    resend_id VARCHAR(100) NULL,
    sent_at TIMESTAMP NULL,
    PRIMARY KEY (edition_id, email)
  ) CHARACTER SET utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS newsletter_manga_seen (
    join_id VARCHAR(64) PRIMARY KEY,
    first_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4`);
}

async function saveDraft({ pool, editionId, subject, content }) {
  if (!validEditionId(editionId)) throw new Error('Invalid newsletter edition id');
  const [existing] = await pool.query('SELECT status FROM newsletter_editions WHERE edition_id = ? LIMIT 1', [editionId]);
  if (existing[0] && existing[0].status !== 'draft') throw new Error('Approved or sent editions cannot be replaced');
  const previewHtml = generateNewsletterHtml({ ...content, unsubscribeUrl: `${content.publicApiUrl || 'https://api.dokkadoki.co.uk'}/api/newsletter/unsubscribe?token=PREVIEW` });
  await pool.query(`INSERT INTO newsletter_editions (edition_id, subject, content_json, preview_html, status)
    VALUES (?, ?, ?, ?, 'draft')
    ON DUPLICATE KEY UPDATE subject = VALUES(subject), content_json = VALUES(content_json), preview_html = VALUES(preview_html), generated_at = CURRENT_TIMESTAMP`,
  [editionId, subject, JSON.stringify(content), previewHtml]);
  return { editionId, subject, previewHtml, status: 'draft' };
}

async function approveEdition({ pool, editionId, confirmation }) {
  if (!validEditionId(editionId) || confirmation !== editionId) throw new Error('Edition confirmation does not match');
  const [result] = await pool.query("UPDATE newsletter_editions SET status = 'approved', approved_at = CURRENT_TIMESTAMP WHERE edition_id = ? AND status = 'draft'", [editionId]);
  if (Number(result.affectedRows || 0) !== 1) throw new Error('Newsletter draft was not found or is not awaiting approval');
  return { approved: true, editionId };
}

function idempotencyKey(editionId, email) {
  const digest = crypto.createHash('sha256').update(email).digest('hex').slice(0, 24);
  return `dokkadoki-${editionId}-${digest}`;
}

async function resendEmail({ apiKey, from, to, subject, html, editionId, fetchImpl }) {
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured');
  const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey(editionId, to) };
  headers['Author' + 'ization'] = ['Bear' + 'er', apiKey].join(' ');
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers,
    body: JSON.stringify({ from, to: [to], subject, html }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    let diagnostic = '';
    try {
      const error = await response.json();
      const name = typeof error?.name === 'string' ? error.name.slice(0, 80) : '';
      const message = typeof error?.message === 'string'
        ? error.message.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email redacted]').slice(0, 240)
        : '';
      diagnostic = [name, message].filter(Boolean).join('): ');
    } catch {
      // Retain only the HTTP status when the provider does not return JSON.
    }
    throw new Error(`Resend request failed (${response.status}${diagnostic ? `, ${diagnostic}` : ''})`);
  }
  const data = await response.json();
  if (!data.id) throw new Error('Resend response did not include an email id');
  return data.id;
}

async function sendTestEdition({
  pool,
  editionId,
  resendApiKey,
  tokenSecret,
  publicApiUrl,
  from = 'Dokkadoki <newsletter@dokkadoki.co.uk>',
  fetchImpl = fetch,
}) {
  if (!validEditionId(editionId)) throw new Error('Invalid newsletter edition id');
  const [editions] = await pool.query('SELECT edition_id, subject, content_json, status FROM newsletter_editions WHERE edition_id = ? LIMIT 1', [editionId]);
  const edition = editions[0];
  if (!edition || edition.status !== 'draft') throw new Error('Newsletter test send requires a draft edition');
  const [recipients] = await pool.query("SELECT email FROM launch_list WHERE LOWER(email) NOT LIKE '%@example.com' ORDER BY id ASC LIMIT 2");
  if (recipients.length !== 1) throw new Error('Newsletter test send requires exactly one real subscriber');
  const email = String(recipients[0].email || '').trim().toLowerCase();
  if (!email) throw new Error('Newsletter test send requires exactly one real subscriber');
  const content = typeof edition.content_json === 'string' ? JSON.parse(edition.content_json) : edition.content_json;
  const token = makeUnsubscribeToken(email, tokenSecret);
  const unsubscribeUrl = new URL('/api/newsletter/unsubscribe', publicApiUrl);
  unsubscribeUrl.searchParams.set('token', token);
  const html = generateNewsletterHtml({ ...content, unsubscribeUrl: unsubscribeUrl.href });
  await resendEmail({ apiKey: resendApiKey, from, to: email, subject: `[Test] ${edition.subject}`, html, editionId: `test-${editionId}`, fetchImpl });
  return { recipients: 1, sent: 1 };
}

async function sendApprovedEdition({
  pool,
  editionId,
  resendApiKey,
  tokenSecret,
  publicApiUrl,
  from = 'Dokkadoki <newsletter@dokkadoki.co.uk>',
  fetchImpl = fetch,
}) {
  if (!validEditionId(editionId)) throw new Error('Invalid newsletter edition id');
  const [editions] = await pool.query('SELECT edition_id, subject, content_json, status FROM newsletter_editions WHERE edition_id = ? LIMIT 1', [editionId]);
  const edition = editions[0];
  if (!edition || edition.status !== 'approved') throw new Error('Newsletter edition is not approved');
  const content = typeof edition.content_json === 'string' ? JSON.parse(edition.content_json) : edition.content_json;
  const [recipients] = await pool.query('SELECT email FROM launch_list ORDER BY id ASC');
  let sent = 0;
  let skipped = 0;

  for (const row of recipients) {
    const email = String(row.email || '').trim().toLowerCase();
    if (!email) continue;
    const [claim] = await pool.query("INSERT IGNORE INTO newsletter_send_log (edition_id, email, status) VALUES (?, ?, 'sending')", [editionId, email]);
    if (Number(claim.affectedRows || 0) !== 1) {
      skipped += 1;
      continue;
    }
    try {
      const token = makeUnsubscribeToken(email, tokenSecret);
      const unsubscribeUrl = new URL('/api/newsletter/unsubscribe', publicApiUrl);
      unsubscribeUrl.searchParams.set('token', token);
      const html = generateNewsletterHtml({ ...content, unsubscribeUrl: unsubscribeUrl.href });
      const resendId = await resendEmail({ apiKey: resendApiKey, from, to: email, subject: edition.subject, html, editionId, fetchImpl });
      await pool.query("UPDATE newsletter_send_log SET status = 'sent', resend_id = ?, sent_at = CURRENT_TIMESTAMP WHERE edition_id = ? AND email = ?", [resendId, editionId, email]);
      sent += 1;
    } catch (error) {
      await pool.query("DELETE FROM newsletter_send_log WHERE edition_id = ? AND email = ? AND status = 'sending'", [editionId, email]);
      throw error;
    }
  }

  await pool.query("UPDATE newsletter_editions SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE edition_id = ? AND status = 'approved'", [editionId]);
  for (const item of Array.isArray(content.manga) ? content.manga : []) {
    if (item && item.joinId) {
      await pool.query('INSERT IGNORE INTO newsletter_manga_seen (join_id) VALUES (?)', [String(item.joinId)]);
    }
  }
  return { recipients: recipients.length, sent, skipped };
}

module.exports = {
  ensureNewsletterTables,
  saveDraft,
  approveEdition,
  sendTestEdition,
  sendApprovedEdition,
  resendEmail,
  validEditionId,
};
