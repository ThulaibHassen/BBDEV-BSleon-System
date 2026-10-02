import 'server-only';
import Redis from 'ioredis';

/* Cache-aside with tag invalidation.

   Redis when REDIS_URL is set (Railway, docker compose); otherwise a small
   in-process map so the app still runs with nothing but Postgres.

   Usage:
     const rows = await cached(['library', 'list:students'], 300, () => loadRows());
     await invalidate('library');      // after any write to the library

   Keys are namespaced "bswl:"; each tag keeps a set of the keys it covers. */

const PREFIX = 'bswl:';
const g = globalThis as unknown as { __bswlRedis?: Redis | null; __bswlMem?: Map<string, { v: string; exp: number }> };

export function redis(): Redis | null {
  if (g.__bswlRedis !== undefined) return g.__bswlRedis;
  const url = process.env.REDIS_URL;
  if (!url) {
    g.__bswlRedis = null;
    return null;
  }
  const r = new Redis(url, { maxRetriesPerRequest: 2, enableOfflineQueue: false, lazyConnect: false });
  r.on('error', (e) => {
    if (process.env.NODE_ENV !== 'test') console.warn('[cache] redis error:', e.message);
  });
  g.__bswlRedis = r;
  return r;
}

function mem() {
  if (!g.__bswlMem) g.__bswlMem = new Map();
  return g.__bswlMem;
}

function redisReady(r: Redis | null): r is Redis {
  return !!r && r.status === 'ready';
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const k = PREFIX + key;
  const r = redis();
  try {
    if (redisReady(r)) {
      const v = await r.get(k);
      return v == null ? undefined : (JSON.parse(v) as T);
    }
  } catch {
    /* fall through to memory */
  }
  const hit = mem().get(k);
  if (!hit) return undefined;
  if (hit.exp < Date.now()) {
    mem().delete(k);
    return undefined;
  }
  return JSON.parse(hit.v) as T;
}

export async function cacheSet(key: string, value: unknown, ttlSec: number, tags: string[] = []) {
  const k = PREFIX + key;
  const v = JSON.stringify(value ?? null);
  const r = redis();
  try {
    if (redisReady(r)) {
      const m = r.multi().set(k, v, 'EX', ttlSec);
      for (const t of tags) m.sadd(PREFIX + 'tag:' + t, k).expire(PREFIX + 'tag:' + t, Math.max(ttlSec, 3600));
      await m.exec();
      return;
    }
  } catch {
    /* fall through */
  }
  const store = mem();
  if (store.size > 2000) store.clear(); // crude bound; memory mode is the fallback only
  store.set(k, { v, exp: Date.now() + ttlSec * 1000 });
  for (const t of tags) {
    const tk = PREFIX + 'tag:' + t;
    const cur = store.get(tk);
    const keys: string[] = cur ? JSON.parse(cur.v) : [];
    if (!keys.includes(k)) keys.push(k);
    store.set(tk, { v: JSON.stringify(keys), exp: Date.now() + 86_400_000 });
  }
}

/** Drop every cached key carrying any of these tags. */
export async function invalidate(...tags: string[]) {
  const r = redis();
  for (const t of tags) {
    const tk = PREFIX + 'tag:' + t;
    try {
      if (redisReady(r)) {
        const keys = await r.smembers(tk);
        if (keys.length) await r.del(...keys);
        await r.del(tk);
      }
    } catch {
      /* ignore */
    }
    const store = mem();
    const cur = store.get(tk);
    if (cur) {
      for (const k of JSON.parse(cur.v) as string[]) store.delete(k);
      store.delete(tk);
    }
  }
}

/** Read-through helper: tags[0] doubles as the key namespace. */
export async function cached<T>(keyParts: string[], ttlSec: number, load: () => Promise<T>, tags?: string[]): Promise<T> {
  const key = keyParts.join(':');
  const hit = await cacheGet<T>(key);
  if (hit !== undefined) return hit;
  const val = await load();
  await cacheSet(key, val, ttlSec, tags ?? [keyParts[0]]);
  // hand back what a hit would: Dates as ISO strings, undefined as null —
  // so a caller never sees one shape on a miss and another on a hit
  return JSON.parse(JSON.stringify(val ?? null)) as T;
}

/* ── cache tags used across the app (one place, so writers and readers agree) ── */
export const TAG = {
  config: 'config',
  library: 'library',
  mcq: 'mcq',
  essays: 'essays',
  weights: 'weights',
  recordings: 'recordings',
  messages: 'messages',
  syllabus: 'syllabus',
  student: (id: number) => `student-${id}`,
} as const;
