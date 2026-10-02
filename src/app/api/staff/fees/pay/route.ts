import { z } from 'zod';
import { body, handle } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { recordPayment } from '@/server/fees';
import { PAYMENT_METHODS } from '@/components/staff/money/shared';
import { Day } from '@/components/staff/money/schemas';

const Schema = z.object({
  planId: z.number().int().positive(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  amount: z.number().int().positive().max(10_000_000).optional(),
  method: z.enum(PAYMENT_METHODS).default('Cash'),
  paidAt: Day().optional(),
});

/** Mark paid (no amount = the rest of the fee) or record a part payment. */
export const POST = handle(async (req) => {
  const p = await requireStaff('fees.manage');
  const i = await body(req, Schema);
  return recordPayment(p, i);
});
