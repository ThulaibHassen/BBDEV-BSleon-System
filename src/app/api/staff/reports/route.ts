import { handle, query } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { ymNow } from '@/lib/shared/dates';
import { report } from '@/server/finance';
import { YM_RE } from '@/components/staff/money/shared';

/** Month-over-month report. ?ym= the month, ?cmp= the month to compare with (earlier). */
export const GET = handle(async (req) => {
  await requireStaff('reports.view');
  const q = query(req);
  const ym = YM_RE.test(q.get('ym') ?? '') ? q.get('ym')! : ymNow();
  const cmp = YM_RE.test(q.get('cmp') ?? '') ? q.get('cmp')! : undefined;
  return report(ym, cmp);
});
