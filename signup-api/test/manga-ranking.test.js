'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareMonthlyResult } = require('../manga-ranking');

test('creates one pending snapshot of the previous month’s top three', async () => {
  const queries = [];
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.startsWith('SELECT month, status FROM manga_monthly_results')) return [[]];
      if (sql.startsWith('SELECT title, request_count FROM manga_requests')) {
        return [[
          { title: 'Yotsuba&!', request_count: 8 },
          { title: 'Witch Hat Atelier', request_count: 5 },
          { title: 'Frieren', request_count: 3 },
        ]];
      }
      if (sql.startsWith('INSERT INTO manga_monthly_results')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const result = await prepareMonthlyResult({
    pool,
    month: '2026-09',
    tokenFactory: () => 'a'.repeat(64),
  });

  assert.deepEqual(result, {
    created: true,
    month: '2026-09',
    status: 'pending',
    rankings: [
      { title: 'Yotsuba&!', count: 8 },
      { title: 'Witch Hat Atelier', count: 5 },
      { title: 'Frieren', count: 3 },
    ],
    token: 'a'.repeat(64),
  });
  assert.equal(queries.filter((entry) => entry.sql.startsWith('INSERT INTO manga_monthly_results')).length, 1);
});

test('approves a pending result only once with its one-time token', async () => {
  const { approveMonthlyResult, tokenHash } = require('../manga-ranking');
  const queries = [];
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      return [{ affectedRows: 1 }];
    },
  };
  const token = 'b'.repeat(64);

  const result = await approveMonthlyResult({ pool, token, decision: 'approved' });

  assert.deepEqual(result, { updated: true, status: 'approved' });
  assert.match(queries[0].sql, /WHERE approval_token_hash = \? AND status = 'pending'/);
  assert.deepEqual(queries[0].values, ['approved', tokenHash(token)]);
});
