import 'server-only';
import { and, asc, desc, eq, getTableColumns, gte, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@/lib/server/db';
import { HttpError, type Principal } from '@/lib/server/auth';
import { cacheGet, cacheSet, invalidate, TAG } from '@/lib/server/cache';
import { logActivity } from '@/lib/server/audit';
import { notFound } from '@/lib/server/api';
import { can } from '@/lib/shared/rbac';
import { recordsScope, studentsScope, tasksScope } from '@/server/scope';
import { getStudio } from '@/server/config';
import {
  BSWL_PROGRAMS,
  CFG,
  COHORT_SHORT,
  LOC_LABEL,
  LOCS,
  PROG_LABEL,
  SL_PHONE,
  TASK_ARCHIVE_DAYS,
  bswlFee,
  lkr,
} from '@/lib/shared/constants';
import { daysBetween, dPlus, monthShort, todayISO, ymNow, ymShift } from '@/lib/shared/dates';

/* The CRM core: enquiries (records), enrolment, students and the Task Book.
   Ported from the original openRecord / ENROL / openCustomer / task functions.
   One student is two rows (students + recurring_plans, same id) — every
   write that touches one touches the other in the same transaction. */

type Act = { t: string; m: string; at: string; by?: string };
type Tx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];

const act = (p: Principal, t: string, m: string): Act => ({ t, m, at: new Date().toISOString(), by: p.name });

/* ═══ input schemas ═════════════════════════════════════════════════════ */

const phoneOk = (s: string) => !s || SL_PHONE.test(s.replace(/[\s-]/g, ''));
const cohortIdx = z.coerce.number().int().min(0).max(CFG.cohorts.length - 1);
const program = z.enum(BSWL_PROGRAMS);
const loc = z.enum(LOCS as [string, ...string[]]);
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const RecordInput = z.object({
  name: z.string().trim().min(1, 'Please enter a name.').max(120),
  batch: cohortIdx,
  prog: program,
  school: z.string().trim().max(120).optional().default(''),
  phone: z.string().trim().max(30).refine(phoneOk, 'Enter a valid Sri Lankan number.').default(''),
  stage: z.string().min(1).max(20),
  owner: z.coerce.number().int().positive().optional(),
  followUp: isoDay.or(z.literal('')).optional().default(''),
});

export const EnrolInput = z.object({
  cohort: cohortIdx,
  loc,
  program,
  confirmDuplicate: z.boolean().optional(),
});
export const ManualEnrolInput = EnrolInput.extend({
  name: z.string().trim().min(1, 'A student needs a name.').max(120),
  phone: z.string().trim().max(30).optional().default(''),
});

export const StudentEdit = z.object({
  name: z.string().trim().min(1, 'A student needs a name.').max(120),
  phone: z.string().trim().max(30),
  cohort: cohortIdx,
  program,
  loc,
});

const taskFields = {
  t: z.string().trim().min(1, 'Please describe the task.').max(300),
  who: z.coerce.number().int().positive(),
  due: isoDay.or(z.literal('')),
  dueTime: z.string().regex(/^\d{2}:\d{2}$/).or(z.literal('')),
  note: z.string().trim().max(500),
};
export const TaskInput = z.object({
  t: taskFields.t,
  who: taskFields.who.optional(),
  due: taskFields.due.optional().default(''),
  dueTime: taskFields.dueTime.optional().default(''),
  note: taskFields.note.optional().default(''),
});
/** Partial update — no defaults, so a missing field is left alone. */
export const TaskPatch = z.object({
  t: taskFields.t.optional(),
  who: taskFields.who.optional(),
  due: taskFields.due.optional(),
  dueTime: taskFields.dueTime.optional(),
  note: taskFields.note.optional(),
  d: z.boolean().optional(),
});

/* ═══ shared helpers ════════════════════════════════════════════════════ */

async function stagesCfg() {
  const s = await getStudio();
  return s.stages;
}

async function activeStaffIds() {
  const rows = await db().select({ id: schema.staff.id }).from(schema.staff).where(eq(schema.staff.active, true));
  return new Set(rows.map((r) => r.id));
}

/** A 'staff' user can only hand work to themselves; masters may pick any active person.
    Keeping the row's current owner is always allowed, so a row whose owner has since
    been deactivated can still be edited without being reassigned. */
async function resolveOwner(p: Principal, wanted: number | undefined, viewAllPerm: 'enquiries.view.all' | 'tasks.view.all', current?: number | null) {
  if (!can(p.role, viewAllPerm)) return p.id;
  if (!wanted) return p.id;
  if (wanted === current) return wanted;
  if (!(await activeStaffIds()).has(wanted)) throw new HttpError(400, 'Pick an active team member.', 'invalid');
  return wanted;
}

/* ═══ fees maths (the original recStats / recMonthsOwed) ═══════════════ */

type Plan = { id: number; name: string; cohort: number; fee: number | null; joined: string | null; status: string; phone: string };
type PayMap = Map<number, Map<string, number>>; // planId → month → paid

async function feeDefault() {
  return (await getStudio()).recurring.amount;
}

