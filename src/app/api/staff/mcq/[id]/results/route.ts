import { handle, paramId } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { results } from '@/server/mcq';

export const GET = handle<{ id: string }>(async (_req, ctx) => {
  await requireStaff('papers.manage');
  return results(await paramId(ctx));
});
