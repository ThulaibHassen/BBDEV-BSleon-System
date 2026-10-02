import 'server-only';
import { and, eq, ne, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/server/db';
import { HttpError, revokeAllFor, type Principal } from '@/lib/server/auth';
import { logActivity } from '@/lib/server/audit';
import { hashPassword, passwordProblem } from '@/lib/server/password';
import { ROLE_RANK, roleLabel, type StaffRole } from '@/lib/shared/rbac';
import { getStudio } from './config';

/* ═══ Team (original §5) ═════════════════════════════════════════════════
   Cards: per active person, records owned / open / won / revenue.
   Owner-only management: add a user (temporary password, must change on
   first sign-in), change role, deactivate / reactivate, reset a password.
   Rule: there is always at least one active owner — nobody, including the
   last owner themself, can demote or deactivate that account. */

export async function teamOverview(withEmail: boolean) {
  const d = db();
  const studio = await getStudio();
  const won = studio.stages.filter((s) => s.terminal === 'won').map((s) => s.k);
  const term = studio.stages.filter((s) => s.terminal).map((s) => s.k);
  const wonList = sql.join(won.map((k) => sql`${k}`), sql`, `);
  const termList = sql.join(term.map((k) => sql`${k}`), sql`, `);

  const [people, stats] = await Promise.all([
    d.select().from(schema.staff).orderBy(schema.staff.id),
    d
      .select({
        owner: schema.records.owner,
        own: sql<number>`count(*)::int`,
        open: sql<number>`count(*) filter (where ${schema.records.stage} not in (${termList}))::int`,
        won: sql<number>`count(*) filter (where ${schema.records.stage} in (${wonList}))::int`,
        rev: sql<number>`coalesce(sum(${schema.records.value}) filter (where ${schema.records.stage} in (${wonList})),0)::int`,
      })
      .from(schema.records)
      .groupBy(schema.records.owner),
  ]);
  return people.map((s) => {
    const st = stats.find((x) => x.owner === s.id);
    return {
      id: s.id,
      name: s.name,
      email: withEmail ? s.email : undefined,
      role: s.role as StaffRole,
      active: s.active,
      lastLoginAt: s.lastLoginAt,
      mustChangePassword: s.mustChangePassword,
      own: st?.own ?? 0,
      open: st?.open ?? 0,
      won: st?.won ?? 0,
      rev: st?.rev ?? 0,
    };
  });
}

function checkPassword(pw: string) {
  const bad = passwordProblem(pw);
  if (bad) throw new HttpError(400, bad, 'weak_password');
}

export async function addUser(p: Principal, i: { name: string; email: string; role: StaffRole; password: string }) {
  checkPassword(i.password);
  const email = i.email.trim().toLowerCase();
  const name = i.name.trim().replace(/\s+/g, ' ');
  const d = db();
  const [dupe] = await d.select({ id: schema.staff.id }).from(schema.staff).where(eq(schema.staff.email, email)).limit(1);
  if (dupe) throw new HttpError(409, 'Someone on the team already uses that email.', 'conflict');
  const [row] = await d
    .insert(schema.staff)
    .values({ name, email, role: i.role, active: true, mustChangePassword: true, passwordHash: await hashPassword(i.password) })
    .returning({ id: schema.staff.id, name: schema.staff.name, role: schema.staff.role, email: schema.staff.email });
  await logActivity(p.id, 'Added a user', `${row.name} · ${roleLabel(i.role)}`);
  return row;
}

async function getMember(id: number) {
  const [s] = await db().select().from(schema.staff).where(eq(schema.staff.id, id)).limit(1);
  if (!s) throw new HttpError(404, 'That person was not found.', 'not_found');
  return s;
}

/** Would this change leave the system without an active owner?
    Runs inside the caller's transaction, after an advisory lock, so two owners
    demoting each other at the same moment cannot both pass the check. */
type Tx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];
async function guardLastOwner(tx: Tx, id: number) {
  await tx.execute(sql`select pg_advisory_xact_lock(7417001)`);
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.staff)
    .where(and(eq(schema.staff.role, 'owner'), eq(schema.staff.active, true), ne(schema.staff.id, id)));
  if (n === 0) throw new HttpError(409, 'There must always be at least one active owner. Make someone else an owner first.', 'last_owner');
}

export async function setRole(p: Principal, id: number, role: StaffRole) {
  const s = await getMember(id);
  if (s.role === role) return { ok: true };
  await db().transaction(async (tx) => {
    if (s.role === 'owner' && s.active) await guardLastOwner(tx, id);
    await tx.update(schema.staff).set({ role }).where(eq(schema.staff.id, id));
  });
  // a demotion takes effect now, not when the current access token runs out
  if (ROLE_RANK[role] < ROLE_RANK[s.role as StaffRole]) await revokeAllFor('staff', id);
  await logActivity(p.id, 'Role changed', `${s.name} · ${roleLabel(s.role as StaffRole)} → ${roleLabel(role)}`);
  return { ok: true, prev: s.role };
}

export async function setActive(p: Principal, id: number, active: boolean) {
  const s = await getMember(id);
  if (s.active === active) return { ok: true };
  await db().transaction(async (tx) => {
    if (!active && s.role === 'owner') await guardLastOwner(tx, id);
    await tx.update(schema.staff).set({ active, failedLogins: 0, lockedUntil: null }).where(eq(schema.staff.id, id));
  });
  if (!active) await revokeAllFor('staff', id);
  await logActivity(p.id, active ? 'User reactivated' : 'User deactivated', s.name);
  return { ok: true };
}

export async function resetPassword(p: Principal, id: number, password: string) {
  if (id === p.id) throw new HttpError(400, 'Use Change password for your own account.', 'self');
  checkPassword(password);
  const s = await getMember(id);
  await db()
    .update(schema.staff)
    .set({ passwordHash: await hashPassword(password), mustChangePassword: true, failedLogins: 0, lockedUntil: null })
    .where(eq(schema.staff.id, id));
  await revokeAllFor('staff', id);
  await logActivity(p.id, 'Password reset', `${s.name} · must choose a new one at sign-in`);
  return { ok: true };
}
