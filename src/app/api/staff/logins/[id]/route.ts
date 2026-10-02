import { z } from 'zod';
import { handle, body, paramId } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { lockLogin, removeLogin, signOutLogin } from '@/server/applogins';

/* Manage one student login. Lock and sign-out revoke every live session. */

export const PATCH = handle<{ id: string }>(async (req, ctx) => {
  const p = await requireStaff('app.manage');
  const id = await paramId(ctx);
  const b = await body(req, z.object({ action: z.enum(['lock', 'unlock', 'signout']) }));
  if (b.action === 'signout') return signOutLogin(id, p);
  return lockLogin(id, b.action === 'lock', p);
});

export const DELETE = handle<{ id: string }>(async (_req, ctx) => {
  const p = await requireStaff('app.manage');
  return removeLogin(await paramId(ctx), p);
});
