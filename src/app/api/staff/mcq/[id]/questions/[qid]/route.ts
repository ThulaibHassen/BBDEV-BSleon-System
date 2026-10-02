import { handle, body, paramId, idParam } from '@/lib/server/api';
import { requireStaff, HttpError } from '@/lib/server/auth';
import { saveMcqQuestion, deleteMcqQuestion, McqQuestionIn } from '@/server/papers';

type P = { id: string; qid: string };
async function qidOf(ctx: { params: Promise<P> }) {
  const r = idParam.safeParse((await ctx.params).qid);
  if (!r.success) throw new HttpError(400, 'Bad id', 'invalid');
  return r.data;
}

export const PATCH = handle<P>(async (req, ctx) => {
  await requireStaff('papers.manage');
  return saveMcqQuestion(await paramId(ctx), await qidOf(ctx), await body(req, McqQuestionIn));
});

export const DELETE = handle<P>(async (_req, ctx) => {
  await requireStaff('papers.manage');
  await deleteMcqQuestion(await paramId(ctx), await qidOf(ctx));
  return { ok: true };
});
