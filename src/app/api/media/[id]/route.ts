import { eq } from 'drizzle-orm';
import { db, schema } from '@/lib/server/db';
import { getPrincipal } from '@/lib/server/auth';
import { getObject } from '@/lib/server/storage';
import { cached } from '@/lib/server/cache';

/* Images from the private "media" bucket (MCQ pictures, quiz pictures,
   brand). Any signed-in user of any of the three apps may fetch one — a
   question picture is not a secret, but the bucket is still not public.
   Media rows never change (new upload = new id), so the browser may cache
   the bytes for a year. */

const MISSING = Symbol('missing');

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return new Response('Not found', { status: 404 });
  const who = (await getPrincipal('staff')) ?? (await getPrincipal('student')) ?? (await getPrincipal('parent'));
  if (!who) return new Response('Sign in first', { status: 401 });

  // only a hit is cached: a miss cached for an hour would hide the picture
  // uploaded next under that id (ids are sequential, so a probe finds it)
  const row = await cached(['media', String(id)], 3600, async () => {
    const [m] = await db().select({ key: schema.media.storageKey, mime: schema.media.mime }).from(schema.media).where(eq(schema.media.id, id)).limit(1);
    if (!m) throw MISSING;
    return m;
  }).catch((e) => {
    if (e === MISSING) return null;
    throw e;
  });
  if (!row) return new Response('Not found', { status: 404 });

  // the row exists but the bytes may not (deleted by hand, wrong bucket): a 404, not a 500
  const obj = await getObject('media', row.key).catch(() => null);
  if (!obj) return new Response('Not found', { status: 404 });
  return new Response(obj.body, {
    headers: {
      'Content-Type': row.mime,
      'Content-Length': String(obj.contentLength),
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
