import 'server-only';
import { eq, sql, type SQL } from 'drizzle-orm';
import { schema } from '@/lib/server/db';
import { can } from '@/lib/shared/rbac';
import type { Principal } from '@/lib/server/auth';

/* Data scoping from the original scopeRecords / scopeCustomers / scopeTasks:
   managers and owners see everything; a 'staff' user sees only rows they own. */

export function recordsScope(p: Principal): SQL | undefined {
  return can(p.role, 'enquiries.view.all') ? undefined : eq(schema.records.owner, p.id);
}

export function studentsScope(p: Principal): SQL | undefined {
  return can(p.role, 'students.view.all') ? undefined : eq(schema.students.owner, p.id);
}

export function tasksScope(p: Principal): SQL | undefined {
  return can(p.role, 'tasks.view.all') ? undefined : eq(schema.tasks.who, p.id);
}

export const openStages = sql`${schema.records.stage} not in ('won','lost')`;
