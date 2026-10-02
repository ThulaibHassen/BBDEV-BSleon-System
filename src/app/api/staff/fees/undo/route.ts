import { z } from 'zod';
import { body, handle } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { undoPayment } from '@/server/fees';

const Schema = z.object({
  id: z.number().int().positive(),
  created: z.boolean(),
  prev: z
    .object({
      amount: z.number().int().min(0),
      status: z.enum(['paid', 'partial']),
      method: z.string().max(40),
      paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    })
    .optional(),
});

/** Undo the last Mark paid: remove the row it created, or put the old amount back. */
export const POST = handle(async (req) => {
  const p = await requireStaff('fees.manage');
  await undoPayment(p.id, await body(req, Schema));
  return { ok: true };
});
