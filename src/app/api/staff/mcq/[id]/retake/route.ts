import { z } from 'zod';
import { handle, body, paramId } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { logActivity } from '@/lib/server/audit';
import { retake } from '@/server/mcq';

/** Clears one student's attempt so a dead phone does not cost them the paper. */
const In = z.object({ studentId: z.number().int().positive(), name: z.string().max(120).optional() });

export const POST = handle<{ id: string }>(async (req, ctx) => {
  const p = await requireStaff('papers.manage');
  const b = await body(req, In);
  await retake(await paramId(ctx), b.studentId);
  await logActivity(p.id, 'MCQ retake allowed', b.name || `#${b.studentId}`);
  return { ok: true };
});
