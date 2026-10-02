import { handle, idParam, query } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { guideData } from '@/server/fees';

/** Data for the printable Student Starter Guide. */
export const GET = handle(async (req) => {
  const p = await requireStaff('students.view.own');
  return guideData(p, idParam.parse(query(req).get('student')));
});
