import { z } from 'zod';
import { handle, body } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { setAttendance } from '@/server/classes';

/** One tap on the register: upsert on (student_id, date). A correction is just another upsert. */
export const POST = handle(async (req) => {
  const p = await requireStaff('classes.manage');
  const b = await body(
    req,
    z.object({ studentId: z.number().int().positive(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date first.'), present: z.boolean() }),
  );
  await setAttendance(b.studentId, b.date, b.present, p.id);
  return { ok: true };
});
