import { handle, body, paramId } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { logActivity } from '@/lib/server/audit';
import { saveEssay, deleteEssay, EssayIn } from '@/server/papers';

/* One Save for the whole template: a half-typed layout is never live. */

export const PATCH = handle<{ id: string }>(async (req, ctx) => {
  const p = await requireStaff('papers.manage');
  const row = await saveEssay(await paramId(ctx), await body(req, EssayIn));
  await logActivity(p.id, 'Essay template saved', row.title);
  return row;
});

export const DELETE = handle<{ id: string }>(async (_req, ctx) => {
  const p = await requireStaff('papers.manage');
  const row = await deleteEssay(await paramId(ctx));
  await logActivity(p.id, 'Essay template deleted', row.title);
  return { ok: true };
});
