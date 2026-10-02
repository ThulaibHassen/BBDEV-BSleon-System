import { eq } from 'drizzle-orm';
import { db, schema } from '@/lib/server/db';
import { checkTicket } from '@/lib/server/tickets';
import { getObject, objectSize, parseRange } from '@/lib/server/storage';

/* The document gatekeeper (was get.php).

   Serves one PDF from the private "documents" bucket, and only against a
   ticket minted in the last 120 s by lib/server/library.grant(). It checks the
   signature and the clock — the decision about WHO may read WHAT was already
   taken, and logged, when the ticket was issued.

   Every failure is the same 403 "Not available." so a prober learns nothing.
   Byte ranges are supported because iPhone Safari asks for the tail first. */

const refuse = () =>
  new Response('Not available.\n', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return refuse();
  const url = new URL(req.url);
  if (!checkTicket(id, url.searchParams)) return refuse();

  const [doc] = await db()
    .select({ key: schema.documents.storageKey, title: schema.documents.title, name: schema.documents.originalName })
    .from(schema.documents)
    .where(eq(schema.documents.id, id))
    .limit(1);
  if (!doc) return refuse();

  const size = await objectSize('documents', doc.key);
  if (size == null) return refuse();
  const range = parseRange(req.headers.get('range'), size);
  if (range === 'bad') {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }

  const obj = await getObject('documents', doc.key, range ?? undefined);
  const filename = (doc.title || 'document').replace(/[^\w .()-]+/g, '').slice(0, 80) + '.pdf';
  const headers: Record<string, string> = {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${filename}"`,
    'Content-Length': String(obj.contentLength),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store, max-age=0',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
  };
  if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
  return new Response(obj.body, { status: range ? 206 : 200, headers });
}
