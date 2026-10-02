import { z } from 'zod';
import { handle, body } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { assignTute, unassignTute } from '@/server/classes';

/* Set (or take back) the tute for a unit, for one batch. One live assignment per unit per batch. */

const Unit = z.string().trim().min(1).max(4);
const Cohort = z.coerce.number().int().min(0).max(1);

export const POST = handle(async (req) => {
  const p = await requireStaff('classes.manage');
  const b = await body(req, z.object({ unit: Unit, cohort: Cohort, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.') }));
  await assignTute(b.unit, b.cohort, b.date, p);
  return { ok: true };
});

export const DELETE = handle(async (req) => {
  const p = await requireStaff('classes.manage');
  const b = await body(req, z.object({ unit: Unit, cohort: Cohort }));
  const was = await unassignTute(b.unit, b.cohort, p);
  return { ok: true, was };
});
