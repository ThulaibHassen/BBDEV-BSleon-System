import { z } from 'zod';
import { handle, body, paramId } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { grant, revoke } from '@/server/classes';

/** Give one student a recording by hand, or take it from them (a revoke beats a grant). */
export const POST = handle<{ id: string }>(async (req, ctx) => {
  const p = await requireStaff('classes.manage');
  const id = await paramId(ctx);
  const b = await body(req, z.object({ studentId: z.number().int().positive(), grant: z.boolean() }));
  const name = b.grant ? await grant(id, b.studentId, p) : await revoke(id, b.studentId, p);
  return { ok: true, name };
});
