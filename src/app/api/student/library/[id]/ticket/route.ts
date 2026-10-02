import { handle, paramId } from '@/lib/server/api';
import { requireStudent, HttpError } from '@/lib/server/auth';
import { rateLimit } from '@/lib/server/ratelimit';
import { loadMe, openDocument } from '@/server/student';

/* A two-minute ticket for one PDF. The phone opened a blank window on the tap
   and points it at the url this returns. */
export const POST = handle<{ id: string }>(async (_req, ctx) => {
  const me = await loadMe(await requireStudent());
  if (!(await rateLimit(`student-ticket:${me.id}`, 60, 600)).ok) {
    throw new HttpError(429, 'That is a lot of papers at once. Wait a minute, then try again.', 'rate_limited');
  }
  return openDocument(me, await paramId(ctx));
});
