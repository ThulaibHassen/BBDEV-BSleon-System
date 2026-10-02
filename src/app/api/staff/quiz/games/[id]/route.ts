import { z } from 'zod';
import { handle, body, paramId } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { state, host } from '@/server/quiz';
import { gameMeta } from '@/server/papers';

/* The host screen: GET polls the state (with the set title), POST drives it
   with next / reveal / end. Each action nudges phones over SSE. */

export const GET = handle<{ id: string }>(async (_req, ctx) => {
  await requireStaff('papers.manage');
  const id = await paramId(ctx);
  const [st, meta] = await Promise.all([state(id, { staff: true }), gameMeta(id)]);
  return { ...st, title: meta.title };
});

/* `at`: the question index on the host's screen; a stale or repeated click is a no-op. */
const Act = z.object({ action: z.enum(['next', 'reveal', 'end']), at: z.number().int().min(-1).optional() });

export const POST = handle<{ id: string }>(async (req, ctx) => {
  await requireStaff('papers.manage');
  const id = await paramId(ctx);
  const { action, at } = await body(req, Act);
  const [st, meta] = await Promise.all([host(id, action, at), gameMeta(id)]);
  return { ...st, title: meta.title };
});
