import { handle, body, paramId } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { deleteTask, TaskPatch, updateTask } from '@/server/crm';

/** Toggle done ({ d }) or the inline edit (t, who, due, dueTime, note). */
export const PATCH = handle<{ id: string }>(async (req, ctx) => {
  const p = await requireStaff('tasks.write');
  return { task: await updateTask(p, await paramId(ctx), await body(req, TaskPatch)) };
});

/** Delete; the response carries the row so the client's Undo can put it back. */
export const DELETE = handle<{ id: string }>(async (_req, ctx) => {
  const p = await requireStaff('tasks.write');
  return { task: await deleteTask(p, await paramId(ctx)) };
});
