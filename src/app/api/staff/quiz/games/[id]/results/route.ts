import { handle, paramId } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { results } from '@/server/quiz';

/** Full results, for the teacher, not the class screen. */
export const GET = handle<{ id: string }>(async (_req, ctx) => {
  await requireStaff('papers.manage');
  return results(await paramId(ctx));
});
