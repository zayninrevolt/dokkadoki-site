const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function supabaseConfig(config) {
  const supabaseUrl = String(config.supabaseUrl || '').replace(/\/+$/, '');
  const supabaseSecretKey = String(config.supabaseSecretKey || '');
  return { supabaseUrl, supabaseSecretKey };
}

function membershipProfilesUrl(supabaseUrl) {
  return new URL(`${supabaseUrl}/rest/v1/member_profiles`);
}

async function resubscribeMembershipEmail({ config, email, fetchImpl = fetch }) {
  const { supabaseUrl, supabaseSecretKey } = supabaseConfig(config);
  if (!supabaseUrl || !supabaseSecretKey) return { skipped: true };

  const url = membershipProfilesUrl(supabaseUrl);
  url.searchParams.set('email', `eq.${email}`);
  const response = await fetchImpl(url, {
    method: 'PATCH',
    headers: {
      apikey: supabaseSecretKey,
      Authorization: `Bearer ${supabaseSecretKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ newsletter_opt_in: true }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Supabase newsletter resubscribe failed (${response.status})`);
  return { skipped: false };
}

/**
 * Reconcile membership newsletter consent into the local launch list. Direct
 * website-only subscribers are absent from member_profiles and are untouched.
 */
async function syncNewsletterSubscribers({ config, fetchImpl = fetch, pool, pageSize = 500 }) {
  const { supabaseUrl, supabaseSecretKey } = supabaseConfig(config);
  if (!supabaseUrl || !supabaseSecretKey) {
    return { skipped: true, fetched: 0, inserted: 0, removed: 0 };
  }
  if (!pool || typeof pool.query !== 'function') {
    throw new Error('MariaDB pool is required for newsletter sync');
  }

  let offset = 0;
  let fetched = 0;
  let inserted = 0;
  let removed = 0;
  const seen = new Set();

  for (;;) {
    const url = membershipProfilesUrl(supabaseUrl);
    url.searchParams.set('select', 'email,newsletter_opt_in');
    url.searchParams.set('order', 'email.asc');
    url.searchParams.set('limit', String(pageSize));
    url.searchParams.set('offset', String(offset));

    const response = await fetchImpl(url, {
      headers: {
        apikey: supabaseSecretKey,
        Authorization: `Bearer ${supabaseSecretKey}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Supabase newsletter fetch failed (${response.status})`);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('Supabase newsletter response was not an array');

    fetched += rows.length;
    for (const row of rows) {
      const email = typeof row?.email === 'string' ? row.email.trim().toLowerCase() : '';
      if (!EMAIL_RE.test(email) || seen.has(email)) continue;
      seen.add(email);
      if (row.newsletter_opt_in === true) {
        const [result] = await pool.query('INSERT IGNORE INTO launch_list (email) VALUES (?)', [email]);
        inserted += Number(result?.affectedRows || 0);
      } else {
        const [result] = await pool.query('DELETE FROM launch_list WHERE email = ?', [email]);
        removed += Number(result?.affectedRows || 0);
      }
    }

    if (rows.length < pageSize) break;
    offset += rows.length;
  }

  return { skipped: false, fetched, inserted, removed };
}

function syncIntervalMs(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 60_000 && parsed <= 3_600_000 ? parsed : 600_000;
}

async function startNewsletterSync({ config, fetchImpl, pool, intervalMs, setIntervalImpl = setInterval, log = console }) {
  let running = false;
  const run = async () => {
    if (running) return { skipped: true, fetched: 0, inserted: 0, removed: 0 };
    running = true;
    try {
      const result = await syncNewsletterSubscribers({ config, fetchImpl, pool });
      if (!result.skipped) log.info?.(`Newsletter sync: ${result.fetched} member profiles, ${result.inserted} added, ${result.removed} removed`);
      return result;
    } catch (error) {
      log.error?.(`Newsletter sync failed: ${error instanceof Error ? error.message : "unknown"}`);
      return { skipped: false, fetched: 0, inserted: 0, removed: 0, error: true };
    } finally {
      running = false;
    }
  };

  const firstResult = await run();
  if (!firstResult.skipped) setIntervalImpl(() => { void run(); }, syncIntervalMs(intervalMs));
  return firstResult;
}

module.exports = { syncNewsletterSubscribers, startNewsletterSync, syncIntervalMs, resubscribeMembershipEmail };
