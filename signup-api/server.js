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
const crypto = require('crypto');
const fs = require('fs');
const pathModule = require('path');
const mysql = require('mysql2/promise');
const { startNewsletterSync, resubscribeMembershipEmail, unsubscribeNewsletterEmail } = require('./newsletter-sync');
const { createEbayClient } = require('./ebay');
const { verifyUnsubscribeToken } = require('./newsletter-renderer');
const { ensureNewsletterTables } = require('./newsletter-service');
const { loadEnvFile } = require('./env-loader');

loadEnvFile(pathModule.join(__dirname, '.env'));

const PORT = parseInt(process.env.PORT || '3001', 10);
const TRUST_PROXY = process.env.TRUST_PROXY === 'cloudflare';
const ALLOWED_ORIGINS = new Set((process.env.ALLOWED_ORIGINS || '')
  .split(',').map((v) => v.trim()).filter(Boolean));
const ebayCategories = (process.env.EBAY_CATEGORY_IDS || '').split(',').map((v) => v.trim()).filter(Boolean);
const ebayClient = createEbayClient({
  clientId: process.env.EBAY_CLIENT_ID || '',
  clientSecret: process.env.EBAY_CLIENT_SECRET || '',
  seller: process.env.EBAY_SELLER || 'dokkadokiltd',
  categoryIds: ebayCategories.length ? ebayCategories : undefined,
});

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
  await pool.query(`CREATE TABLE IF NOT EXISTS manga_request_votes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    request_id INT NOT NULL,
    voter CHAR(64) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_vote (request_id, voter)
  ) CHARACTER SET utf8mb4`);
  await ensureNewsletterTables(pool);
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


/* one vote per person per series per month: voters are stored only as a
   salted one-way hash of address + a random per-browser id - never the
   address itself. The device id means people sharing wifi (e.g. in the
   café) each get their own vote. */