async function loadPlans(): Promise<Plan[]> {
  return db()
    .select({
      id: schema.recurringPlans.id,
      name: schema.recurringPlans.name,
      cohort: schema.recurringPlans.cohort,
      fee: schema.recurringPlans.fee,
      joined: schema.recurringPlans.joined,
      status: schema.recurringPlans.status,
      phone: schema.recurringPlans.phone,
    })
    .from(schema.recurringPlans);
}

async function loadPayments(fromYm: string, planIds?: number[]) {
  const where = planIds
    ? and(gte(schema.recurringPayments.month, fromYm), inArray(schema.recurringPayments.planId, planIds.length ? planIds : [-1]))
    : gte(schema.recurringPayments.month, fromYm);
  const rows = await db()
    .select({ planId: schema.recurringPayments.planId, month: schema.recurringPayments.month, amount: schema.recurringPayments.amount })
    .from(schema.recurringPayments)
    .where(where);
  const map: PayMap = new Map();
  const byMonth = new Map<string, number>();
  for (const r of rows) {
    const m = map.get(r.planId) ?? new Map<string, number>();
    m.set(r.month, (m.get(r.month) ?? 0) + r.amount);
    map.set(r.planId, m);
    byMonth.set(r.month, (byMonth.get(r.month) ?? 0) + r.amount);
  }
  return { map, byMonth };
}

const chargedIn = (p: Plan, ym: string) => p.status === 'active' && (!p.joined || p.joined.slice(0, 7) <= ym);
const paidIn = (pay: PayMap, id: number, ym: string) => pay.get(id)?.get(ym) ?? 0;

function monthsOwed(p: Plan, pay: PayMap, ym: string, dflt: number) {
  let n = 0;
  let owed = 0;
  let m = ym;
  const fee = p.fee ?? dflt;
  for (let i = 0; i < 24; i++) {
    if (!chargedIn(p, m)) break;
    const got = paidIn(pay, p.id, m);
    if (got >= fee) break;
    n++;
    owed += fee - got;
    m = ymShift(m, -1);
  }
  return { n, owed };
}

function recStats(plans: Plan[], pay: PayMap, byMonth: Map<string, number>, ym: string, dflt: number) {
  let expected = 0;
  let outstanding = 0;
  const owing: { p: Plan; got: number; due: number }[] = [];
  const partial: { p: Plan; got: number; due: number }[] = [];
  for (const p of plans) {
    if (!chargedIn(p, ym)) continue;
    const due = p.fee ?? dflt;
    const got = paidIn(pay, p.id, ym);
    expected += due;
    if (got >= due) continue;
    if (got > 0) {
      partial.push({ p, got, due });
      outstanding += due - got;
    } else {
      owing.push({ p, got, due });
      outstanding += due;
    }
  }
  return { expected, outstanding, owing, partial, collected: byMonth.get(ym) ?? 0 };
}

/* ═══ dashboard (the live fees dashboard, original line 9320) ══════════ */

export async function dashboard(p: Principal) {
  const ym = ymNow();
  const today = todayISO();
  const d = db();
  const dflt = await feeDefault();
  const [plans, { map, byMonth }, openRecs, [online]] = await Promise.all([
    loadPlans(),
    loadPayments(ymShift(ym, -30)), // 24-month owed loop + 6-month chart
    d
      .select({ id: schema.records.id, name: schema.records.name, co: schema.records.co, followUp: schema.records.followUp, value: schema.records.value })
      .from(schema.records)
      .where(and(sql`${schema.records.stage} not in ('won','lost')`, recordsScope(p))),
    d
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.students)
      .where(and(eq(schema.students.status, 'active'), eq(schema.students.loc, 'Online'))),
  ]);
  const st = recStats(plans, map, byMonth, ym, dflt);
  const prev = recStats(plans, map, byMonth, ymShift(ym, -1), dflt);
  const due = openRecs.filter((r) => r.followUp && r.followUp <= today).sort((a, b) => (a.followUp! < b.followUp! ? -1 : 1));

  const chart = [];
  for (let i = 5; i >= 0; i--) {
    const m = ymShift(ym, -i);
    chart.push({ ym: m, v: byMonth.get(m) ?? 0 });
  }
  const owe = [...st.owing, ...st.partial]
    .sort((a, b) => b.due - b.got - (a.due - a.got))
    .slice(0, 5)
    .map((x) => ({ id: x.p.id, name: x.p.name, cohort: x.p.cohort, owes: x.due - x.got, partial: x.got > 0 }));

  // fee money and debtor names only for roles that handle fees; a Sales user
  // sees their own enquiries and tasks, as on every other page
  const fees = can(p.role, 'fees.manage');
  if (!fees) {
    chart.length = 0;
    owe.length = 0;
  }
  return {
    ym,
    fees,
    collected: fees ? st.collected : 0,
    expected: fees ? st.expected : 0,
    outstanding: fees ? st.outstanding : 0,
    toPay: fees ? st.owing.length + st.partial.length : 0,
    prevOutstanding: fees ? prev.outstanding : 0,
    prevPay: fees ? prev.owing.length + prev.partial.length : 0,
    online: online.n,
    openEnquiries: openRecs.length,
    dueToday: due.length,
    chart,
    owe,
    followUps: due.slice(0, 5).map((r) => ({ id: r.id, name: r.name, co: r.co, followUp: r.followUp })),
    tasks: (await listTasks(p)).tasks.slice(0, 4),
  };
}

