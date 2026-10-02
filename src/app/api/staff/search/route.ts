import { and, ilike, or } from 'drizzle-orm';
import { handle, query } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { db, schema } from '@/lib/server/db';
import { recordsScope, studentsScope, tasksScope } from '@/server/scope';
import { can } from '@/lib/shared/rbac';
import { stageOf, lkr } from '@/lib/shared/constants';

/* Topbar search (students first, then enquiries — 6 each) and, with
   ?palette=1, the command palette (students, enquiries, tasks, invoices).
   Every list is scoped to what this role may see. */
export const GET = handle(async (req) => {
  const p = await requireStaff('dashboard.view');
  const qs = query(req);
  const q = (qs.get('q') || '').trim().slice(0, 80);
  const palette = qs.get('palette') === '1';
  if (!q) return palette ? { rows: [] } : { hits: [] };
  const like = `%${q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
  const d = db();
  const lim = palette ? 12 : 6;

  const [students, records] = await Promise.all([
    d
      .select({ id: schema.students.id, name: schema.students.name, phone: schema.students.phone, co: schema.students.co })
      .from(schema.students)
      .where(and(studentsScope(p), or(ilike(schema.students.name, like), ilike(schema.students.phone, like), ilike(schema.students.co, like))))
      .limit(lim),
    d
      .select({ id: schema.records.id, name: schema.records.name, co: schema.records.co, stage: schema.records.stage })
      .from(schema.records)
      .where(and(recordsScope(p), or(ilike(schema.records.name, like), ilike(schema.records.co, like))))
      .limit(lim),
  ]);

  if (!palette) {
    return {
      hits: [
        ...students.map((s) => ({ kind: 'student', id: s.id, name: s.name, meta: [s.co, s.phone].filter(Boolean).join(' · ') })),
        ...records.map((r) => ({ kind: 'enquiry', id: r.id, name: r.name, meta: `${r.co} · ${stageOf(r.stage).label}` })),
      ],
    };
  }

  const [tasks, invoices] = await Promise.all([
    d
      .select({ id: schema.tasks.id, t: schema.tasks.t, due: schema.tasks.due })
      .from(schema.tasks)
      .where(and(tasksScope(p), ilike(schema.tasks.t, like)))
      .limit(lim),
    can(p.role, 'invoices.manage')
      ? d
          .select({ id: schema.invoices.id, ref: schema.invoices.ref, cust: schema.invoices.cust, amount: schema.invoices.amount })
          .from(schema.invoices)
          .where(or(ilike(schema.invoices.ref, like), ilike(schema.invoices.cust, like)))
          .limit(lim)
      : Promise.resolve([] as { id: number; ref: string; cust: string; amount: number }[]),
  ]);
  return {
    rows: [
      ...students.map((s) => ({ kind: 'Student', title: s.name, sub: s.phone, href: `/staff/customers?open=${s.id}` })),
      ...records.map((r) => ({ kind: 'Enquiry', title: r.name, sub: stageOf(r.stage).label, href: `/staff/records?open=${r.id}` })),
      ...tasks.map((t) => ({ kind: 'Task', title: t.t, sub: t.due ?? '', href: '/staff/tasks' })),
      ...invoices.map((i) => ({ kind: 'Invoice', title: `${i.ref} · ${i.cust}`, sub: lkr(i.amount), href: '/staff/finance' })),
    ],
  };
});
