import { z } from 'zod';
import { handle, body, paramId } from '@/lib/server/api';
import { requireStudent } from '@/lib/server/auth';
import { submit } from '@/server/mcq';

const Body = z.object({ answers: z.record(z.string(), z.number().int()) });

/* Marks against the server's clock; the right answers leave exactly once, here. */
export const POST = handle<{ id: string }>(async (req, ctx) => {
  const p = await requireStudent();
  const { answers } = await body(req, Body);
  return submit(await paramId(ctx), p.id, answers);
});
