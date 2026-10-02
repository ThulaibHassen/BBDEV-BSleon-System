import { z } from 'zod';
import { handle, body, paramId } from '@/lib/server/api';
import { requireStudent } from '@/lib/server/auth';
import { loadMe, registerSeminar } from '@/server/student';

const Body = z.object({ on: z.boolean().default(true) });

/* Seminar sign-up (and its undo). Lands on Leon's list in the staff app. */
export const POST = handle<{ id: string }>(async (req, ctx) => {
  const p = await requireStudent();
  const { on } = await body(req, Body);
  return registerSeminar(await loadMe(p), await paramId(ctx), on);
});
