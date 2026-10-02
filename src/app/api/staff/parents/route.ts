import { z } from 'zod';
import { handle, body, jsonCached } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { issueParentCode, parentsList } from '@/server/applogins';

/* Parent access. POST {studentId,label} gives a new parent access (a new
   account every time: two parents are two rows); POST {parentId} re-issues. */

export const GET = handle(async () => {
  await requireStaff('parents.manage');
  return jsonCached({ parents: await parentsList() });
});

export const POST = handle(async (req) => {
  const p = await requireStaff('parents.manage');
  const b = await body(
    req,
    z.union([
      z.object({ parentId: z.number().int().positive() }),
      z.object({ studentId: z.number({ message: 'Pick a student.' }).int().positive('Pick a student.'), label: z.string().max(24).optional() }),
    ]),
  );
  return issueParentCode(b, p);
});
