import { eq } from 'drizzle-orm';
import { handle } from '@/lib/server/api';
import { requireStaff, HttpError } from '@/lib/server/auth';
import { db, schema } from '@/lib/server/db';
import { ROLE_PERMISSIONS } from '@/lib/shared/rbac';

export const GET = handle(async () => {
  const p = await requireStaff();
  const [s] = await db().select().from(schema.staff).where(eq(schema.staff.id, p.id)).limit(1);
  if (!s) throw new HttpError(401, 'Your session has ended. Please sign in again.', 'unauthenticated');
  return {
    staff: { id: s.id, name: s.name, role: s.role, email: s.email, mustChangePassword: s.mustChangePassword },
    permissions: [...(ROLE_PERMISSIONS[p.role] ?? [])],
  };
});
