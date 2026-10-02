import { z } from 'zod';
import { handle, body } from '@/lib/server/api';
import { requireStudent, HttpError } from '@/lib/server/auth';
import { db, schema } from '@/lib/server/db';
import { ymNow, ymShift } from '@/lib/shared/dates';

/* The monthly check-in. Leon sees it; the batch never does. Only last
   month or this month can be answered, which is all the app ever asks. */

const Body = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  mood: z.enum(['steady', 'heavy', 'struggling']),
  blocker: z.enum(['none', 'time', 'topics', 'motivation', 'personal']),
});

export const PUT = handle(async (req) => {
  const p = await requireStudent();
  const b = await body(req, Body);
  const now = ymNow();
  if (b.month !== now && b.month !== ymShift(now, -1)) throw new HttpError(400, 'That month is closed for check-ins.', 'month');
  const C = schema.checkins;
  await db()
    .insert(C)
    .values({ studentId: p.id, month: b.month, mood: b.mood, blocker: b.blocker })
    .onConflictDoUpdate({ target: [C.studentId, C.month], set: { mood: b.mood, blocker: b.blocker } });
  return { ok: true };
});
