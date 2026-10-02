import { eq } from 'drizzle-orm';
import { handle } from '@/lib/server/api';
import { requireStudent } from '@/lib/server/auth';
import { db, schema } from '@/lib/server/db';

export const GET = handle(async () => {
  const p = await requireStudent();
  const [s] = await db()
    .select({ id: schema.students.id, name: schema.students.name, cohort: schema.students.cohort })
    .from(schema.students)
    .where(eq(schema.students.id, p.id))
    .limit(1);
  return { student: s };
});
