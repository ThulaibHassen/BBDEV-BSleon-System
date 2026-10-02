import { handle, jsonCached } from '@/lib/server/api';
import { requireStudent } from '@/lib/server/auth';
import { listForStudent } from '@/server/mcq';
import { loadMe } from '@/server/student';

/* Timed MCQ papers and speed drills open to this student's batch. */
export const GET = handle(async () => {
  const me = await loadMe(await requireStudent());
  return jsonCached({ papers: await listForStudent(me.id, me.cohort) });
});
