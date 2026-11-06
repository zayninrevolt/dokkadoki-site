'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { monthKey, tokenHash } = require('../manga-ranking');

// Synthetic, in-memory rankings only. Never load production env or contact a DB.
async function createReviewFixture() {
  const filename = path.resolve(__dirname, '../server.js');
  const load = createRequire(filename);
  const token = 'fixture-manga-review-'.repeat(4);
  const rankings = [{ title: 'Fixture & <Manga>', count: 3 }];
  const state = { status: 'pending', updates: 0, queries: 0 };
  const pool = {
    async query(sql, values) {
      state.queries++;
      if (sql.startsWith('SELECT month, rankings_json FROM manga_monthly_results')) {
        return [state.status === 'pending' && values[0] === tokenHash(token)
          ? [{ month: monthKey(new Date(), -1), rankings_json: JSON.stringify(rankings) }] : []];
      }
      if (sql.startsWith('UPDATE manga_monthly_results SET status = ?')) {
        const updated = state.status === 'pending' && values[1] === tokenHash(token);
        if (updated) { state.status = values[0]; state.updates++; }
        return [{ affectedRows: updated ? 1 : 0 }];
      }
      if (sql.startsWith('SELECT rankings_json FROM manga_monthly_results')) {
        return [state.status === 'approved' ? [{ rankings_json: JSON.stringify(rankings) }] : []];
      }
      throw new Error('Unexpected fixture database query');
    },
  };
  const sandbox = {
    require: (name) => name === 'mysql2/promise' ? { createPool: () => pool }
      : name === './env-loader' ? { loadEnvFile() {} } : load(name),
    module: { exports: {} }, __dirname: path.dirname(filename),
    process: { env: { ALLOWED_ORIGINS: 'https://dokkadoki.co.uk' } },
    console: { log() {}, error() {} }, URL, Buffer, AbortSignal,
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\nmodule.exports.fixtureServer = server;', sandbox, { filename });
  const server = sandbox.module.exports.fixtureServer;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`, token, rankings, state,
    reviewPath: `/api/manga-results/review?token=${encodeURIComponent(token)}`,
    async close() { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); },
  };
}

module.exports = { createReviewFixture };
