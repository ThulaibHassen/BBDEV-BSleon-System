import { createHash, randomUUID } from 'node:crypto';
import { handle } from '@/lib/server/api';
import { requireStaff, HttpError } from '@/lib/server/auth';
import { db, schema } from '@/lib/server/db';
import { putObject, deleteObject, sniffImage, LIMITS } from '@/lib/server/storage';

/* Image upload (MCQ / quiz pictures) into the private "media" bucket.
   The browser shrinks the picture first; the server still checks the bytes
   and the cap, and hands back an /api/media/<id> URL — never a bucket URL. */

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
const PURPOSES = ['mcq', 'quiz', 'product', 'brand'];

export const POST = handle(async (req) => {
  const p = await requireStaff('media.upload');
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, 'Expected a picture upload.', 'invalid');
  }
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'Choose a picture to upload.', 'no_file');
  if (file.size > LIMITS.imageBytes) throw new HttpError(413, 'That picture is over 3 MB.', 'too_big');
  const buf = new Uint8Array(await file.arrayBuffer());
  const mime = sniffImage(buf);
  if (!mime) throw new HttpError(415, 'Use a JPEG, PNG or WebP picture.', 'not_image');
  const purpose = String(form.get('purpose') || 'mcq');
  const key = `img/${new Date().getUTCFullYear()}/${randomUUID()}.${EXT[mime]}`;
  await putObject('media', key, buf, mime);
  try {
    const [row] = await db()
      .insert(schema.media)
      .values({
        storageKey: key,
        mime,
        bytes: buf.length,
        purpose: PURPOSES.includes(purpose) ? purpose : 'mcq',
        sha256: createHash('sha256').update(buf).digest('hex'),
        createdBy: p.id,
      })
      .returning({ id: schema.media.id });
    return { id: row.id, url: `/api/media/${row.id}` };
  } catch (e) {
    // no row, so nothing could ever point at the bytes: do not leave them behind
    await deleteObject('media', key).catch(() => {});
    throw e;
  }
});