/* ═══ enquiries ═════════════════════════════════════════════════════════ */

export async function listRecords(p: Principal, ownerFilter: string | null) {
  const own = can(p.role, 'enquiries.view.all') && ownerFilter && ownerFilter !== 'all' ? eq(schema.records.owner, Number(ownerFilter) || -1) : undefined;
  return db()
    .select({ ...getTableColumns(schema.records), studentName: schema.students.name })
    .from(schema.records)
    .leftJoin(schema.students, eq(schema.students.id, schema.records.studentId))
    .where(and(recordsScope(p), own))
    .orderBy(sql`${schema.records.value} desc nulls last`, desc(schema.records.id));
}

export async function getRecord(p: Principal, id: number, tx: Tx | ReturnType<typeof db> = db()) {
  const [r] = await tx
    .select()
    .from(schema.records)
    .where(and(eq(schema.records.id, id), recordsScope(p)))
    .limit(1);
  if (!r) throw notFound('That enquiry');
  return r;
}

async function checkStage(k: string, allowLost = false) {
  const st = (await stagesCfg()).find((s) => s.k === k);
  if (!st || (st.terminal === 'lost' && !allowLost)) throw new HttpError(400, 'Unknown stage.', 'invalid');
  return st;
}

export async function createRecord(p: Principal, i: z.infer<typeof RecordInput>) {
  await checkStage(i.stage);
  const owner = await resolveOwner(p, i.owner, 'enquiries.view.all');
  const fee = bswlFee(i.prog, i.batch);
  const [r] = await db()
    .insert(schema.records)
    .values({
      name: i.name,
      co: `${CFG.cohorts[i.batch]} · ${i.prog}`,
      batch: i.batch,
      prog: i.prog,
      school: i.school || null,
      phone: i.phone,
      stage: i.stage,
      owner,
      value: fee,
      followUp: i.followUp || null,
      createdOn: todayISO(),
      acts: [act(p, 'Created', `Added by ${p.name}`)],
    })
    .returning();
  return r;
}

export async function updateRecord(p: Principal, id: number, i: z.infer<typeof RecordInput>) {
  const r = await getRecord(p, id);
  await checkStage(i.stage, i.stage === r.stage); // a lost enquiry can be edited without reopening it
  const owner = await resolveOwner(p, i.owner ?? r.owner ?? undefined, 'enquiries.view.all', r.owner);
  const [out] = await db()
    .update(schema.records)
    .set({
      name: i.name,
      co: `${CFG.cohorts[i.batch]} · ${i.prog}`,
      batch: i.batch,
      prog: i.prog,
      school: i.school || null,
      phone: i.phone,
      stage: i.stage,
      owner,
      value: bswlFee(i.prog, i.batch),
      followUp: i.followUp || null,
      acts: [act(p, 'Updated', 'Details edited'), ...r.acts],
      updatedAt: new Date(),
    })
    .where(eq(schema.records.id, id))
    .returning();
  return out;
}

/** Board drag. `undo` reverses the last move (drops its act) instead of logging a new one. */
export async function moveStage(p: Principal, id: number, stage: string, undo: boolean) {
  const r = await getRecord(p, id);
  if (r.stage === stage) return r;
  const stages = await stagesCfg();
  const label = (k: string) => stages.find((s) => s.k === k)?.label ?? k;
  await checkStage(stage, undo);
  let acts = r.acts;
  let rev = r.rev;
  if (undo) {
    if (acts[0]?.t === 'Stage moved') acts = acts.slice(1);
  } else {
    acts = [act(p, 'Stage moved', `${label(r.stage)} → ${label(stage)}`), ...acts];
    if (stages.find((s) => s.k === stage)?.terminal === 'won' && !rev && r.value) rev = { [ymNow()]: r.value };
  }
  const [out] = await db().update(schema.records).set({ stage, acts, rev, updatedAt: new Date() }).where(eq(schema.records.id, id)).returning();
  return out;
}

export async function addAct(p: Principal, id: number, t: string, m: string) {
  const r = await getRecord(p, id);
  const [out] = await db()
    .update(schema.records)
    .set({ acts: [act(p, t, m), ...r.acts], updatedAt: new Date() })
    .where(eq(schema.records.id, id))
    .returning();
  return out;
}

export async function markWon(p: Principal, id: number) {
  const r = await getRecord(p, id);
  const stages = await stagesCfg();
  const won = stages.find((s) => s.terminal === 'won');
  if (!won) throw new HttpError(400, 'No won stage configured.', 'invalid');
  if (r.stage === won.k) return { record: r, prev: r.stage };
  const [out] = await db()
    .update(schema.records)
    .set({
      stage: won.k,
      rev: !r.rev && r.value ? { [ymNow()]: r.value } : r.rev,
      acts: [act(p, 'Deal won', `Moved to ${won.label}`), ...r.acts],
      updatedAt: new Date(),
    })
    .where(eq(schema.records.id, id))
    .returning();
  await logActivity(p.id, 'Deal won', r.name + (r.value ? ` · ${lkr(r.value)}` : ''));
  return { record: out, prev: r.stage };
}

