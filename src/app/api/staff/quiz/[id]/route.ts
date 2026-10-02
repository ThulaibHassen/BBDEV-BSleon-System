import { handle, body, paramId } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { logActivity } from '@/lib/server/audit';
import { getQuiz, patchQuiz, deleteQuiz, QuizPatch } from '@/server/papers';

export const GET = handle<{ id: string }>(async (_req, ctx) => {
  await requireStaff('papers.manage');
  return getQuiz(await paramId(ctx));
});

export const PATCH = handle<{ id: string }>(async (req, ctx) => {
  await requireStaff('papers.manage');
  return patchQuiz(await paramId(ctx), await body(req, QuizPatch));
});

export const DELETE = handle<{ id: string }>(async (_req, ctx) => {
  const p = await requireStaff('papers.manage');
  const row = await deleteQuiz(await paramId(ctx));
  await logActivity(p.id, 'Question set deleted', row.title);
  return { ok: true };
});
