'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { approveEdition, sendApprovedEdition, sendTestEdition, resendEmail } = require('../newsletter-service');

test('approval requires the exact edition id and only advances a draft', async () => {
  const calls = [];
  const pool = { query: async (sql, values) => {
    calls.push({ sql, values });
    return [{ affectedRows: 1 }];
  } };
  await assert.rejects(approveEdition({ pool, editionId: '2026-09', confirmation: 'wrong' }), /confirmation/i);
  const result = await approveEdition({ pool, editionId: '2026-09', confirmation: '2026-09' });
  assert.equal(result.approved, true);
  assert.match(calls[0].sql, /status = 'approved'.*status = 'draft'/i);
});

test('reports a redacted Resend validation diagnostic', async () => {
  await assert.rejects(resendEmail({
    apiKey: 'test-key',
    from: 'Dokkadoki <newsletter@dokkadoki.co.uk>',
    to: 'reader@example.com',
    subject: 'Test',
    html: '<p>Test</p>',
    editionId: '2026-09',
    fetchImpl: async () => ({
      ok: false,
      status: 422,
      json: async () => ({ name: 'validation_error', message: 'Invalid recipient reader@example.com' }),
    }),
  }), /Resend request failed \(422, validation_error\): Invalid recipient \[email redacted\]/);
});

test('send refuses an unapproved edition without calling Resend', async () => {
  const pool = { query: async () => [[{ edition_id: '2026-09', status: 'draft', subject: 'Draft', content_json: '{}' }]] };
  await assert.rejects(sendApprovedEdition({
    pool,
    editionId: '2026-09',
    resendApiKey: 'secret',
    tokenSecret: 'a'.repeat(32),
    publicApiUrl: 'https://api.example.com',
    fetchImpl: async () => { throw new Error('must not send'); },
  }), /not approved/i);
});

test('sends an approved edition once per opted-in recipient with a private unsubscribe link', async () => {
  const sent = [];
  const logs = new Set(['already@example.com']);
  const content = { siteUrl: 'https://example.com/', logoUrl: 'https://example.com/logo.png', blogPosts: [], ebayItems: [], events: [], manga: [{ joinId: 'manga-new', title: 'New manga' }] };
  const seenManga = [];
  const pool = { query: async (sql, values = []) => {
    if (/FROM newsletter_editions/i.test(sql)) return [[{ edition_id: '2026-09', status: 'approved', subject: 'September at Dokkadoki', content_json: JSON.stringify(content) }]];
    if (/FROM launch_list/i.test(sql)) {
      assert.match(sql, /LOWER\(email\) NOT LIKE '%@example\.com'/i);
      return [[{ email: 'already@example.com' }, { email: 'new@example.com' }]];
    }
    if (/INSERT IGNORE INTO newsletter_send_log/i.test(sql)) {
      const email = values[1];
      if (logs.has(email)) return [{ affectedRows: 0 }];
      logs.add(email);
      return [{ affectedRows: 1 }];
    }
    if (/INSERT IGNORE INTO newsletter_manga_seen/i.test(sql)) {
      seenManga.push(values[0]);
      return [{ affectedRows: 1 }];
    }
    return [{ affectedRows: 1 }];
  } };

  const result = await sendApprovedEdition({
    pool,
    editionId: '2026-09',
    resendApiKey: 'resend-secret',
    tokenSecret: 'a'.repeat(32),
    publicApiUrl: 'https://api.example.com',
    from: 'Dokkadoki <newsletter@dokkadoki.co.uk>',
    fetchImpl: async (url, options) => {
      sent.push({ url, options, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ id: 'email-1' }) };
    },
  });

  assert.deepEqual(result, { recipients: 2, sent: 1, skipped: 1 });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].body.to, ['new@example.com']);
  assert.match(sent[0].body.html, /api\/newsletter\/unsubscribe\?token=/);
  assert.doesNotMatch(sent[0].body.html, /new@example\.com/);
  assert.match(sent[0].options.headers['Idempotency-Key'], /^dokkadoki-2026-09-/);
  assert.deepEqual(seenManga, ['manga-new']);
});

test('test send requires exactly one real subscriber and leaves edition state unchanged', async () => {
  const sent = [];
  const content = { siteUrl: 'https://example.com/', logoUrl: 'https://example.com/logo.png', blogPosts: [], ebayItems: [], events: [], manga: [] };
  const pool = { query: async (sql) => {
    if (/FROM newsletter_editions/i.test(sql)) return [[{ edition_id: '2026-09', status: 'draft', subject: 'September at Dokkadoki', content_json: JSON.stringify(content) }]];
    if (/FROM launch_list/i.test(sql)) return [[{ email: 'reader@example.net' }]];
    throw new Error(`Unexpected query: ${sql}`);
  } };

  const result = await sendTestEdition({
    pool,
    editionId: '2026-09',
    resendApiKey: ['example', 'value'].join('-'),
    tokenSecret: 'a'.repeat(32),
    publicApiUrl: 'https://api.example.com',
    from: 'Dokkadoki <newsletter@dokkadoki.co.uk>',
    fetchImpl: async (url, options) => {
      sent.push({ url, options, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ id: 'test-email-1' }) };
    },
  });

  assert.deepEqual(result, { recipients: 1, sent: 1 });
  assert.deepEqual(sent[0].body.to, ['reader@example.net']);
  assert.match(sent[0].body.html, /api\/newsletter\/unsubscribe\?token=/);
  assert.doesNotMatch(sent[0].body.html, /reader@example\.net/);
  assert.match(sent[0].options.headers['Idempotency-Key'], /^dokkadoki-test-2026-09-/);
});

test('test send refuses zero or multiple real subscribers', async () => {
  const edition = [[{ edition_id: '2026-09', status: 'draft', subject: 'Draft', content_json: '{}' }]];
  for (const recipients of [[], [{ email: 'one@example.net' }, { email: 'two@example.net' }]]) {
    const pool = { query: async (sql) => /newsletter_editions/i.test(sql) ? edition : [recipients] };
    await assert.rejects(sendTestEdition({
      pool,
      editionId: '2026-09',
      resendApiKey: ['example', 'value'].join('-'),
      tokenSecret: 'a'.repeat(32),
      publicApiUrl: 'https://api.example.com',
      fetchImpl: async () => { throw new Error('must not send'); },
    }), /exactly one/i);
  }
});
