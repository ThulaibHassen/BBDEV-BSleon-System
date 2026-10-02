import { z } from 'zod';
import { handle, body, paramId } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { markLost, undoLost } from '@/server/crm';

export const POST = handle<{ id: string }>(async (req, ctx) => {
  const p = await requireStaff('enquiries.write');
  const { reason } = await body(req, z.object({ reason: z.string().trim().min(1).max(80) }));
  return markLost(p, await paramId(ctx), reason);
});

export const DELETE = handle<{ id: string }>(async (req, ctx) => {
  const p = await requireStaff('enquiries.write');
  const { prev } = await body(req, z.object({ prev: z.string().min(1).max(20) }));
  return { record: await undoLost(p, await paramId(ctx), prev) };
});
