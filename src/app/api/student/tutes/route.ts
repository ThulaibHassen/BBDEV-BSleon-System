import { z } from 'zod';
import { handle, body } from '@/lib/server/api';
import { requireStudent } from '@/lib/server/auth';
import { db, schema } from '@/lib/server/db';
import { BSWL_SYLLABUS } from '@/lib/shared/constants';

/* The student's own record of where they are with a unit's tute. */

const UNITS = new Set(BSWL_SYLLABUS.map((u) => u.u));
const Body = z.object({
  unit: z.string().refine((u) => UNITS.has(u), 'Unknown unit'),
  state: z.enum(['assigned', 'started', 'done', 'fix']),
});

export const PUT = handle(async (req) => {
  const p = await requireStudent();
  const { unit, state } = await body(req, Body);
  const T = schema.tutes;
  await db()
    .insert(T)
    .values({ studentId: p.id, unit, state })
    .onConflictDoUpdate({ target: [T.studentId, T.unit], set: { state, updatedAt: new Date() } });
  return { ok: true };
});
