/* Apply every pending migration in ./drizzle. Safe to run on every deploy
   (Railway runs it as the pre-deploy command). */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import path from 'node:path';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const pool = new Pool({
    connectionString: url,
    ssl: /sslmode=require|\.proxy\.rlwy\.net/.test(url) ? { rejectUnauthorized: false } : undefined,
  });
  const folder = process.env.MIGRATIONS_DIR || path.resolve(process.cwd(), 'drizzle');
  console.log('[migrate] applying migrations from', folder);
  await migrate(drizzle(pool), { migrationsFolder: folder });
  console.log('[migrate] done');
  await pool.end();
}

main().catch((e) => {
  console.error('[migrate] failed:', e);
  process.exit(1);
});