/* Undoing a win also takes back the student it created — a billable student
   left behind by an undone win is the worse bug. Refused once money exists. */
export async function undoWon(p: Principal, id: number, prev: string) {
  // prev = won comes from a repeated Mark won; "undoing" to won would only delete the student
  if ((await checkStage(prev)).terminal) throw new HttpError(400, 'Unknown stage.', 'invalid');
  let removed: number | null = null;
  const out = await db().transaction(async (tx) => {
    const r = await getRecord(p, id, tx);
    if (r.stage !== 'won') throw new HttpError(409, 'That enquiry is not marked won.', 'not_won');
    // drop the most recent 'Deal won' (an enrol act may sit above it)
    const wonAt = r.acts.findIndex((a) => a.t === 'Deal won');
    let acts = wonAt < 0 ? r.acts : r.acts.filter((_, i) => i !== wonAt);
    if (r.studentId) {
      removed = r.studentId;
      const n = await paymentCount(tx, r.studentId);
      if (n) throw new HttpError(409, 'A payment is already recorded for this student, so the win stays.', 'has_payments');
      await tx.delete(schema.students).where(eq(schema.students.id, r.studentId));
      acts = acts.filter((a) => a.t !== 'Enrolled as a student');
    }
    const [out] = await tx
      .update(schema.records)
      .set({ stage: prev, acts, studentId: null, updatedAt: new Date() })
      .where(eq(schema.records.id, id))
      .returning();
    return out;
  });
  if (removed) await invalidate(TAG.student(removed));
  return out;
}

export async function markLost(p: Principal, id: number, reason: string) {
  const r = await getRecord(p, id);
  const lost = (await stagesCfg()).find((s) => s.terminal === 'lost');
  if (!lost) throw new HttpError(400, 'No lost stage configured.', 'invalid');
  // a second tap would log a second 'Marked lost' and hand back prev = lost, which Undo cannot use
  if (r.stage === lost.k) throw new HttpError(409, `${r.name} is already marked lost.`, 'already_lost');
  const [out] = await db()
    .update(schema.records)
    .set({ stage: lost.k, lostReason: reason, acts: [act(p, 'Marked lost', reason), ...r.acts], updatedAt: new Date() })
    .where(eq(schema.records.id, id))
    .returning();
  await logActivity(p.id, 'Marked lost', `${r.name} · ${reason}`);
  return { record: out, prev: r.stage };
}

export async function undoLost(p: Principal, id: number, prev: string) {
  await checkStage(prev);
  const r = await getRecord(p, id);
  const acts = r.acts[0]?.t === 'Marked lost' ? r.acts.slice(1) : r.acts;
  const [out] = await db()
    .update(schema.records)
    .set({ stage: prev, lostReason: null, acts, updatedAt: new Date() })
    .where(eq(schema.records.id, id))
    .returning();
  return out;
}

/* ═══ enrolment (ENROL.save) ════════════════════════════════════════════ */

async function duplicateActive(tx: Tx, name: string) {
  const [dup] = await tx
    .select({ id: schema.students.id })
    .from(schema.students)
    .where(and(sql`lower(${schema.students.name}) = lower(${name})`, eq(schema.students.status, 'active')))
    .limit(1);
  return !!dup;
}

async function insertStudent(
  tx: Tx,
  s: { name: string; phone: string; cohort: number; loc: string; program: string; owner: number; school?: string | null },
) {
  const fee = bswlFee(s.program, s.cohort);
  const today = todayISO();
  const [c] = await tx
    .insert(schema.students)
    .values({
      name: s.name,
      phone: s.phone,
      email: '',
      program: s.program,
      cohort: s.cohort,
      loc: s.loc,
      co: LOC_LABEL[s.loc] ?? s.loc,
      joined: today,
      status: 'active',
      level: 'okay',
      fee,
      owner: s.owner,
      lastSeen: today,
      sent: 0,
      school: s.school || null,
      history: [],
    })
    .returning();
  /* THE FEE LEDGER SHARES THE STUDENT'S ID — a fresh id would be a student never billed. */
  await tx.insert(schema.recurringPlans).values({
    id: c.id,
    name: c.name,
    phone: c.phone,
    cohort: c.cohort,
    program: c.program,
    loc: c.loc,
    fee,
    joined: today,
    status: 'active',
  });
  return c;
}

function enrolMsg(name: string, program: string, l: string, fee: number | null) {
  return `${name} · ${program} · ${LOC_LABEL[l] ?? l} · ${lkr(fee)}/month`;
}

