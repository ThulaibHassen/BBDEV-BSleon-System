import { sql } from 'drizzle-orm';
import { db } from '@/lib/server/db';
import { redis } from '@/lib/server/cache';
import { onDisk } from '@/lib/server/storage';

/* Railway health check. 200 only when Postgres answers; Redis is optional
   (the app falls back to memory), so it is reported but never fails the check. */
export async function GET() {
  const started = Date.now();
  try {
    await db().execute(sql`select 1`);
  } catch (e) {
    // a bad environment (missing or example secrets) is a config fault, not a database outage
    const msg = (e as Error)?.message ?? '';
    const body = msg.startsWith('Invalid environment') ? { ok: false, config: msg } : { ok: false, db: 'down' };
    return Response.json(body, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  const r = redis();
  return Response.json(
    {
      ok: true,
      db: 'up',
      cache: r ? r.status : 'memory',
      storage: onDisk('documents') || onDisk('media') ? 'disk' : 's3',
      ms: Date.now() - started,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
