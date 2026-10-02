import { handle, query } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { reads } from '@/server/library';

/** Opens per document (students only) over the last N days, default 30. */
export const GET = handle(async (req) => {
  await requireStaff('library.manage');
  const days = Math.min(365, Math.max(1, Number(query(req).get('days')) || 30));
  return reads(days);
});