export async function enrolFromRecord(p: Principal, id: number, i: z.infer<typeof EnrolInput>) {
  const out = await db().transaction(async (tx) => {
    const r = await getRecord(p, id, tx);
    // lock the row so two clicks cannot enrol one enquiry twice
    await tx.execute(sql`select 1 from ${schema.records} where id = ${id} for update`);
    const [fresh] = await tx.select({ studentId: schema.records.studentId }).from(schema.records).where(eq(schema.records.id, id));
    if (fresh?.studentId) {
      const [s] = await tx.select({ name: schema.students.name }).from(schema.students).where(eq(schema.students.id, fresh.studentId));
      throw new HttpError(409, `Already enrolled as ${s?.name ?? 'a student'}.`, 'already_enrolled');
    }
    if (!i.confirmDuplicate && (await duplicateActive(tx, r.name))) {
      throw new HttpError(409, `${r.name} is already an active student. Add a second record anyway?`, 'duplicate');
    }
    const c = await insertStudent(tx, {
      name: r.name,
      phone: r.phone,
      cohort: i.cohort,
      loc: i.loc,
      program: i.program,
      owner: r.owner ?? p.id,
      school: r.school,
    });
    await tx
      .update(schema.records)
      .set({
        studentId: c.id,
        acts: [act(p, 'Enrolled as a student', `${r.name} · ${i.program} · ${LOC_LABEL[i.loc] ?? i.loc}`), ...r.acts],
        updatedAt: new Date(),
      })
      .where(eq(schema.records.id, id));
    return c;
  });
  await invalidate(TAG.student(out.id));
  await logActivity(p.id, 'Student enrolled', enrolMsg(out.name, out.program, out.loc, out.fee));
  return out;
}

export async function enrolManual(p: Principal, i: z.infer<typeof ManualEnrolInput>) {
  const out = await db().transaction(async (tx) => {
    if (!i.confirmDuplicate && (await duplicateActive(tx, i.name))) {
      throw new HttpError(409, `${i.name} is already an active student. Add a second record anyway?`, 'duplicate');
    }
    return insertStudent(tx, { name: i.name, phone: i.phone, cohort: i.cohort, loc: i.loc, program: i.program, owner: p.id });
  });
  await invalidate(TAG.student(out.id));
  await logActivity(p.id, 'Student enrolled', enrolMsg(out.name, out.program, out.loc, out.fee));
  return out;
}

/* ═══ students ══════════════════════════════════════════════════════════ */

type Hist = { item: string; date: string; value: number };

async function paymentCount(tx: Tx | ReturnType<typeof db>, id: number) {
  const [a] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.recurringPayments)
    .where(eq(schema.recurringPayments.planId, id));
  const [s] = await tx.select({ h: schema.students.history }).from(schema.students).where(eq(schema.students.id, id));
  return (a?.n ?? 0) + (s?.h?.length ?? 0);
}

