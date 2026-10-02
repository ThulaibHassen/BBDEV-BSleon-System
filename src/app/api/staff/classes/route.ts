import { z } from 'zod';
import { handle, body, query, jsonCached } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { classContext, lastSessionDate, saveClassTopics } from '@/server/classes';
import { todayISO } from '@/lib/shared/dates';

/* The Class page in one request: roster, the register for the date,
   coverage, tutes, batch signals and the attention queue. */

const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.');
const Cohort = z.coerce.number().int().min(0).max(1);

/** No date given: the most recent register, or today (the original's first-visit default). */
export const GET = handle(async (req) => {
  await requireStaff('classes.manage');
  const q = query(req);
  const date = ISO.safeParse(q.get('date')).data ?? (await lastSessionDate()) ?? todayISO();
  const cohort = Cohort.safeParse(q.get('cohort') ?? 0).data ?? 0;
  return jsonCached(await classContext(date, cohort));
});

/** "Save this class": the ticked topics for (date, batch), appended without duplicates. */
export const POST = handle(async (req) => {
  await requireStaff('classes.manage');
  const b = await body(req, z.object({ date: ISO, cohort: Cohort, topics: z.array(z.string().max(8)).max(40) }));
  await saveClassTopics(b.date, b.cohort, b.topics);
  return { ok: true };
});
