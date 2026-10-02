import 'server-only';
import { env } from '@/lib/server/env';
import { asc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/server/db';
import { HttpError, revokeAllFor } from '@/lib/server/auth';
import { hashPassword, newCode } from '@/lib/server/password';
import { logActivity } from '@/lib/server/audit';
import { invalidate, TAG } from '@/lib/server/cache';
import { daysBetween, todayISO } from '@/lib/shared/dates';

/* ═══ Student and parent app accounts ═════════════════════════════════
   No password is ever stored or shown. A sign-in code is minted here, shown
   ONCE to the staff member, and stored only as an argon2 hash with an expiry.
   Nothing can read it back. Lock, sign-out and remove revoke every live
   session, so they bite within seconds (the original only recorded them). */

type Who = { id: number; name: string };

/** Code life, minutes: CODE_TTL_MINUTES (validated in env.ts), a day by default, kept within 5 min – 7 days. */
function ttlMinutes() {
  return Math.min(10080, Math.max(5, env().CODE_TTL_MINUTES));
}

async function freshCode() {
  const code = newCode();
  return { code, hash: await hashPassword(code), expires: new Date(Date.now() + ttlMinutes() * 60_000) };
}

const QUIET_AT = 14;

/** The Access tab: stats, quiet list, the roster, and who can still be given a login. */
export async function accessPage() {
  const d = db();
  const [logins, students] = await Promise.all([
    d
      .select({
        id: schema.appLogins.id,
        studentId: schema.appLogins.studentId,
        username: schema.appLogins.username,
        status: schema.appLogins.status,
        lastActive: schema.appLogins.lastActive,
        sessions: schema.appLogins.sessions,
        failed: schema.appLogins.failed,
        codeExpires: schema.appLogins.codeExpires,
      })
      .from(schema.appLogins)
      .orderBy(asc(schema.appLogins.username)),
    d
      .select({
        id: schema.students.id,
        name: schema.students.name,
        co: schema.students.co,
        program: schema.students.program,
        cohort: schema.students.cohort,
        phone: schema.students.phone,
        status: schema.students.status,
      })
      .from(schema.students)
      .orderBy(asc(schema.students.name)),
  ]);
  const byId = new Map(students.map((s) => [s.id, s]));
  const today = todayISO();
  const rows = logins.map((l) => {
    const s = byId.get(l.studentId);
    return {
      ...l,
      name: s?.name ?? '(student record missing)',
      co: s?.co ?? '',
      program: s?.program ?? '',
      cohort: s?.cohort ?? 0,
      phone: s?.phone ?? '',
      // derived at read time, never stored
      quietDays: l.lastActive ? daysBetween(l.lastActive, today) : null,
    };
  });
  const roster = students.filter((s) => s.status === 'active');
  const have = new Set(logins.map((l) => l.studentId));
  return {
    stats: {
      roster: roster.length,
      signingIn: logins.filter((l) => l.status === 'active').length,
      never: logins.filter((l) => !l.lastActive).length,
      noAccount: Math.max(0, roster.length - logins.length),
      locked: logins.filter((l) => l.status === 'locked').length,
      logins: logins.length,
    },
    quiet: rows
      .filter((l) => l.status === 'active' && l.quietDays !== null && l.quietDays >= QUIET_AT)
      .sort((a, b) => (b.quietDays ?? 0) - (a.quietDays ?? 0)),
    logins: rows,
    withoutLogin: roster.filter((s) => !have.has(s.id)).slice(0, 80).map((s) => ({ id: s.id, name: s.name, co: s.co || s.program })),
    active: roster.map((s) => ({ id: s.id, name: s.name })),
  };
}

/* ── student logins ─────────────────────────────────────────────────── */

/** Username = first name; taken (case-insensitive) → Amaya2, Amaya3 … */
async function freeUsername(name: string) {
  const first = (name.trim().split(/\s+/)[0] || 'Student').replace(/[^\p{L}\p{N}'-]/gu, '') || 'Student';
  const taken = await db()
    .select({ u: sql<string>`lower(${schema.appLogins.username})` })
    .from(schema.appLogins)
    .where(sql`lower(${schema.appLogins.username}) like ${first.toLowerCase() + '%'}`);
  const set = new Set(taken.map((t) => t.u));
  if (!set.has(first.toLowerCase())) return first;
  for (let n = 2; ; n++) if (!set.has(`${first}${n}`.toLowerCase())) return `${first}${n}`;
}

export async function createLogin(studentId: number, who: Who) {
  const d = db();
  const [st] = await d.select({ name: schema.students.name }).from(schema.students).where(eq(schema.students.id, studentId)).limit(1);
  if (!st) throw new HttpError(404, 'That student was not found.', 'not_found');
  const [ex] = await d.select({ id: schema.appLogins.id }).from(schema.appLogins).where(eq(schema.appLogins.studentId, studentId)).limit(1);
  if (ex) throw new HttpError(409, `${st.name.split(' ')[0]} already has access.`, 'conflict');
  const username = await freeUsername(st.name);
  await d.insert(schema.appLogins).values({ studentId, username, status: 'never', sessions: 0, failed: 0 });
  await logActivity(who.id, 'App access created', `${st.name} by ${who.name}`);
  return issueStudentCode(studentId, who);
}

/** Mint a code: hash + expiry stored, status active, failures cleared. Returned once. */
export async function issueStudentCode(studentId: number, who: Who) {
  const d = db();
  const [l] = await d.select().from(schema.appLogins).where(eq(schema.appLogins.studentId, studentId)).limit(1);
  if (!l) throw new HttpError(404, 'Create their access first.', 'not_found');
  const [st] = await d.select({ name: schema.students.name }).from(schema.students).where(eq(schema.students.id, studentId)).limit(1);
  const c = await freshCode();
  await d
    .update(schema.appLogins)
    .set({ codeHash: c.hash, codeExpires: c.expires, status: 'active', failed: 0 })
    .where(eq(schema.appLogins.id, l.id));
  await logActivity(who.id, 'Issued an app code', st?.name ?? l.username);
  return { code: c.code, expiresAt: c.expires.toISOString(), username: l.username, name: st?.name ?? l.username };
}

async function loginRow(id: number) {
  const [l] = await db().select().from(schema.appLogins).where(eq(schema.appLogins.id, id)).limit(1);
  if (!l) throw new HttpError(404, 'That login was not found.', 'not_found');
  const [st] = await db().select({ name: schema.students.name }).from(schema.students).where(eq(schema.students.id, l.studentId)).limit(1);
  return { l, name: st?.name ?? '(student record missing)' };
}

export async function lockLogin(id: number, on: boolean, who: Who) {
  const { l, name } = await loginRow(id);
  const status = on ? 'locked' : l.lastActive ? 'active' : 'never';
  await db()
    .update(schema.appLogins)
    .set(on ? { status } : { status, failed: 0 })
    .where(eq(schema.appLogins.id, id));
  if (on) await revokeAllFor('student', l.studentId);
  await logActivity(who.id, on ? 'Account locked' : 'Account unlocked', `${name} · was ${l.status} · by ${who.name}`);
  return { username: l.username, status, lastActive: l.lastActive };
}

export async function signOutLogin(id: number, who: Who) {
  const { l, name } = await loginRow(id);
  await revokeAllFor('student', l.studentId);
  await db().update(schema.appLogins).set({ sessions: 0 }).where(eq(schema.appLogins.id, id));
  await logActivity(who.id, 'Signed out of all devices', `${name} · by ${who.name}`);
  return { username: l.username };
}

export async function removeLogin(id: number, who: Who) {
  const { l, name } = await loginRow(id);
  await revokeAllFor('student', l.studentId);
  await db().delete(schema.appLogins).where(eq(schema.appLogins.id, id));
  await logActivity(who.id, 'App access removed', `${name} · by ${who.name}`);
  await invalidate(TAG.student(l.studentId));
  return { name };
}

/* ── parent logins ──────────────────────────────────────────────────── */

export async function parentsList() {
  return db()
    .select({
      id: schema.parentLogins.id,
      studentId: schema.parentLogins.studentId,
      child: schema.students.name,
      label: schema.parentLogins.label,
      status: schema.parentLogins.status,
      active: schema.parentLogins.active,
      lastActive: schema.parentLogins.lastActive,
      sessions: schema.parentLogins.sessions,
      codeExpires: schema.parentLogins.codeExpires,
    })
    .from(schema.parentLogins)
    .innerJoin(schema.students, eq(schema.students.id, schema.parentLogins.studentId))
    .orderBy(asc(schema.parentLogins.id));
}

/** {studentId,label} makes a NEW account (two parents = two rows); {parentId} re-issues. */
export async function issueParentCode(i: { parentId?: number; studentId?: number; label?: string }, who: Who) {
  const d = db();
  let row: typeof schema.parentLogins.$inferSelect | undefined;
  if (i.parentId) {
    [row] = await d.select().from(schema.parentLogins).where(eq(schema.parentLogins.id, i.parentId)).limit(1);
    if (!row) throw new HttpError(404, 'No such parent account', 'not_found');
  } else {
    if (!i.studentId) throw new HttpError(400, 'Which student?', 'invalid');
    const [st] = await d.select({ id: schema.students.id }).from(schema.students).where(eq(schema.students.id, i.studentId)).limit(1);
    if (!st) throw new HttpError(404, 'No such student', 'not_found');
    const label = (i.label ?? '').trim().slice(0, 24) || 'Parent';
    [row] = await d.insert(schema.parentLogins).values({ studentId: i.studentId, label }).returning();
  }
  const [kid] = await d.select({ name: schema.students.name }).from(schema.students).where(eq(schema.students.id, row.studentId)).limit(1);
  const c = await freshCode();
  // re-issuing unlocks: the new code is the way back in
  await d
    .update(schema.parentLogins)
    .set({ codeHash: c.hash, codeExpires: c.expires, failed: 0, status: 'active', active: true })
    .where(eq(schema.parentLogins.id, row.id));
  await logActivity(who.id, 'Issued a parent code', `${row.label} of ${kid?.name ?? ''}`);
  return { code: c.code, expiresAt: c.expires.toISOString(), parentId: row.id, label: row.label, child: kid?.name ?? '' };
}

async function parentRow(id: number) {
  const [p] = await db().select().from(schema.parentLogins).where(eq(schema.parentLogins.id, id)).limit(1);
  if (!p) throw new HttpError(404, 'No such parent account', 'not_found');
  const [kid] = await db().select({ name: schema.students.name }).from(schema.students).where(eq(schema.students.id, p.studentId)).limit(1);
  return { p, child: kid?.name ?? `Student ${p.studentId}` };
}

export async function lockParent(id: number, on: boolean, who: Who) {
  const { child } = await parentRow(id);
  await db()
    .update(schema.parentLogins)
    .set({ status: on ? 'locked' : 'active', failed: 0 })
    .where(eq(schema.parentLogins.id, id));
  if (on) await revokeAllFor('parent', id);
  await logActivity(who.id, on ? 'Locked a parent account' : 'Unlocked a parent account', child);
}

export async function removeParent(id: number, who: Who) {
  const { p, child } = await parentRow(id);
  await revokeAllFor('parent', id);
  await db().delete(schema.parentLogins).where(eq(schema.parentLogins.id, id));
  await logActivity(who.id, 'Removed parent access', `${p.label} of ${child}`);
}
