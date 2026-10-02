import { z } from 'zod';
import { handle, body } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { createLogin } from '@/server/applogins';

/** "Create access": username from the first name, then a one-time code, returned once. */
export const POST = handle(async (req) => {
  const p = await requireStaff('app.manage');
  const b = await body(req, z.object({ studentId: z.number({ message: 'Pick a student first.' }).int().positive('Pick a student first.') }));
  return createLogin(b.studentId, p);
});
