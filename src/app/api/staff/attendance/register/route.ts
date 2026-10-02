import { z } from 'zod';
import { handle, body } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { saveRegister } from '@/server/classes';

/** "Save register": a Present row for everyone on the roll without one, so a full class is on record too. */
export const POST = handle(async (req) => {
  const p = await requireStaff('classes.manage');
  const b = await body(
    req,
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date first.'),
      cohort: z.number().int().min(0).max(1),
      co: z.string().max(60).default('all'),
    }),
  );
  return saveRegister(b.date, b.cohort, b.co, p);
});
