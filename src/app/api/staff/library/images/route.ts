import { handle } from '@/lib/server/api';
import { requireStaff, HttpError } from '@/lib/server/auth';
import { logActivity } from '@/lib/server/audit';
import { metaFromForm, uploadImages } from '@/server/documents';

/** multipart: "file" repeated, in page order, plus the metadata fields of DocMeta.
    The pictures become one PDF stored like any upload. */
export const POST = handle(async (req) => {
  const p = await requireStaff('library.manage');
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, 'Expected a file upload.', 'invalid');
  }
  const row = await uploadImages(form.getAll('file'), metaFromForm(form), p.id);
  await logActivity(p.id, 'PDF made from pictures', `${row.title} · ${row.pages} pages`);
  return row;
});
