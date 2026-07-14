/*
 * Dokkadoki site API: newsletter signups + manga requests.
 *
 * POST /api/subscribe      {"email": "..."}  →  {"ok": true}
 * POST /api/request-manga  {"title": "..."}  →  {"ok": true, "title": "...", "count": N, "matched": bool}
 * GET  /api/requests?limit=10                →  {"ok": true, "requests": [{"title": "...", "count": N}]}
 * GET  /api/health                           →  {"ok": true, "db": true}
 *
 * Config via env vars: DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME, PORT.
 * Creates its own tables on startup, so MariaDB just needs the database
 * and a user with rights on it.
 *
 * Manga requests are de-duplicated fuzzily: titles are normalized (case,
 * punctuation, accents, noise words like "manga"/"vol 3"), then matched
 * against existing rows by edit distance and word-subset, so "one peice"
 * and "One Piece manga" count toward the same series.
 */
const http = require('http');
const mysql = require('mysql2/promise');

const PORT = parseInt(process.env.PORT || '3001', 10);

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'dokkadoki',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'dokkadoki',
  connectionLimit: 4,
});

async function ensureTables() {
  await pool.query(`CREATE TABLE IF NOT EXISTS launch_list (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(254) NOT NULL UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS manga_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(160) NOT NULL,
    title_normalized VARCHAR(160) NOT NULL,
    month CHAR(7) NOT NULL,
    request_count INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_title_month (title_normalized, month)
  ) CHARACTER SET utf8mb4`);
  // migrate a pre-month table shape if one exists
  try {
    await pool.query('SELECT month FROM manga_requests LIMIT 1');
  } catch (e) {
    if (e.code === 'ER_BAD_FIELD_ERROR') {
      await pool.query("ALTER TABLE manga_requests ADD COLUMN month CHAR(7) NOT NULL DEFAULT ''");
      await pool.query("UPDATE manga_requests SET month = DATE_FORMAT(created_at, '%Y-%m') WHERE month = ''");
      await pool.query('ALTER TABLE manga_requests DROP INDEX title_normalized');
      await pool.query('ALTER TABLE manga_requests ADD UNIQUE KEY uniq_title_month (title_normalized, month)');
      console.log('migrated manga_requests to monthly shape');
    } else { throw e; }
  }
}

function monthKey(offset) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + (offset || 0));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/* ---- fuzzy title matching ---- */

const NOISE_WORDS = new Set(['the', 'a', 'an', 'manga', 'series']);

function normalizeTitle(raw) {
  let s = raw.toLowerCase().normalize('NFKD').replace(/[\̀-\ͯ]/g, '');
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();
  let tokens = s.split(/\s+/).filter(Boolean);
  // drop "vol 3" / "volume 12" style suffixes
  tokens = tokens.filter((t, i, arr) => {
    if (t === 'vol' || t === 'volume') return false;
    if (/^\d+$/.test(t) && (arr[i - 1] === 'vol' || arr[i - 1] === 'volume')) return false;
    return true;
  });
  const kept = tokens.filter((t) => !NOISE_WORDS.has(t));
  return (kept.length ? kept : tokens).join(' ').slice(0, 160);
}

function levenshtein(a, b) {
  // optimal string alignment: like Levenshtein but adjacent-letter swaps cost 1
  if (a === b) return 0;
  let prev2 = null;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
      }
    }
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

function sameSeries(a, b) {
  if (a === b) return true;
  // typo tolerance: allow ~1 edit per 4 characters
  const tolerance = Math.max(1, Math.floor(Math.min(a.length, b.length) / 4));
  if (Math.abs(a.length - b.length) <= tolerance && levenshtein(a, b) <= tolerance) return true;
  // missing-word tolerance: every word of the shorter appears in the longer
  const ta = a.split(' ');
  const tb = b.split(' ');
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.length > 0 && short.every((t) => long.includes(t));
}

/* naive per-IP, per-endpoint rate limit */
const attempts = new Map();
function rateLimited(ip, bucket, max) {
  const key = bucket + ':' + ip;
  const now = Date.now();
  const windowStart = now - 60 * 60 * 1000;
  const list = (attempts.get(key) || []).filter((t) => t > windowStart);
  if (list.length >= max) return true;
  list.push(now);
  attempts.set(key, list);
  if (attempts.size > 10000) attempts.clear(); // crude memory cap
  return false;
}

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req, cb) {
  let raw = '';
  req.on('data', (c) => { raw += c; if (raw.length > 4096) req.destroy(); });
  req.on('end', () => {
    try { cb(null, JSON.parse(raw || '{}')); } catch { cb(new Error('bad json')); }
  });
}

