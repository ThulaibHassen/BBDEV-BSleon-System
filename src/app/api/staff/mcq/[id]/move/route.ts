import { z } from 'zod';
import { handle, body, paramId } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { moveMcqQuestion } from '@/server/papers';

const Move = z.object({ qid: z.number().int().positive(), dir: z.union([z.literal(-1), z.literal(1)]) });

export const POST = handle<{ id: string }>(async (req, ctx) => {
  await requireStaff('papers.manage');
  const b = await body(req, Move);
  await moveMcqQuestion(await paramId(ctx), b.qid, b.dir);
  return { ok: true };
});
