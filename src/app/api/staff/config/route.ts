import { asc } from 'drizzle-orm';
import { handle } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { db, schema } from '@/lib/server/db';
import { getStudio } from '@/server/config';

/** Everything the staff chrome needs: module switches, vocabulary, stages, team list. */
export const GET = handle(async () => {
  await requireStaff('dashboard.view');
  const c = await getStudio();
  const team = await db()
    .select({ id: schema.staff.id, name: schema.staff.name, role: schema.staff.role, active: schema.staff.active })
    .from(schema.staff)
    .orderBy(asc(schema.staff.id));
  return {
    modules: c.modules,
    entity: c.entity,
    contactWord: c.contactWord,
    fieldLabels: c.fieldLabels,
    feeLabel: c.recurring.label,
    stages: c.stages,
    lostReasons: c.lostReasons,
    waTemplate: c.waTemplate,
    monthlyTarget: c.monthlyTarget,
    cadence: c.cadence,
    company: c.company,
    recurring: c.recurring,
    brand: ((c as unknown as { brand?: Record<string, string | null> }).brand ?? {}) as Record<string, string | null>,
    app: { client: c.app.client, tagline: c.app.tagline },
    team,
  };
});
