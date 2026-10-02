import { handle, query } from '@/lib/server/api';
import { requireStaff, HttpError } from '@/lib/server/auth';
import { logActivity } from '@/lib/server/audit';
import { listStaff, metaFromForm, upload } from '@/server/documents';

/* The library list (staff see everything, drafts included) and the upload. */

export const GET = handle(async (req) => {
  await requireStaff('library.manage');
  const q = query(req);
  const pub = q.get('published');
  return listStaff({
    kind: q.get('kind') || null,
    year: Number(q.get('year')) || null,
    published: pub === 'true' ? true : pub === 'false' ? false : null,
    q: q.get('q') || null,
  });
});

/** multipart: file + the metadata fields of DocMeta (strings). One file per call. */
export const POST = handle(async (req) => {
  const p = await requireStaff('library.manage');
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, 'Expected a file upload.', 'invalid');
  }
  const row = await upload(form.get('file'), metaFromForm(form), p.id);
  await logActivity(p.id, 'PDF uploaded', row.title);
  return row;
});
