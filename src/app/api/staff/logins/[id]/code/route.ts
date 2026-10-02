import { eq } from 'drizzle-orm';
import { handle, paramId, notFound } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { db, schema } from '@/lib/server/db';
import { issueStudentCode } from '@/server/applogins';

/** "Send one-time code": a fresh code for this login, shown once, stored only as a hash. */
export const POST = handle<{ id: string }>(async (_req, ctx) => {
  const p = await requireStaff('app.manage');
  const id = await paramId(ctx);
  const [l] = await db().select({ studentId: schema.appLogins.studentId }).from(schema.appLogins).where(eq(schema.appLogins.id, id)).limit(1);
  if (!l) throw notFound('That login');
  return issueStudentCode(l.studentId, p);
});
