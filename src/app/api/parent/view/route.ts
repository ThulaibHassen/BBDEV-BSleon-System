import { handle, jsonCached, notFound } from '@/lib/server/api';
import { requireParent, HttpError } from '@/lib/server/auth';
import { parentView, parentSchedule } from '@/server/parent';

/* GET /api/parent/view — everything the four parent screens show.
   The child comes from the session (p.sidOf), never from the request. */

export const GET = handle(async () => {
  const p = await requireParent();
  if (!p.sidOf) throw new HttpError(403, 'This sign-in is not linked to a child.', 'forbidden');
  const v = await parentView(p.sidOf);
  if (!v) throw notFound('Your child');
  const { loc, cohort, ...view } = v;
  const schedule = await parentSchedule(loc, cohort);
  return jsonCached({ parent: { label: p.name }, ...view, schedule });
});
