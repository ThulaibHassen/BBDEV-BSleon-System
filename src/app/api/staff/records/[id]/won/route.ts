import { z } from 'zod';
import { handle, body, paramId } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { markWon, undoWon } from '@/server/crm';

/** Mark won. Returns the previous stage so the client's Undo can send it back. */
export const POST = handle<{ id: string }>(async (_req, ctx) => {
  const p = await requireStaff('enquiries.write');
  return markWon(p, await paramId(ctx));
});

/** Undo a win: stage back, and the student it created (if no payment yet) removed. */
export const DELETE = handle<{ id: string }>(async (req, ctx) => {
  const p = await requireStaff('enquiries.write');
  const { prev } = await body(req, z.object({ prev: z.string().min(1).max(20) }));
  return { record: await undoWon(p, await paramId(ctx), prev) };
});
