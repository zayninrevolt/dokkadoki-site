const test = require('node:test');
const assert = require('node:assert/strict');
const { syncNewsletterSubscribers, startNewsletterSync, resubscribeMembershipEmail, consumeDeletionQueue } = require('../newsletter-sync');

test('skips safely when Supabase sync is not configured', async () => {
  const result = await syncNewsletterSubscribers({ config: {}, fetchImpl: async () => { throw new Error('must not fetch'); }, pool: {} });
  assert.deepEqual(result, { skipped: true, fetched: 0, inserted: 0, removed: 0 });
});

test('paginates opted-in emails and inserts only valid unique values', async () => {
  const requests = [];
  const inserts = [];
  const pages = [
    [{ email: 'first@example.com', newsletter_opt_in: true }, { email: 'not-an-email', newsletter_opt_in: true }],
    [{ email: 'second@example.com', newsletter_opt_in: true }],
  ];
  const result = await syncNewsletterSubscribers({
    config: { supabaseUrl: 'https://project.supabase.co', supabaseSecretKey: 'server-secret' },
    pageSize: 2,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (String(url).includes("newsletter_deletion_queue")) return { ok: true, json: async () => [] };
      return { ok: true, json: async () => pages.shift() ?? [] };
    },
    pool: { query: async (sql, values) => { inserts.push({ sql, values }); return [{ affectedRows: 1 }]; } },
  });

  assert.equal(result.skipped, false);
  assert.equal(result.fetched, 3);
  assert.equal(result.inserted, 2);
  assert.equal(requests.length, 3);
  assert.equal(inserts.length, 2);
  assert.match(inserts[0].sql, /INSERT IGNORE INTO launch_list/i);
  assert.deepEqual(inserts.map((entry) => entry.values[0]), ['first@example.com', 'second@example.com']);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer server-secret');
});

test('removes opted-out member emails while preserving other launch-list entries', async () => {
  const queries = [];
  const result = await syncNewsletterSubscribers({
    config: { supabaseUrl: 'https://project.supabase.co', supabaseSecretKey: 'server-secret' },
    fetchImpl: async (url) => ({
      ok: true,
      json: async () => String(url).includes("newsletter_deletion_queue") ? [] : [
        { email: 'member-opted-in@example.com', newsletter_opt_in: true },
        { email: 'member-opted-out@example.com', newsletter_opt_in: false },
      ],
    }),
    pool: { query: async (sql, values) => { queries.push({ sql, values }); return [{ affectedRows: 1 }]; } },
  });

  assert.equal(result.inserted, 1);
  assert.equal(result.removed, 1);
  assert.match(queries[0].sql, /INSERT IGNORE INTO launch_list/i);
  assert.match(queries[1].sql, /DELETE FROM launch_list/i);
  assert.deepEqual(queries[1].values, ['member-opted-out@example.com']);
});

test('reactivates matching membership consent after a direct website subscribe', async () => {
  const requests = [];
  await resubscribeMembershipEmail({
    config: { supabaseUrl: 'https://project.supabase.co', supabaseSecretKey: 'server-secret' },
    email: 'member@example.com',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true };
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.method, 'PATCH');
  assert.match(String(requests[0].url), /member_profiles\?email=eq\.member%40example\.com/);
  assert.deepEqual(JSON.parse(requests[0].options.body), { newsletter_opt_in: true });
});

test('consumes a queued membership deletion without touching unqueued subscribers', async () => {
  const calls = [];
  const removed = await consumeDeletionQueue({
    config: { supabaseUrl: 'https://project.supabase.co', supabaseSecretKey: 'server-secret' },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (options.method === 'PATCH') return { ok: true, status: 204 };
      return { ok: true, status: 200, json: async () => [{ id: 'queue-1', email: 'deleted-member@example.com' }] };
    },
    pool: { query: async (sql, values) => { calls.push({ sql, values }); return [{ affectedRows: 1 }]; } },
  });
  assert.equal(removed, 1);
  assert.match(calls[1].sql, /DELETE FROM launch_list/i);
  assert.deepEqual(calls[1].values, ['deleted-member@example.com']);
  assert.equal(calls[2].options.method, 'PATCH');
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
