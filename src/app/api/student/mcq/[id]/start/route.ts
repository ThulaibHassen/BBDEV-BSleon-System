import { handle, paramId } from '@/lib/server/api';
import { requireStudent } from '@/lib/server/auth';
import { start } from '@/server/mcq';
import { loadMe } from '@/server/student';

/* Starts (or re-opens) the attempt. The clock is the server's; no answer key. */
export const POST = handle<{ id: string }>(async (_req, ctx) => {
  const me = await loadMe(await requireStudent());
  return start(await paramId(ctx), me.id, me.cohort);
});
