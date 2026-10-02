import { z } from 'zod';
import { handle, idParam, query } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { receiptData } from '@/server/fees';

/** Data for the printable fee receipt. month omitted = the latest paid month. */
export const GET = handle(async (req) => {
  const p = await requireStaff('students.view.own');
  const q = query(req);
  const student = idParam.parse(q.get('student'));
  const m = q.get('month');
  const month = m ? z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).parse(m) : undefined;
  return receiptData(p, student, month);
});
