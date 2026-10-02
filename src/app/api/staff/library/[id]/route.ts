import { handle, body, paramId } from '@/lib/server/api';
import { requireStaff, HttpError } from '@/lib/server/auth';
import { logActivity } from '@/lib/server/audit';
import { DocMeta, update, replaceFile, remove } from '@/server/documents';

/* One document: edit its details / publish (PATCH), swap the PDF (PUT,
   multipart "file"), or delete it and its bytes in the bucket (DELETE). */

export const PATCH = handle<{ id: string }>(async (req, ctx) => {
  const p = await requireStaff('library.manage');
  const id = await paramId(ctx);
  const meta = await body(req, DocMeta);
  const row = await update(id, meta);
  if (meta.published !== undefined) await logActivity(p.id, meta.published ? 'PDF published' : 'PDF unpublished', row.title);
  return row;
});

export const PUT = handle<{ id: string }>(async (req, ctx) => {
  const p = await requireStaff('library.manage');
  const id = await paramId(ctx);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, 'Expected a file upload.', 'invalid');
  }
  const out = await replaceFile(id, form.get('file'));
  await logActivity(p.id, 'PDF replaced', `#${id}`);
  return out;
});

export const DELETE = handle<{ id: string }>(async (_req, ctx) => {
  const p = await requireStaff('library.manage');
  const row = await remove(await paramId(ctx));
  await logActivity(p.id, 'PDF deleted', row.title);
  return { ok: true };
});
