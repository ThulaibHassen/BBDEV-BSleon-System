import { handle, paramId } from '@/lib/server/api';
import { requireStaff, HttpError } from '@/lib/server/auth';
import { logActivity } from '@/lib/server/audit';
import { appendImages } from '@/server/documents';

/** multipart: "file" repeated, in order — appended as new pages at the end of this document's PDF. */
export const POST = handle<{ id: string }>(async (req, ctx) => {
  const p = await requireStaff('library.manage');
  const id = await paramId(ctx);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, 'Expected a file upload.', 'invalid');
  }
  const out = await appendImages(id, form.getAll('file'));
  await logActivity(p.id, 'Pages added to PDF', `${out.title} · +${out.added} → ${out.pages} pages`);
  return out;
});
