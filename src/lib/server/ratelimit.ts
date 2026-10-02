import 'server-only';
import { redis } from './cache';

/* Fixed-window limiter. Redis when available, process memory otherwise.
   Used on every sign-in endpoint and on uploads. */

const g = globalThis as unknown as { __bswlRl?: Map<string, { n: number; reset: number }> };

export async function rateLimit(key: string, limit: number, windowSec: number) {
  const k = `bswl:rl:${key}`;
  const r = redis();
  if (r && r.status === 'ready') {
    try {
      const [[, n], [, ttl0]] = (await r.multi().incr(k).ttl(k).exec()) as [[unknown, number], [unknown, number]];
      // -1 = no expiry yet (first hit, or an earlier EXPIRE was lost): set it,
      // or the key would block this caller for ever
      if (ttl0 < 0) await r.expire(k, windowSec);
      const ttl = n > limit ? (ttl0 < 0 ? windowSec : ttl0) : 0;
      return { ok: n <= limit, remaining: Math.max(0, limit - n), retryAfter: Math.max(ttl, 0) };
    } catch {
      /* fall through */
    }
  }
  g.__bswlRl ??= new Map();
  const now = Date.now();
  if (g.__bswlRl.size > 10_000) {
    // one key per IP / email: drop the finished windows so memory stays flat
    for (const [key, v] of g.__bswlRl) if (v.reset < now) g.__bswlRl.delete(key);
  }
  const cur = g.__bswlRl.get(k);
  if (!cur || cur.reset < now) {
    g.__bswlRl.set(k, { n: 1, reset: now + windowSec * 1000 });
    return { ok: true, remaining: limit - 1, retryAfter: 0 };
  }
  cur.n++;
  return { ok: cur.n <= limit, remaining: Math.max(0, limit - cur.n), retryAfter: Math.ceil((cur.reset - now) / 1000) };
}

export function clientIp(req: Request) {
  const h = req.headers;
  return (h.get('x-forwarded-for')?.split(',')[0] || h.get('x-real-ip') || 'local').trim();
}
