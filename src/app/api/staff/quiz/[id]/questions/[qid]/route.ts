import { handle, body, paramId, idParam } from '@/lib/server/api';
import { requireStaff, HttpError } from '@/lib/server/auth';
import { saveQuizQuestion, deleteQuizQuestion, QuizQuestionIn } from '@/server/papers';

type P = { id: string; qid: string };
async function qidOf(ctx: { params: Promise<P> }) {
  const r = idParam.safeParse((await ctx.params).qid);
  if (!r.success) throw new HttpError(400, 'Bad id', 'invalid');
  return r.data;
}

export const PATCH = handle<P>(async (req, ctx) => {
  await requireStaff('papers.manage');
  return saveQuizQuestion(await paramId(ctx), await qidOf(ctx), await body(req, QuizQuestionIn));
});

export const DELETE = handle<P>(async (_req, ctx) => {
  await requireStaff('papers.manage');
  await deleteQuizQuestion(await paramId(ctx), await qidOf(ctx));
  return { ok: true };
});
