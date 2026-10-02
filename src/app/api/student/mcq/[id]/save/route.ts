import { z } from 'zod';
import { handle, body, paramId } from '@/lib/server/api';
import { requireStudent } from '@/lib/server/auth';
import { save } from '@/server/mcq';

const Body = z.object({ answers: z.record(z.string(), z.number().int()) });

/* Autosave while the paper is open (1.2 s after an answer, and every 10 s). */
export const POST = handle<{ id: string }>(async (req, ctx) => {
  const p = await requireStudent();
  const { answers } = await body(req, Body);
  return { saved: await save(await paramId(ctx), p.id, answers) };
});
