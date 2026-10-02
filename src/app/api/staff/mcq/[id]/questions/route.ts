import { handle, body, paramId } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { saveMcqQuestion, McqQuestionIn } from '@/server/papers';

export const POST = handle<{ id: string }>(async (req, ctx) => {
  await requireStaff('papers.manage');
  return saveMcqQuestion(await paramId(ctx), null, await body(req, McqQuestionIn));
});
