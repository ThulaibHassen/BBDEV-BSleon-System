import { eq } from 'drizzle-orm';
import { handle } from '@/lib/server/api';
import { requireParent } from '@/lib/server/auth';
import { db, schema } from '@/lib/server/db';

export const GET = handle(async () => {
  const p = await requireParent();
  const [s] = await db()
    .select({ name: schema.students.name })
    .from(schema.students)
    .where(eq(schema.students.id, p.sidOf ?? -1))
    .limit(1);
  return { parent: { id: p.id, label: p.name }, child: s ?? null };
});
