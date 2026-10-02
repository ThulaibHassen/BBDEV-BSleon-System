import { handle, jsonCached } from '@/lib/server/api';
import { requireStudent } from '@/lib/server/auth';
import { listForStudent } from '@/server/library';
import { loadMe } from '@/server/student';

/* The PDF library a student may see: published, their batch, inside its window. */
export const GET = handle(async () => {
  const me = await loadMe(await requireStudent());
  return jsonCached({ docs: await listForStudent(me.cohort), serverNow: new Date().toISOString() });
});
