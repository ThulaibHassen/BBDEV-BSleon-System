import { z } from 'zod';
import { handle, body, jsonCached } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { enrolManual, listStudents, ManualEnrolInput, restoreStudent } from '@/server/crm';

export const GET = handle(async () => {
  const p = await requireStaff('students.view.own');
  return jsonCached({ rows: await listStudents(p) });
});

/* Add a student by hand (ENROL with no enquiry), or { restore: token } to undo a removal. */
export const POST = handle(async (req) => {
  const raw = await body(req, z.record(z.string(), z.unknown()));
  if (typeof raw.restore === 'string') {
    const p = await requireStaff('students.delete');
    return restoreStudent(p, raw.restore);
  }
  const p = await requireStaff('students.write');
  return { student: await enrolManual(p, ManualEnrolInput.parse(raw)) };
});
