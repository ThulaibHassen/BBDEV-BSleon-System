import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
import { handle, query } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { db, schema } from '@/lib/server/db';

const PAGE = 100;

/* Activity feed (?tab=feed) or the sign-in audit (?tab=login), newest first.
   ?before=<id> pages back; ?realm=staff|student|parent narrows the audit. */
export const GET = handle(async (req) => {
  await requireStaff('activity.view');
  const q = query(req);
  const before = Number(q.get('before')) || 0;
  const d = db();

  if (q.get('tab') === 'login') {
    const realm = q.get('realm');
    const where: SQL[] = [];
    if (before) where.push(lt(schema.loginAudit.id, before));
    if (realm === 'staff' || realm === 'student' || realm === 'parent') where.push(eq(schema.loginAudit.realm, realm));
    const rows = await d
      .select({
        id: schema.loginAudit.id,
        realm: schema.loginAudit.realm,
        name: schema.loginAudit.name,
        role: schema.loginAudit.role,
        device: schema.loginAudit.device,
        ok: schema.loginAudit.ok,
        at: schema.loginAudit.at,
      })
      .from(schema.loginAudit)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(schema.loginAudit.id))
      .limit(PAGE + 1);
    return { rows: rows.slice(0, PAGE), more: rows.length > PAGE };
  }

  const rows = await d
    .select({ id: schema.activity.id, t: schema.activity.t, m: schema.activity.m, at: schema.activity.at, who: schema.staff.name })
    .from(schema.activity)
    .leftJoin(schema.staff, eq(schema.staff.id, schema.activity.who))
    .where(before ? lt(schema.activity.id, before) : undefined)
    .orderBy(desc(schema.activity.id))
    .limit(PAGE + 1);
  return { rows: rows.slice(0, PAGE), more: rows.length > PAGE };
});