/** The fee history the panel shows: the legacy `history` plus every recorded payment. */
function mergedHistory(history: Hist[], pays: { month: string; amount: number; paidAt: string | null }[], label: string): Hist[] {
  return [
    ...history.map((h) => ({ item: h.item, date: h.date, value: h.value })),
    ...pays.map((x) => ({ item: `${label} · ${monthShort(x.month)}`, date: x.paidAt ?? `${x.month}-01`, value: x.amount })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export async function listStudents(p: Principal) {
  const d = db();
  const studio = await getStudio();
  const ym = ymNow();
  const rows = await d.select().from(schema.students).where(studentsScope(p)).orderBy(asc(schema.students.name));
  const ids = rows.map((r) => r.id);
  const plans = ids.length ? (await loadPlans()).filter((x) => ids.includes(x.id)) : [];
  const { map } = await loadPayments('0000-00', ids);
  const allPays = ids.length
    ? await d
        .select({ planId: schema.recurringPayments.planId, month: schema.recurringPayments.month, amount: schema.recurringPayments.amount, paidAt: schema.recurringPayments.paidAt })
        .from(schema.recurringPayments)
        .where(inArray(schema.recurringPayments.planId, ids))
    : [];
  const paysBy = new Map<number, typeof allPays>();
  for (const x of allPays) paysBy.set(x.planId, [...(paysBy.get(x.planId) ?? []), x]);
  const planBy = new Map(plans.map((x) => [x.id, x]));

  return rows.map((s) => {
    const hist = mergedHistory(s.history ?? [], paysBy.get(s.id) ?? [], studio.recurring.label);
    const plan = planBy.get(s.id);
    const owed = plan ? monthsOwed(plan, map, ym, studio.recurring.amount) : null;
    return {
      id: s.id,
      name: s.name,
      phone: s.phone,
      co: s.co,
      cohort: s.cohort,
      program: s.program,
      loc: s.loc,
      status: s.status,
      level: s.level,
      owner: s.owner,
      sent: s.sent,
      snooze: s.snooze,
      last: s.lastSeen,
      joined: s.joined,
      ltv: hist.reduce((t, h) => t + h.value, 0),
      payments: hist.length,
      first: hist[0]?.date ?? null,
      plan: plan ? { phone: plan.phone, monthsOwed: owed!.n, owed: owed!.owed } : null,
    };
  });
}

async function getStudentRow(p: Principal, id: number, tx: Tx | ReturnType<typeof db> = db()) {
  const [s] = await tx
    .select()
    .from(schema.students)
    .where(and(eq(schema.students.id, id), studentsScope(p)))
    .limit(1);
  if (!s) throw notFound('That student');
  return s;
}

export async function studentDetail(p: Principal, id: number) {
  const s = await getStudentRow(p, id);
  const d = db();
  const studio = await getStudio();
  const [[plan], pays, att, [login], [rec]] = await Promise.all([
    d.select().from(schema.recurringPlans).where(eq(schema.recurringPlans.id, id)),
    d
      .select({ month: schema.recurringPayments.month, amount: schema.recurringPayments.amount, paidAt: schema.recurringPayments.paidAt })
      .from(schema.recurringPayments)
      .where(eq(schema.recurringPayments.planId, id)),
    d
      .select({
        total: sql<number>`count(*)::int`,
        present: sql<number>`count(*) filter (where ${schema.attendance.present})::int`,
        total30: sql<number>`count(*) filter (where ${schema.attendance.date} >= ${dPlus(todayISO(), -30)})::int`,
        present30: sql<number>`count(*) filter (where ${schema.attendance.present} and ${schema.attendance.date} >= ${dPlus(todayISO(), -30)})::int`,
        last: sql<string | null>`max(${schema.attendance.date}) filter (where ${schema.attendance.present})`,
      })
      .from(schema.attendance)
      .where(eq(schema.attendance.studentId, id)),
    d.select({ status: schema.appLogins.status }).from(schema.appLogins).where(eq(schema.appLogins.studentId, id)),
    d.select({ id: schema.records.id, name: schema.records.name }).from(schema.records).where(eq(schema.records.studentId, id)).limit(1),
  ]);
  const hist = mergedHistory(s.history ?? [], pays, studio.recurring.label);
  return {
    id: s.id,
    name: s.name,
    phone: s.phone,
    email: s.email,
    co: s.co,
    cohort: s.cohort,
    program: s.program,
    loc: s.loc,
    status: s.status,
    level: s.level,
    owner: s.owner,
    sent: s.sent,
    snooze: s.snooze,
    last: s.lastSeen,
    joined: s.joined,
    school: s.school,
    note: s.note ?? '',
    fee: plan ? plan.fee : s.fee,
    feeEffective: plan ? (plan.fee ?? studio.recurring.amount) : null,
    hasPlan: !!plan,
    history: hist,
    ltv: hist.reduce((t, h) => t + h.value, 0),
    paidCount: hist.length,
    attendance: att[0] ?? { total: 0, present: 0, total30: 0, present30: 0, last: null },
    appLogin: login?.status ?? null,
    enquiry: rec ?? null,
  };
}

export async function editStudent(p: Principal, id: number, i: z.infer<typeof StudentEdit>) {
  const res = await db().transaction(async (tx) => {
    const c = await getStudentRow(p, id, tx);
    const [pl] = await tx.select().from(schema.recurringPlans).where(eq(schema.recurringPlans.id, id));
    const was: string[] = [];
    if (c.name !== i.name) was.push(`name ${c.name} to ${i.name}`);
    if ((c.phone || '') !== i.phone) was.push('number');
    if (c.cohort !== i.cohort) was.push(`batch ${COHORT_SHORT[c.cohort]} to ${COHORT_SHORT[i.cohort]}`);
    if (c.program !== i.program) was.push(`class ${PROG_LABEL[c.program]} to ${PROG_LABEL[i.program]}`);
    if (c.loc !== i.loc) was.push('place');
    if (!was.length) return { changed: false as const };

    /* THE FEE FOLLOWS THE BATCH AND CLASS only while it is still the list
       price — a fee Leon agreed by hand is never overwritten. */
    const dflt = await feeDefault();
    const nowFee = pl ? (pl.fee ?? dflt) : c.fee;
    const oldList = bswlFee(c.program, c.cohort);
    const newList = bswlFee(i.program, i.cohort);
    const feeMoves = newList != null && oldList != null && nowFee === oldList && newList !== nowFee;

    await tx
      .update(schema.students)
      .set({
        name: i.name,
        phone: i.phone,
        cohort: i.cohort,
        program: i.program,
        loc: i.loc,
        co: LOC_LABEL[i.loc] ?? i.loc,
        ...(feeMoves ? { fee: newList } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.students.id, id));
    if (pl) {
      await tx
        .update(schema.recurringPlans)
        .set({ name: i.name, phone: i.phone, cohort: i.cohort, program: i.program, loc: i.loc, ...(feeMoves ? { fee: newList } : {}) })
        .where(eq(schema.recurringPlans.id, id));
    }
    return { changed: true as const, was, feeMoves, fee: feeMoves ? newList : null };
  });
  if (res.changed) await invalidate(TAG.student(id));
  if (res.changed) await logActivity(p.id, 'Student edited', `${i.name} · ${res.was.join(', ')} · by ${p.name}`);
  return res;
}

export async function setLevel(p: Principal, id: number, level: 'good' | 'okay' | 'bad') {
  await getStudentRow(p, id);
  await db().update(schema.students).set({ level, updatedAt: new Date() }).where(eq(schema.students.id, id));
  await invalidate(TAG.student(id));
}

/** Leon's private note — saved on blur, only when it changed. */
export async function setNote(p: Principal, id: number, note: string) {
  const s = await getStudentRow(p, id);
  const v = note.trim();
  if ((s.note ?? '') === v) return { changed: false, cleared: !v };
  await db().update(schema.students).set({ note: v || null, updatedAt: new Date() }).where(eq(schema.students.id, id));
  await invalidate(TAG.student(id));
  await logActivity(p.id, 'Student note', `${s.name} · by ${p.name}`);
  return { changed: true, cleared: !v };
}

export async function setStatus(p: Principal, id: number, status: 'active' | 'alumni') {
  const s = await getStudentRow(p, id);
  await db().transaction(async (tx) => {
    await tx.update(schema.students).set({ status, updatedAt: new Date() }).where(eq(schema.students.id, id));
    await tx.update(schema.recurringPlans).set({ status }).where(eq(schema.recurringPlans.id, id));
  });
  await invalidate(TAG.student(id));
  await logActivity(p.id, status === 'alumni' ? 'Student marked alumni' : 'Student reactivated', `${s.name} · by ${p.name}`);
}

/** Referral cadence: step done (custDone) or snooze 7 days (custSnooze). */
export async function cadence(p: Principal, id: number, op: 'done' | 'snooze') {
  const s = await getStudentRow(p, id);
  if (s.sent >= 3) return { label: null };
  const studio = await getStudio();
  const days = studio.cadence[s.sent] ?? [30, 60, 90][s.sent];
  const label = `${days}-day ${['check-in', 're-engage', 'offer'][s.sent]}`;
  if (op === 'snooze') {
    await db().update(schema.students).set({ snooze: dPlus(todayISO(), 7), updatedAt: new Date() }).where(eq(schema.students.id, id));
    return { label };
  }
  await db()
    .update(schema.students)
    .set({ sent: s.sent + 1, lastSeen: todayISO(), snooze: null, updatedAt: new Date() })
    .where(eq(schema.students.id, id));
  await logActivity(s.owner ?? p.id, `${label} sent`, `to ${s.name}`);
  return { label };
}

/* REMOVE — refused once money exists; otherwise the student, the plan and the
   app login go together. The rows are parked for 2 minutes so Undo can put
   them back (the snapshot never travels to the browser: it holds a code hash).
   The snapshot takes EVERY row the delete cascades to — a parent's login, the
   register, tutes, attempts — so Undo gives back the whole student, not a shell. */
const UNDO_TTL = 120;

const CHILDREN = {
  plan: schema.recurringPlans,
  appLogins: schema.appLogins,
  parentLogins: schema.parentLogins,
  attendance: schema.attendance,
  tutes: schema.tutes,
  topicChecks: schema.topicChecks,
  checkins: schema.checkins,
  paperAttempts: schema.paperAttempts,
  mcqAttempts: schema.mcqAttempts,
  recordingViews: schema.recordingViews,
  messageRecipients: schema.messageRecipients,
  pushSubs: schema.pushSubs, // listed after parentLogins: a parent's phone points at its login
} as const;
type Child = keyof typeof CHILDREN;

export async function removeStudent(p: Principal, id: number) {
  const snap = await db().transaction(async (tx) => {
    const c = await getStudentRow(p, id, tx);
    const n = await paymentCount(tx, id);
    if (n) {
      throw new HttpError(
        409,
        `${c.name.split(' ')[0]} has ${n} payment${n === 1 ? '' : 's'} recorded. Removing them would leave that money with nobody attached to it. Mark them alumni instead.`,
        'has_payments',
      );
    }
    const rows = {} as Record<Child, Record<string, unknown>[]>;
    for (const k of Object.keys(CHILDREN) as Child[]) {
      if (k === 'plan') rows[k] = await tx.select().from(schema.recurringPlans).where(eq(schema.recurringPlans.id, id));
      else if (k === 'pushSubs') {
        const parents = rows.parentLogins.map((r) => r.id as number);
        rows[k] = await tx
          .select()
          .from(schema.pushSubs)
          .where(sql`${schema.pushSubs.studentId} = ${id} or ${parents.length ? inArray(schema.pushSubs.parentId, parents) : sql`false`}`);
      } else {
        const t = CHILDREN[k];
        rows[k] = await tx.select().from(t).where(eq(t.studentId, id));
      }
    }
    const recs = await tx.select({ id: schema.records.id }).from(schema.records).where(eq(schema.records.studentId, id));
    const invs = await tx.select({ id: schema.invoices.id }).from(schema.invoices).where(eq(schema.invoices.studentId, id));
    // cascades remove the plan, the app login and everything else hanging off the student
    await tx.delete(schema.students).where(eq(schema.students.id, id));
    return { student: c, rows, recs: recs.map((r) => r.id), invs: invs.map((r) => r.id) };
  });
  await invalidate(TAG.student(id));
  const token = crypto.randomUUID();
  await cacheSet(`undo:student:${token}`, { ...snap, by: p.id }, UNDO_TTL);
  await logActivity(p.id, 'Student removed', `${snap.student.name} · no payments · by ${p.name}`);
  return { token, name: snap.student.name };
}

type Snap = {
  by: number;
  student: typeof schema.students.$inferSelect;
  rows: Record<Child, Record<string, unknown>[]>;
  recs: number[];
  invs: number[];
};

/** The snapshot went through JSON: turn its timestamp columns back into Dates. */
function revive<T extends Record<string, unknown>>(table: Parameters<typeof getTableColumns>[0], row: T) {
  const out: Record<string, unknown> = { ...row };
  for (const [k, col] of Object.entries(getTableColumns(table))) if (col.dataType === 'date' && typeof out[k] === 'string') out[k] = new Date(out[k] as string);
  return out as T;
}

export async function restoreStudent(p: Principal, token: string) {
  const snap = await cacheGet<Snap>(`undo:student:${token}`);
  if (!snap || snap.by !== p.id) throw new HttpError(410, 'Too late to undo that.', 'expired');
  await db().transaction(async (tx) => {
    await tx.insert(schema.students).values(revive(schema.students, snap.student));
    for (const k of Object.keys(CHILDREN) as Child[]) {
      const t = CHILDREN[k];
      const rows = snap.rows[k] ?? [];
      if (rows.length) await tx.insert(t).values(rows.map((r) => revive(t, r)) as (typeof t.$inferInsert)[]);
    }
    if (snap.recs.length) await tx.update(schema.records).set({ studentId: snap.student.id }).where(inArray(schema.records.id, snap.recs));
    if (snap.invs.length) await tx.update(schema.invoices).set({ studentId: snap.student.id }).where(inArray(schema.invoices.id, snap.invs));
  });
  await cacheSet(`undo:student:${token}`, null, 1);
  await invalidate(TAG.student(snap.student.id));
  return { id: snap.student.id };
}

/* ═══ tasks ═════════════════════════════════════════════════════════════ */

const archived = (t: { d: boolean; doneOn: string | null }, today: string) =>
  t.d && !!t.doneOn && daysBetween(t.doneOn, today) >= TASK_ARCHIVE_DAYS;

export async function listTasks(p: Principal) {
  const all = await db().select().from(schema.tasks).where(tasksScope(p)).orderBy(desc(schema.tasks.id));
  const today = todayISO();
  const live = all.filter((t) => !archived(t, today));
  return { tasks: live, archived: all.length - live.length };
}

async function getTask(p: Principal, id: number) {
  const [t] = await db()
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, id), tasksScope(p)))
    .limit(1);
  if (!t) throw notFound('That task');
  return t;
}

export async function createTask(p: Principal, i: z.infer<typeof TaskInput>) {
  const who = await resolveOwner(p, i.who, 'tasks.view.all');
  const [t] = await db()
    .insert(schema.tasks)
    .values({ t: i.t, who, due: i.due || null, dueTime: i.dueTime || null, note: i.note || null, d: false, createdBy: p.id })
    .returning();
  return t;
}

export async function updateTask(p: Principal, id: number, i: z.infer<typeof TaskPatch>) {
  const cur = await getTask(p, id);
  const set: Partial<typeof schema.tasks.$inferInsert> = {};
  if (i.t !== undefined) set.t = i.t;
  if (i.who !== undefined) set.who = await resolveOwner(p, i.who, 'tasks.view.all', cur.who);
  if (i.due !== undefined) set.due = i.due || null;
  if (i.dueTime !== undefined) set.dueTime = i.dueTime || null;
  if (i.note !== undefined) set.note = i.note || null;
  if (i.d !== undefined && i.d !== cur.d) {
    set.d = i.d;
    // WHEN it was finished, so the four-day archive has something to count from
    set.doneOn = i.d ? todayISO() : null;
  }
  if (!Object.keys(set).length) return cur;
  const [t] = await db().update(schema.tasks).set(set).where(eq(schema.tasks.id, id)).returning();
  return t;
}

export async function deleteTask(p: Principal, id: number) {
  const t = await getTask(p, id);
  await db().delete(schema.tasks).where(eq(schema.tasks.id, id));
  await logActivity(p.id, 'Task deleted', `${t.t} · by ${p.name}`);
  return t;
}

export const TaskRestore = z.object({
  id: z.number().int().positive(),
  t: z.string().min(1).max(300),
  who: z.number().int().nullable(),
  due: isoDay.nullable(),
  dueTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  note: z.string().max(500).nullable(),
  d: z.boolean(),
  doneOn: isoDay.nullable(),
  createdBy: z.number().int().nullable(),
});

export async function restoreTask(p: Principal, t: z.infer<typeof TaskRestore>) {
  const who = can(p.role, 'tasks.view.all') ? t.who : p.id;
  const [out] = await db()
    .insert(schema.tasks)
    // the client only says WHAT to restore; the row id and author come from the server
    .values({ t: t.t, due: t.due, dueTime: t.dueTime, note: t.note, d: t.d, doneOn: t.doneOn, who, createdBy: p.id })
    .onConflictDoNothing()
    .returning();
  if (!out) throw new HttpError(409, 'That task is already back.', 'conflict');
  return out;
}
