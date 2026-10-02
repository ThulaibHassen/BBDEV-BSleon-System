import { z } from 'zod';
import { body, handle, paramId } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { resetPassword, setActive, setRole } from '@/server/team';

const Schema = z.union([
  z.object({ role: z.enum(['owner', 'manager', 'staff']) }).strict(),
  z.object({ active: z.boolean() }).strict(),
  z.object({ password: z.string().max(72) }).strict(),
]);

/** Owner only: change role, deactivate / reactivate, or set a temporary password. */
export const PATCH = handle<{ id: string }>(async (req, ctx) => {
  const p = await requireStaff('team.manage');
  const id = await paramId(ctx);
  const b = await body(req, Schema);
  if ('role' in b) return setRole(p, id, b.role);
  if ('active' in b) return setActive(p, id, b.active);
  return resetPassword(p, id, b.password);
});
