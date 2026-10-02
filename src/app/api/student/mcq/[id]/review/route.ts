import { handle, paramId } from '@/lib/server/api';
import { requireStudent } from '@/lib/server/auth';
import { review } from '@/server/mcq';

/* A finished paper, marked, with the answers and Leon's notes. */
export const GET = handle<{ id: string }>(async (_req, ctx) => {
  const p = await requireStudent();
  return review(await paramId(ctx), p.id);
});
