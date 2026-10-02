import { handle, paramId, jsonCached } from '@/lib/server/api';
import { requireStudent } from '@/lib/server/auth';
import { state } from '@/server/quiz';

/* Polled every 2 s; `answer` and `why` only appear while the state is reveal. */
export const GET = handle<{ id: string }>(async (_req, ctx) => {
  const p = await requireStudent();
  return jsonCached(await state(await paramId(ctx), { studentId: p.id }));
});
