import { z } from 'zod';
import { handle, body, paramId } from '@/lib/server/api';
import { requireStudent } from '@/lib/server/auth';
import { answer } from '@/server/quiz';

const Body = z.object({ questionId: z.number().int().positive(), choice: z.number().int().min(0).max(9) });

/* Marked and timed on the server, so a slowed phone clock buys nothing. */
export const POST = handle<{ id: string }>(async (req, ctx) => {
  const p = await requireStudent();
  const b = await body(req, Body);
  return answer(await paramId(ctx), b.questionId, b.choice, p.id);
});
