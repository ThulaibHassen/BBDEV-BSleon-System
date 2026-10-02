import 'server-only';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '@/db/schema';
import { env } from './env';

/* One pool per server process. In dev, Next reloads modules on every edit,
   so the pool is parked on globalThis to stop connection leaks. */

type DB = NodePgDatabase<typeof schema>;
const g = globalThis as unknown as { __bswlPool?: Pool; __bswlDb?: DB };

function makePool() {
  const url = env().DATABASE_URL;
  // Railway's internal network needs no TLS; its public proxy URL does.
  const needsSsl = /sslmode=require/.test(url) || /\.proxy\.rlwy\.net/.test(url);
  return new Pool({
    connectionString: url,
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });
}

export function pool(): Pool {
  if (!g.__bswlPool) g.__bswlPool = makePool();
  return g.__bswlPool;
}

export function db(): DB {
  if (!g.__bswlDb) g.__bswlDb = drizzle(pool(), { schema });
  return g.__bswlDb;
}

export { schema };
