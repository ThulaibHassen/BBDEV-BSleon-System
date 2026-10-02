import { handle, paramId } from '@/lib/server/api';
import { requireStudent } from '@/lib/server/auth';
import { loadMe, markRecordingViewed } from '@/server/student';

/* Recorded so the reminder job stops nudging about a class already watched. */
export const POST = handle<{ id: string }>(async (_req, ctx) => {
  const p = await requireStudent();
  await markRecordingViewed(await loadMe(p), await paramId(ctx));
  return { ok: true };
});
