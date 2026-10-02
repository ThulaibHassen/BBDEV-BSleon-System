import { handle, jsonCached } from '@/lib/server/api';
import { requireStudent } from '@/lib/server/auth';
import { essays, loadMe } from '@/server/student';

/* Published essay templates for the student's batch (or every batch). */
export const GET = handle(async () => {
  const me = await loadMe(await requireStudent());
  return jsonCached({ essays: await essays(me.cohort) });
});
