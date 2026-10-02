import { handle, jsonCached } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { dashboard } from '@/server/crm';

/** The live dashboard: fees hero, KPIs, 6-month chart, who owes, follow-ups, tasks. */
export const GET = handle(async () => {
  const p = await requireStaff('dashboard.view');
  return jsonCached(await dashboard(p));
});
