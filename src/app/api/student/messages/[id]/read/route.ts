import { handle, paramId } from '@/lib/server/api';
import { requireStudent } from '@/lib/server/auth';
import { loadMe, markRead } from '@/server/student';

/* Read receipt: the original app marked messages read on the phone only. */
export const POST = handle<{ id: string }>(async (_req, ctx) => {
  const p = await requireStudent();
  return markRead(await loadMe(p), await paramId(ctx));
});