function clientIp(req) {
  return (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
    .toString().split(',')[0].trim();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'GET' && (path === '/api/health' || path === '/health')) {
    try {
      await pool.query('SELECT 1');
      return send(res, 200, { ok: true, db: true });
    } catch (e) {
      return send(res, 500, { ok: false, db: false });
    }
  }

  if (req.method === 'GET' && path === '/api/requests') {
    try {
      const wantPrev = url.searchParams.get('month') === 'last';
      const month = monthKey(wantPrev ? -1 : 0);
      const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || (wantPrev ? '3' : '10'), 10) || 10, 1), 20);
      const [rows] = await pool.query(
        'SELECT title, request_count FROM manga_requests WHERE month = ? ORDER BY request_count DESC, updated_at DESC LIMIT ?',
        [month, limit]);
      return send(res, 200, { ok: true, month, requests: rows.map((r) => ({ title: r.title, count: r.request_count })) });
    } catch (e) {
      console.error('DB error:', e.message);
      return send(res, 500, { ok: false, error: 'Something went wrong - please try again.' });
    }
  }

  if (req.method === 'POST' && path === '/api/request-manga') {
    if (rateLimited(clientIp(req), 'req', 10)) {
      return send(res, 429, { ok: false, error: 'Too many requests - try again later.' });
    }
    return readBody(req, async (err, body) => {
      if (err) return send(res, 400, { ok: false, error: 'Bad request.' });
      if (body.website) return send(res, 200, { ok: true, title: '', count: 1, matched: false }); // honeypot

      const title = (body.title || '').trim().replace(/\s+/g, ' ').slice(0, 160);
      const norm = normalizeTitle(title);
      if (title.length < 2 || !norm) {
        return send(res, 400, { ok: false, error: 'Give us a series name to look for!' });
      }
      try {
        const month = monthKey(0); // requests only compete within the current month
        const [rows] = await pool.query(
          'SELECT id, title, title_normalized, request_count FROM manga_requests WHERE month = ?', [month]);
        const match = rows.find((r) => sameSeries(norm, r.title_normalized));
        if (match) {
          await pool.query('UPDATE manga_requests SET request_count = request_count + 1 WHERE id = ?', [match.id]);
          return send(res, 200, { ok: true, title: match.title, count: match.request_count + 1, matched: true });
        }
        try {
          await pool.query('INSERT INTO manga_requests (title, title_normalized, month) VALUES (?, ?, ?)', [title, norm, month]);
        } catch (e) {
          if (e.code === 'ER_DUP_ENTRY') { // lost a race; count it instead
            await pool.query('UPDATE manga_requests SET request_count = request_count + 1 WHERE title_normalized = ? AND month = ?', [norm, month]);
            const [[row]] = await pool.query('SELECT title, request_count FROM manga_requests WHERE title_normalized = ? AND month = ?', [norm, month]);
            return send(res, 200, { ok: true, title: row.title, count: row.request_count, matched: true });
          }
          throw e;
        }
        return send(res, 200, { ok: true, title, count: 1, matched: false });
      } catch (e) {
        console.error('DB error:', e.message);
        return send(res, 500, { ok: false, error: 'Something went wrong - please try again.' });
      }
    });
  }

  if (req.method === 'POST' && (path === '/api/subscribe' || path === '/subscribe')) {
    if (rateLimited(clientIp(req), 'sub', 5)) {
      return send(res, 429, { ok: false, error: 'Too many attempts - try again later.' });
    }
    return readBody(req, async (err, body) => {
      if (err) return send(res, 400, { ok: false, error: 'Bad request.' });
      if (body.website) return send(res, 200, { ok: true }); // honeypot

      const email = (body.email || '').trim().toLowerCase();
      if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
        return send(res, 400, { ok: false, error: 'That doesn’t look like an email address.' });
      }
      try {
        await pool.query('INSERT IGNORE INTO launch_list (email) VALUES (?)', [email]);
        return send(res, 200, { ok: true });
      } catch (e) {
        console.error('DB error:', e.message);
        return send(res, 500, { ok: false, error: 'Something went wrong - please try again.' });
      }
    });
  }

  send(res, 404, { ok: false, error: 'Not found.' });
});

if (require.main === module) {
  ensureTables()
    .then(() => console.log('tables ready'))
    .catch((e) => console.error('Could not ensure tables (will retry on first use):', e.message));

  server.listen(PORT, () => console.log(`Dokkadoki API listening on :${PORT}`));
}

module.exports = { normalizeTitle, levenshtein, sameSeries };
