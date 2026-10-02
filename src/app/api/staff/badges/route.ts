import { and, eq, sql } from 'drizzle-orm';
import { handle, jsonCached } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { db, schema } from '@/lib/server/db';
import { recordsScope, tasksScope, openStages } from '@/server/scope';
import { can } from '@/lib/shared/rbac';
import { cached, TAG } from '@/lib/server/cache';
import { listRecordings } from '@/server/classes';

/** Sidebar counters: open enquiries, undone tasks, recordings students can watch right now. */
export const GET = handle(async () => {
  const p = await requireStaff('dashboard.view');
  const d = db();
  const [[r], [t], rec] = await Promise.all([
    d.select({ n: sql<number>`count(*)::int` }).from(schema.records).where(and(openStages, recordsScope(p))),
    d
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.d, false), tasksScope(p))),
    can(p.role, 'classes.manage') ? cached(['badges', 'rec'], 60, async () => (await listRecordings()).live, [TAG.recordings]) : Promise.resolve(0),
  ]);
  // no browser max-age: refreshBadges() right after a write must see the new counts
  return jsonCached({ records: r.n, tasks: t.n, rec });
});
