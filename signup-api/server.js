/*
 * Dokkadoki launch-list signup API.
 *
 * POST /api/subscribe  {"email": "..."}  →  {"ok": true}
 * GET  /api/health                       →  {"ok": true, "db": true}
 *
 * Config via env vars: DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME, PORT.
 * Creates its own table on startup, so MariaDB just needs the database
 * and a user with rights on it.
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

async function ensureTable() {
  await pool.query(`CREATE TABLE IF NOT EXISTS launch_list (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(254) NOT NULL UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4`);
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/* naive per-IP rate limit: 5 attempts per hour */
const attempts = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const windowStart = now - 60 * 60 * 1000;
  const list = (attempts.get(ip) || []).filter((t) => t > windowStart);
  if (list.length >= 5) return true;
  list.push(now);
  attempts.set(ip, list);
  if (attempts.size > 10000) attempts.clear(); // crude memory cap
  return false;
}

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const path = req.url.split('?')[0].replace(/\/+$/, '') || '/';

  if (req.method === 'GET' && (path === '/api/health' || path === '/health')) {
    try {
      await pool.query('SELECT 1');
      return send(res, 200, { ok: true, db: true });
    } catch (e) {
      return send(res, 500, { ok: false, db: false });
    }
  }

  if (req.method === 'POST' && (path === '/api/subscribe' || path === '/subscribe')) {
    const ip = (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
      .toString().split(',')[0].trim();
    if (rateLimited(ip)) return send(res, 429, { ok: false, error: 'Too many attempts - try again later.' });

    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 4096) req.destroy(); });
    req.on('end', async () => {
      let body;
      try { body = JSON.parse(raw || '{}'); } catch { return send(res, 400, { ok: false, error: 'Bad request.' }); }

      // honeypot: real visitors never fill this hidden field
      if (body.website) return send(res, 200, { ok: true });

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
    return;
  }

  send(res, 404, { ok: false, error: 'Not found.' });
});

ensureTable()
  .then(() => console.log('launch_list table ready'))
  .catch((e) => console.error('Could not ensure table (will retry on first insert):', e.message));

server.listen(PORT, () => console.log(`Dokkadoki signup API listening on :${PORT}`));