let VOTE_SALT = process.env.VOTE_SALT || '';
function initializeVoteSalt() {
  if (VOTE_SALT.length >= 32) return;
  const saltFile = process.env.VOTE_SALT_FILE || pathModule.join(__dirname, '.vote-salt');
  try {
    VOTE_SALT = fs.readFileSync(saltFile, 'utf8').trim();
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    const generated = crypto.randomBytes(32).toString('hex');
    try {
      fs.writeFileSync(saltFile, generated + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      VOTE_SALT = generated;
      console.log(`Created persistent voting secret at ${saltFile}`);
    } catch (writeError) {
      if (writeError.code !== 'EEXIST') throw writeError;
      VOTE_SALT = fs.readFileSync(saltFile, 'utf8').trim();
    }
  }
  if (VOTE_SALT.length < 32) throw new Error('Voting secret must be at least 32 characters');
}
function voterHash(ip, device) {
  if (VOTE_SALT.length < 32) throw new Error('VOTE_SALT must be at least 32 characters');
  return crypto.createHash('sha256').update(ip + '|' + (device || '') + '|' + VOTE_SALT).digest('hex');
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/* ---- fuzzy title matching ---- */

const NOISE_WORDS = new Set(['the', 'a', 'an', 'manga', 'series']);

/* requests containing these (as whole words, after normalization) are
   rejected before storage. Extend as needed; legit titles that trip it
   can always be added by hand in Adminer. */
const BLOCKED_WORDS = new Set([
  'fuck', 'fucking', 'fucker', 'fuckers', 'fucked', 'motherfucker',
  'shit', 'shite', 'bullshit', 'cunt', 'cunts', 'bitch', 'bitches',
  'cock', 'cocks', 'dick', 'dicks', 'knob', 'prick', 'twat', 'twats',
  'wank', 'wanker', 'wankers', 'wanking', 'bollocks', 'piss', 'pissed',
  'arse', 'arsehole', 'ass', 'asshole', 'assholes', 'pussy', 'tits',
  'cum', 'jizz', 'slut', 'sluts', 'whore', 'whores',
  'nigger', 'niggers', 'nigga', 'niggas', 'faggot', 'faggots',
  'retard', 'retarded', 'spastic', 'paki', 'chink', 'kike', 'tranny',
  'rape', 'rapist', 'porn', 'porno',
]);
const BLOCKED_SKELETONS = new Set([...BLOCKED_WORDS].map((w) => w.replace(/[aeiou]/g, '')));
function containsBlocked(rawTitle, norm) {
  if (norm.split(' ').some((t) => BLOCKED_WORDS.has(t))) return true;
  // masked variants ("f*ck", "sh1t"): only tokens containing symbols/digits
  // get the aggressive de-masked + vowel-stripped comparison, so clean words
  // like "shot" or "assassination" can never false-positive
  return rawTitle.toLowerCase().split(/\s+/).some((tok) => {
    if (!/[^a-z]/.test(tok)) return false;
    const mapped = tok
      .replace(/@/g, 'a').replace(/[$5]/g, 's').replace(/0/g, 'o')
      .replace(/[1!|]/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/7/g, 't')
      .replace(/[^a-z]/g, '');
    if (!mapped) return false;
    return BLOCKED_WORDS.has(mapped) || BLOCKED_SKELETONS.has(mapped.replace(/[aeiou]/g, ''));
  });
}

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

function buildJsonHeaders({ corsOrigin = '', edgeCacheSeconds = 0, publicCors = false } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': edgeCacheSeconds > 0
      ? 'no-cache, max-age=0, must-revalidate'
      : 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
  if (edgeCacheSeconds > 0) {
    headers['Cloudflare-CDN-Cache-Control'] = `public, max-age=${edgeCacheSeconds}`;
  }
  if (publicCors) {
    headers['Access-Control-Allow-Origin'] = '*';
  } else if (corsOrigin) {
    headers['Access-Control-Allow-Origin'] = corsOrigin;
    headers.Vary = 'Origin';
  }
  return headers;
}

function send(res, code, body, options = {}) {
  const headers = buildJsonHeaders({ corsOrigin: res.corsOrigin, ...options });
  res.writeHead(code, headers);
  res.end(JSON.stringify(body));
}

function sendHtml(res, code, body) {
  res.writeHead(code, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
  });
  res.end(body);
}

function isJsonObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringField(body, key) {
  if (!(key in body)) return '';
  return typeof body[key] === 'string' ? body[key] : null;
}

function readBody(req, cb) {
  let raw = '';
  let finished = false;
  req.on('data', (c) => {
    if (finished) return;
    raw += c;
    if (raw.length > 4096) {
      finished = true;
      raw = '';
      cb(new Error('body too large'));
    }
  });
  req.on('end', () => {
    if (finished) return;
    finished = true;
    try {
      const body = JSON.parse(raw || '{}');
      if (!isJsonObject(body)) return cb(new Error('bad json'));
      cb(null, body);
    } catch {
      cb(new Error('bad json'));
    }
  });
}

function clientIp(req) {
  const forwarded = TRUST_PROXY ? req.headers['cf-connecting-ip'] : '';
  return (forwarded || req.socket.remoteAddress || '')
    .toString().split(',')[0].trim();
}

function requestOriginAllowed(req, res, path = '') {
  // Email clients may render the confirmation page in a sandboxed webview,
  // which submits with an opaque or mail-provider Origin. This exact route is
  // still protected by its encrypted recipient token before any state change.
  if (req.method === 'POST' && path === '/api/newsletter/unsubscribe') return true;
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin/non-browser requests do not need CORS
  let allowed = ALLOWED_ORIGINS.has(origin);
  try {
    const originHost = new URL(origin).host;
    const requestHost = String(req.headers['x-forwarded-host'] || req.headers.host || '');
    if (originHost === requestHost) allowed = true;
  } catch (_) { /* handled by the public-origin checks below */ }
  // With no explicit production allow-list, permit only localhost and RFC1918
  // origins for private-LAN testing. Public origins remain denied by default.
  if (!allowed && ALLOWED_ORIGINS.size === 0) {
    try {
      const host = new URL(origin).hostname;
      allowed = host === 'localhost' || host === '127.0.0.1' || host === '::1' ||
        /^10\./.test(host) || /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /\.local$/i.test(host);
    } catch (_) { allowed = false; }
  }
  if (!allowed) return false;
  res.corsOrigin = origin;
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (!requestOriginAllowed(req, res, path)) {
    return send(res, 403, { ok: false, error: 'Origin not allowed.' });
  }

  if (req.method === 'OPTIONS') { // CORS preflight (LAN testing hits the API cross-port)
    const headers = {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'X-Content-Type-Options': 'nosniff',
    };
    if (res.corsOrigin) {
      headers['Access-Control-Allow-Origin'] = res.corsOrigin;
      headers.Vary = 'Origin';
    }
    res.writeHead(204, headers);
    return res.end();
  }

  if (req.method === 'GET' && (path === '/api/health' || path === '/health')) {
    try {
      await pool.query('SELECT 1');
      return send(res, 200, { ok: true, db: true });
    } catch (e) {
      return send(res, 500, { ok: false, db: false });
    }
  }

  if (req.method === 'GET' && path === '/api/newsletter/unsubscribe') {
    const token = url.searchParams.get('token') || '';
    const email = verifyUnsubscribeToken(token, process.env.NEWSLETTER_TOKEN_SECRET || '');
    if (!email) return sendHtml(res, 400, '<!doctype html><title>Invalid link</title><main><h1>This unsubscribe link is invalid or incomplete.</h1></main>');
    const action = `/api/newsletter/unsubscribe?token=${encodeURIComponent(token)}`;
    return sendHtml(res, 200, `<!doctype html><title>Unsubscribe from Dokkadoki</title><main style="max-width:36rem;margin:4rem auto;padding:1rem;font-family:sans-serif;text-align:center"><h1>Leave the Dokkadoki newsletter?</h1><p>You will stop receiving future editions.</p><form method="post" action="${action}"><button type="submit" style="padding:.8rem 1.2rem">Confirm unsubscribe</button></form></main>`);
  }

  if (req.method === 'POST' && path === '/api/newsletter/unsubscribe') {
    const token = url.searchParams.get('token') || '';
    const email = verifyUnsubscribeToken(token, process.env.NEWSLETTER_TOKEN_SECRET || '');
    if (!email) return sendHtml(res, 400, '<!doctype html><title>Invalid link</title><main><h1>This unsubscribe link is invalid or incomplete.</h1></main>');
    try {
      await unsubscribeNewsletterEmail({
        config: { supabaseUrl: process.env.SUPABASE_URL, supabaseSecretKey: process.env.SUPABASE_SECRET_KEY },
        email,
        pool,
      });
      return sendHtml(res, 200, '<!doctype html><title>Unsubscribed</title><main style="max-width:36rem;margin:4rem auto;padding:1rem;font-family:sans-serif;text-align:center"><h1>You have been unsubscribed.</h1><p>You will not receive future Dokkadoki newsletters.</p></main>');
    } catch (error) {
      console.error('Newsletter unsubscribe error:', error.message);
      return sendHtml(res, 500, '<!doctype html><title>Try again</title><main><h1>We could not unsubscribe you just now. Please try again shortly.</h1></main>');
    }
  }

  if (req.method === 'GET' && path === '/api/requests') {
    // only last month's standings are public - the in-progress month is
    // never displayed, so nothing unmoderated can appear on the site
    try {
      const month = monthKey(-1);
      const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '3', 10) || 3, 1), 10);
      const [rows] = await pool.query(
        'SELECT title, request_count FROM manga_requests WHERE month = ? ORDER BY request_count DESC, updated_at DESC LIMIT ?',
        [month, limit]);
      return send(res, 200, { ok: true, month, requests: rows.map((r) => ({ title: r.title, count: r.request_count })) });
    } catch (e) {
      console.error('DB error:', e.message);
      return send(res, 500, { ok: false, error: 'Something went wrong - please try again.' });
    }
  }

  if (req.method === 'GET' && path === '/api/ebay-items') {
    try {
      return send(res, 200, { ok: true, items: await ebayClient.latestItems() }, {
        edgeCacheSeconds: 15 * 60,
        publicCors: true,
      });
    } catch (e) {
      console.error('eBay error:', e.message);
      const staleItems = ebayClient.staleItems();
      if (staleItems) {
        return send(res, 200, { ok: true, stale: true, items: staleItems });
      }
      return send(res, 503, { ok: false, error: 'Shop items are temporarily unavailable.' });
    }
  }

  if (req.method === 'POST' && path === '/api/request-manga') {
    if (rateLimited(clientIp(req), 'req', 10)) {
      return send(res, 429, { ok: false, error: 'Too many requests - try again later.' });
    }
    return readBody(req, async (err, body) => {
      if (err) return send(res, 400, { ok: false, error: 'Bad request.' });
      const website = stringField(body, 'website');
      const rawTitle = stringField(body, 'title');
      const deviceValue = stringField(body, 'device');
      if (website === null || rawTitle === null || deviceValue === null) {
        return send(res, 400, { ok: false, error: 'Bad request.' });
      }
      if (website) return send(res, 200, { ok: true, title: '', count: 1, matched: false }); // honeypot

      const title = rawTitle.trim().replace(/\s+/g, ' ').slice(0, 160);
      const norm = normalizeTitle(title);
      if (title.length < 2 || !norm) {
        return send(res, 400, { ok: false, error: 'Give us a series name to look for!' });
      }
      if (containsBlocked(title, norm)) {
        return send(res, 400, { ok: false, error: 'Let’s keep it to series we could put on the shelf! 🌸' });
      }
      try {
        const month = monthKey(0); // requests only compete within the current month
        const device = deviceValue.slice(0, 64);
        const voter = voterHash(clientIp(req), device);

        // one vote per person per series per month: only bump the count if
        // this voter hasn't already voted for this row
        async function castVote(row) {
          try {
            await pool.query('INSERT INTO manga_request_votes (request_id, voter) VALUES (?, ?)', [row.id, voter]);
          } catch (e) {
            if (e.code === 'ER_DUP_ENTRY') {
              return send(res, 200, { ok: true, title: row.title, count: row.request_count, matched: true, alreadyCounted: true });
            }
            throw e;
          }
          await pool.query('UPDATE manga_requests SET request_count = request_count + 1 WHERE id = ?', [row.id]);
          return send(res, 200, { ok: true, title: row.title, count: row.request_count + 1, matched: true });
        }

        const [rows] = await pool.query(
          'SELECT id, title, title_normalized, request_count FROM manga_requests WHERE month = ?', [month]);
        const match = rows.find((r) => sameSeries(norm, r.title_normalized));
        if (match) return castVote(match);

        try {
          const [ins] = await pool.query('INSERT INTO manga_requests (title, title_normalized, month) VALUES (?, ?, ?)', [title, norm, month]);
          await pool.query('INSERT IGNORE INTO manga_request_votes (request_id, voter) VALUES (?, ?)', [ins.insertId, voter]);
        } catch (e) {
          if (e.code === 'ER_DUP_ENTRY') { // lost a race creating the row; vote on the winner's row
            const [[row]] = await pool.query('SELECT id, title, request_count FROM manga_requests WHERE title_normalized = ? AND month = ?', [norm, month]);
            return castVote(row);
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
      const website = stringField(body, 'website');
      const emailValue = stringField(body, 'email');
      if (website === null || emailValue === null) {
        return send(res, 400, { ok: false, error: 'Bad request.' });
      }
      if (website) return send(res, 200, { ok: true }); // honeypot

      const email = emailValue.trim().toLowerCase();
      if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
        return send(res, 400, { ok: false, error: 'That doesn’t look like an email address.' });
      }
      try {
        await resubscribeMembershipEmail({
          config: {
            supabaseUrl: process.env.SUPABASE_URL,
            supabaseSecretKey: process.env.SUPABASE_SECRET_KEY,
          },
          email,
        });
        await pool.query('INSERT IGNORE INTO launch_list (email) VALUES (?)', [email]);
        return send(res, 200, { ok: true });
      } catch (e) {
        console.error('Newsletter subscribe error:', e.message);
        return send(res, 500, { ok: false, error: 'Something went wrong - please try again.' });
      }
    });
  }

  send(res, 404, { ok: false, error: 'Not found.' });
});

if (require.main === module) {
  try {
    initializeVoteSalt();
  } catch (e) {
    console.error(`Refusing to start: ${e.message}`);
    process.exit(1);
  }
  ensureTables()
    .then(async () => {
      console.log('tables ready');
      await startNewsletterSync({
        config: {
          supabaseUrl: process.env.SUPABASE_URL,
          supabaseSecretKey: process.env.SUPABASE_SECRET_KEY,
        },
        pool,
        intervalMs: process.env.NEWSLETTER_SYNC_INTERVAL_MS,
        log: console,
      });
    })
    .catch((e) => console.error('Could not ensure tables (will retry on first use):', e.message));

  server.listen(PORT, () => console.log(`Dokkadoki API listening on :${PORT}`));
}

server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.keepAliveTimeout = 5_000;

module.exports = {
  buildJsonHeaders,
  requestOriginAllowed,
  normalizeTitle,
  levenshtein,
  sameSeries,
  containsBlocked,
  isJsonObject,
  stringField,
};
