import { handle, paramId } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { grant } from '@/server/library';

/** Staff "Open": a 120-second ticket like a student's, logged as a staff open (drafts included). */
export const POST = handle<{ id: string }>(async (_req, ctx) => {
  const p = await requireStaff('library.manage');
  return grant({ docId: await paramId(ctx), staffId: p.id });
});
