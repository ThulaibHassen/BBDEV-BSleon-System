import { z } from 'zod';
import { body, handle } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { can } from '@/lib/shared/rbac';
import { addUser, teamOverview } from '@/server/team';

const AddSchema = z.object({
  name: z.string().trim().min(1, 'Give them a name.').max(60),
  email: z.string().trim().toLowerCase().max(120).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'That email does not look right.'),
  role: z.enum(['owner', 'manager', 'staff'], { message: 'Pick a role.' }),
  password: z.string().max(72),
});

/** Team cards (managers and owners); emails only for owners, who manage logins. */
export const GET = handle(async () => {
  const p = await requireStaff('team.view');
  const manage = can(p.role, 'team.manage');
  return { people: await teamOverview(manage), canManage: manage };
});

/** Add a user (owner only). */
export const POST = handle(async (req) => {
  const p = await requireStaff('team.manage');
  return { staff: await addUser(p, await body(req, AddSchema)) };
});
