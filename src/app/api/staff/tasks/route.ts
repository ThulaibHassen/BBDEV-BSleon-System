import { z } from 'zod';
import { handle, body, jsonCached } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { createTask, listTasks, restoreTask, TaskInput, TaskRestore } from '@/server/crm';

/** Live tasks (done for 4+ days are archived: counted, never deleted). */
export const GET = handle(async () => {
  const p = await requireStaff('tasks.view.own');
  return jsonCached(await listTasks(p));
});

/* Add a task, or { restore: task } to undo a delete. */
export const POST = handle(async (req) => {
  const p = await requireStaff('tasks.write');
  const raw = await body(req, z.record(z.string(), z.unknown()));
  if (raw.restore) return { task: await restoreTask(p, TaskRestore.parse(raw.restore)) };
  return { task: await createTask(p, TaskInput.parse(raw)) };
});
