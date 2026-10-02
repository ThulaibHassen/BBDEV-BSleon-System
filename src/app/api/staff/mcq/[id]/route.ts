import { handle, body, paramId } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { logActivity } from '@/lib/server/audit';
import { getPaper, patchPaper, deletePaper, PaperPatch } from '@/server/papers';

/* One paper: its settings + questions (answers included: staff only). */

export const GET = handle<{ id: string }>(async (_req, ctx) => {
  await requireStaff('papers.manage');
  return getPaper(await paramId(ctx));
});

export const PATCH = handle<{ id: string }>(async (req, ctx) => {
  const p = await requireStaff('papers.manage');
  const patch = await body(req, PaperPatch);
  const row = await patchPaper(await paramId(ctx), patch);
  if (patch.published !== undefined) await logActivity(p.id, patch.published ? 'MCQ paper published' : 'MCQ paper unpublished', row.title);
  return row;
});

export const DELETE = handle<{ id: string }>(async (_req, ctx) => {
  const p = await requireStaff('papers.manage');
  const row = await deletePaper(await paramId(ctx));
  await logActivity(p.id, 'MCQ paper deleted', row.title);
  return { ok: true };
});
