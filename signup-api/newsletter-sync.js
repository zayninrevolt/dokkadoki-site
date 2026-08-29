const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function configOf(config) {
  return { supabaseUrl: String(config.supabaseUrl || '').replace(/\/+$/, ''), supabaseSecretKey: String(config.supabaseSecretKey || '') };
}
function headers(key, write = false) {
  return { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json', ...(write ? { 'Content-Type': 'application/json', Prefer: 'return=minimal' } : {}) };
}
async function supabaseJson(url, options, fetchImpl) {
  const response = await fetchImpl(url, options);
  if (!response.ok) throw new Error(`Supabase newsletter request failed (${response.status})`);
  return response.status === 204 || typeof response.json !== 'function' ? null : response.json();
}
async function consumeDeletionQueue({ config, fetchImpl = fetch, pool }) {
  const { supabaseUrl, supabaseSecretKey } = configOf(config);
  if (!supabaseUrl || !supabaseSecretKey) return 0;
  const url = new URL(`${supabaseUrl}/rest/v1/newsletter_deletion_queue`);
  url.searchParams.set('select', 'id,email'); url.searchParams.set('processed_at', 'is.null'); url.searchParams.set('order', 'created_at.asc');
  const rows = await supabaseJson(url, { headers: headers(supabaseSecretKey), signal: AbortSignal.timeout(10000) }, fetchImpl);
  let removed = 0;
  for (const row of rows) {
    const email = typeof row?.email === 'string' ? row.email.trim().toLowerCase() : '';
    if (!EMAIL_RE.test(email) || !row?.id) continue;
    const [result] = await pool.query('DELETE FROM launch_list WHERE email = ?', [email]);
    removed += Number(result?.affectedRows || 0);
    const done = new URL(`${supabaseUrl}/rest/v1/newsletter_deletion_queue`); done.searchParams.set('id', `eq.${row.id}`);
    await supabaseJson(done, { method: 'PATCH', headers: headers(supabaseSecretKey, true), body: JSON.stringify({ processed_at: new Date().toISOString() }), signal: AbortSignal.timeout(10000) }, fetchImpl);
  }
  return removed;
}
async function resubscribeMembershipEmail({ config, email, fetchImpl = fetch }) {
  const { supabaseUrl, supabaseSecretKey } = configOf(config);
  if (!supabaseUrl || !supabaseSecretKey) return { skipped: true };
  const url = new URL(`${supabaseUrl}/rest/v1/member_profiles`); url.searchParams.set('email', `eq.${email}`);
  await supabaseJson(url, { method: 'PATCH', headers: headers(supabaseSecretKey, true), body: JSON.stringify({ newsletter_opt_in: true }), signal: AbortSignal.timeout(10000) }, fetchImpl);
  return { skipped: false };
}

async function unsubscribeNewsletterEmail({ config, email, fetchImpl = fetch, pool }) {
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(normalized)) throw new Error('Invalid newsletter email');
  if (!pool?.query) throw new Error('MariaDB pool is required to unsubscribe');
  const [result] = await pool.query('DELETE FROM launch_list WHERE email = ?', [normalized]);
  const { supabaseUrl, supabaseSecretKey } = configOf(config || {});
  let membershipUpdated = false;
  if (supabaseUrl && supabaseSecretKey) {
    const url = new URL(`${supabaseUrl}/rest/v1/member_profiles`);
    url.searchParams.set('email', `eq.${normalized}`);
    await supabaseJson(url, {
      method: 'PATCH',
      headers: headers(supabaseSecretKey, true),
      body: JSON.stringify({ newsletter_opt_in: false }),
      signal: AbortSignal.timeout(10000),
    }, fetchImpl);
    membershipUpdated = true;
  }
  return { removed: Number(result?.affectedRows || 0), membershipUpdated };
}

async function syncNewsletterSubscribers({ config, fetchImpl = fetch, pool, pageSize = 500 }) {
  const { supabaseUrl, supabaseSecretKey } = configOf(config);
  if (!supabaseUrl || !supabaseSecretKey) return { skipped: true, fetched: 0, inserted: 0, removed: 0 };
  if (!pool?.query) throw new Error('MariaDB pool is required for newsletter sync');
  let removed = await consumeDeletionQueue({ config, fetchImpl, pool });
  let offset = 0, fetched = 0, inserted = 0;
  for (;;) {
    const url = new URL(`${supabaseUrl}/rest/v1/member_profiles`);
    url.searchParams.set('select', 'email,newsletter_opt_in'); url.searchParams.set('order', 'email.asc'); url.searchParams.set('limit', String(pageSize)); url.searchParams.set('offset', String(offset));
    const rows = await supabaseJson(url, { headers: headers(supabaseSecretKey), signal: AbortSignal.timeout(10000) }, fetchImpl);
    if (!Array.isArray(rows)) throw new Error('Supabase newsletter response was not an array');
    fetched += rows.length;
    for (const row of rows) { const email = typeof row?.email === 'string' ? row.email.trim().toLowerCase() : ''; if (!EMAIL_RE.test(email)) continue; if (row.newsletter_opt_in) { const [result] = await pool.query('INSERT IGNORE INTO launch_list (email) VALUES (?)', [email]); inserted += Number(result?.affectedRows || 0); } else { const [result] = await pool.query('DELETE FROM launch_list WHERE email = ?', [email]); removed += Number(result?.affectedRows || 0); } }
    if (rows.length < pageSize) break; offset += rows.length;
  }
  return { skipped: false, fetched, inserted, removed };
}
function syncIntervalMs(value) { const n = Number(value); return Number.isInteger(n) && n >= 60000 && n <= 3600000 ? n : 600000; }
async function startNewsletterSync({ config, fetchImpl, pool, intervalMs, setIntervalImpl = setInterval, log = console }) { const run = () => syncNewsletterSubscribers({ config, fetchImpl, pool }).catch((error) => { log.error?.(`Newsletter sync failed: ${error.message}`); return { skipped: false, fetched: 0, inserted: 0, removed: 0, error: true }; }); const result = await run(); if (!result.skipped) setIntervalImpl(() => { void run(); }, syncIntervalMs(intervalMs)); return result; }
module.exports = { syncNewsletterSubscribers, startNewsletterSync, syncIntervalMs, consumeDeletionQueue, resubscribeMembershipEmail, unsubscribeNewsletterEmail };
