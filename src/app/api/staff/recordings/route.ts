import { z } from 'zod';
import { handle, body, query, jsonCached } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { addRecording, listRecordings, recordingPreview } from '@/server/classes';
import { todayISO } from '@/lib/shared/dates';

/* Class recordings: a link, never a file. GET also returns the add-form
   preview counts for the class chosen at the top of the Class page. */

export const GET = handle(async (req) => {
  await requireStaff('classes.manage');
  const q = query(req);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q.get('date') ?? '') ? q.get('date')! : todayISO();
  const cohort = q.get('cohort') === '1' ? 1 : 0;
  const [list, preview] = await Promise.all([listRecordings(), recordingPreview(date, cohort)]);
  return jsonCached({ ...list, preview });
});

export const POST = handle(async (req) => {
  const p = await requireStaff('classes.manage');
  const b = await body(
    req,
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the date of the class.'),
      cohort: z.number().int().min(0).max(1),
      loc: z.string().max(20),
      title: z.string().trim().max(160),
      url: z.string().trim().max(1000),
      mins: z.number().int().min(0).max(600).default(0),
      release: z.enum(['absent', 'batch', 'picked']),
      windowDays: z.union([z.literal(0), z.literal(7), z.literal(14), z.literal(30)]),
    }),
  );
  return addRecording(b, p);
});
