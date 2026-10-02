import { randomUUID, createHash } from 'node:crypto';
import { handle } from '@/lib/server/api';
import { HttpError, requireStaff } from '@/lib/server/auth';
import { db, schema } from '@/lib/server/db';
import { LIMITS, putObject, sniffImage } from '@/lib/server/storage';

/* Brand logo upload: the bytes go to the media bucket, never into the
   config row (original rule: never base64). Returns the /api/media URL the
   Brand tab saves into the overrides. */
export const POST = handle(async (req) => {
  const p = await requireStaff('settings.manage');
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'Choose an image first.', 'invalid');
  if (file.size > LIMITS.imageBytes) throw new HttpError(413, 'That image is over 3 MB.', 'too_large');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffImage(bytes);
  if (!mime) throw new HttpError(415, 'Use a PNG, JPG or WebP image.', 'bad_type');
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  const key = `img/${new Date().getUTCFullYear()}/${randomUUID()}.${ext}`;
  await putObject('media', key, bytes, mime);
  const [m] = await db()
    .insert(schema.media)
    .values({ storageKey: key, mime, bytes: bytes.length, purpose: 'brand', sha256: createHash('sha256').update(bytes).digest('hex'), createdBy: p.id })
    .returning({ id: schema.media.id });
  return { url: `/api/media/${m.id}` };
});
