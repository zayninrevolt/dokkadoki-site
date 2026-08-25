const test = require('node:test');
const assert = require('node:assert/strict');
const { syncNewsletterSubscribers, startNewsletterSync } = require('../newsletter-sync');

test('skips safely when Supabase sync is not configured', async () => {
  const result = await syncNewsletterSubscribers({ config: {}, fetchImpl: async () => { throw new Error('must not fetch'); }, pool: {} });
  assert.deepEqual(result, { skipped: true, fetched: 0, inserted: 0 });
});

test('paginates opted-in emails and inserts only valid unique values', async () => {
  const requests = [];
  const inserts = [];
  const pages = [
    [{ email: 'first@example.com' }, { email: 'not-an-email' }],
    [{ email: 'second@example.com' }],
  ];
  const result = await syncNewsletterSubscribers({
    config: { supabaseUrl: 'https://project.supabase.co', supabaseSecretKey: 'server-secret' },
    pageSize: 2,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => pages.shift() ?? [] };
    },
    pool: { query: async (sql, values) => { inserts.push({ sql, values }); return [{ affectedRows: 1 }]; } },
  });

  assert.equal(result.skipped, false);
  assert.equal(result.fetched, 3);
  assert.equal(result.inserted, 2);
  assert.equal(requests.length, 2);
  assert.equal(inserts.length, 2);
  assert.match(inserts[0].sql, /INSERT IGNORE INTO launch_list/i);
  assert.deepEqual(inserts.map((entry) => entry.values[0]), ['first@example.com', 'second@example.com']);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer server-secret');
});

test('runs once at startup and schedules later syncs', async () => {
  let scheduled;
  const result = await startNewsletterSync({
    config: { supabaseUrl: 'https://project.supabase.co', supabaseSecretKey: 'server-secret' },
    fetchImpl: async () => ({ ok: true, json: async () => [] }),
    pool: { query: async () => [{ affectedRows: 0 }] },
    intervalMs: 600_000,
    setIntervalImpl: (fn, ms) => { scheduled = { fn, ms }; return 1; },
    log: () => {},
  });
  assert.equal(result.skipped, false);
  assert.equal(scheduled.ms, 600_000);
});
