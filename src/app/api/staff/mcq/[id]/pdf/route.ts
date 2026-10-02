import { handle, body, paramId } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { logActivity } from '@/lib/server/audit';
import { savePdfKey, leavePdfMode, PdfKeyIn } from '@/server/papers';

/* PDF mode: the paper is a library PDF; this saves the answer key as
   "Question N" rows (PUT), or goes back to typed questions (DELETE). */

export const PUT = handle<{ id: string }>(async (req, ctx) => {
  const p = await requireStaff('papers.manage');
  const out = await savePdfKey(await paramId(ctx), await body(req, PdfKeyIn));
  await logActivity(p.id, 'MCQ answer key saved', `${out.paper.title} · ${out.questions.length} questions`);
  return out;
});

export const DELETE = handle<{ id: string }>(async (_req, ctx) => {
  await requireStaff('papers.manage');
  return leavePdfMode(await paramId(ctx));
});
