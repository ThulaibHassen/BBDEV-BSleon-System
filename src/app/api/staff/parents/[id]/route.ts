import { z } from 'zod';
import { handle, body, paramId } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { lockParent, removeParent } from '@/server/applogins';

/* Lock / unlock (failures cleared either way) or remove one parent account. */

export const PATCH = handle<{ id: string }>(async (req, ctx) => {
  const p = await requireStaff('parents.manage');
  const b = await body(req, z.object({ locked: z.boolean() }));
  await lockParent(await paramId(ctx), b.locked, p);
  return { ok: true };
});

export const DELETE = handle<{ id: string }>(async (_req, ctx) => {
  const p = await requireStaff('parents.manage');
  await removeParent(await paramId(ctx), p);
  return { ok: true };
});
