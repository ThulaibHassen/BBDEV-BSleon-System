import { z } from 'zod';
import { handle, body, paramId } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { cadence, editStudent, setNote, removeStudent, setLevel, setStatus, studentDetail, StudentEdit } from '@/server/crm';

export const GET = handle<{ id: string }>(async (_req, ctx) => {
  const p = await requireStaff('students.view.own');
  return { student: await studentDetail(p, await paramId(ctx)) };
});

const Patch = z.discriminatedUnion('action', [
  StudentEdit.extend({ action: z.literal('edit') }),
  z.object({ action: z.literal('level'), level: z.enum(['good', 'okay', 'bad']) }),
  z.object({ action: z.literal('status'), status: z.enum(['active', 'alumni']) }),
  z.object({ action: z.literal('cadence'), op: z.enum(['done', 'snooze']) }),
  z.object({ action: z.literal('note'), note: z.string().max(2000) }),
]);

/* The light touches (standing, referral step) are open to whoever may see the
   student, as in the original; details and status need students.write. */
export const PATCH = handle<{ id: string }>(async (req, ctx) => {
  const id = await paramId(ctx);
  const b = await body(req, Patch);
  if (b.action === 'edit') {
    const p = await requireStaff('students.write');
    return editStudent(p, id, { name: b.name, phone: b.phone, cohort: b.cohort, program: b.program, loc: b.loc });
  }
  if (b.action === 'status') {
    const p = await requireStaff('students.write');
    await setStatus(p, id, b.status);
    return { ok: true };
  }
  const p = await requireStaff('students.view.own');
  if (b.action === 'note') return setNote(p, id, b.note);
  if (b.action === 'level') {
    await setLevel(p, id, b.level);
    return { ok: true };
  }
  return cadence(p, id, b.op);
});

/** Remove — refused when any payment exists; returns an undo token. */
export const DELETE = handle<{ id: string }>(async (_req, ctx) => {
  const p = await requireStaff('students.delete');
  return removeStudent(p, await paramId(ctx));
});
