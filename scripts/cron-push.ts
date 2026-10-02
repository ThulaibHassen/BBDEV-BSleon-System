/* Hourly tick for phone reminders and scheduled messages.

   Run by a Railway cron service at "30 * * * *" (UTC) = :00 Asia/Colombo.
   It does no work itself: it POSTs to the web service, which holds the
   VAPID keys and the database logic, and exits. Exit code 1 on failure so
   Railway marks the run as failed.

   Env: APP_URL (the web service's public or internal URL), CRON_SECRET. */

import 'dotenv/config';

async function main() {
  const base = (process.env.APP_URL || '').replace(/\/+$/, '');
  const secret = process.env.CRON_SECRET || '';
  if (!base) throw new Error('APP_URL is not set');
  if (!secret) throw new Error('CRON_SECRET is not set');

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 60_000);
  try {
    const res = await fetch(`${base}/api/cron/tick`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cron-secret': secret },
      body: '{}',
      signal: ctl.signal,
    });
    const text = await res.text();
    console.log(`[cron-push] ${new Date().toISOString()} ${res.status} ${text.slice(0, 800)}`);
    if (!res.ok) process.exitCode = 1;
  } finally {
    clearTimeout(timer);
  }
}

main().catch((e) => {
  console.error('[cron-push] failed:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
