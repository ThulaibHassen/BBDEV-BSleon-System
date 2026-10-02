import { handle, paramId } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { cancelScheduled } from '@/server/messages';

/** Cancel a scheduled message before it goes out. A sent message cannot be unsent. */
export const DELETE = handle<{ id: string }>(async (_req, ctx) => {
  const p = await requireStaff('messages.send');
  await cancelScheduled(await paramId(ctx), p);
  return { ok: true };
});
