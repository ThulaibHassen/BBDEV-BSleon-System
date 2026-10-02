import 'server-only';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/server/db';
import { HttpError, type Principal } from '@/lib/server/auth';
import { logActivity } from '@/lib/server/audit';
import { invalidate, TAG } from '@/lib/server/cache';
import { can } from '@/lib/shared/rbac';
import { monthLbl, monthShort, todayISO, ymNow, ymShift } from '@/lib/shared/dates';
import { getStudio } from './config';

/* ═══ The fee ledger (original §10, "recurring") ═════════════════════════
   One plan per student (recurring_plans.id = students.id). A plan is
   CHARGED in a month when it is active and the student had joined by then.
   recFee     = plan.fee, or the Studio's default amount when the plan has none
   recPaid    = Σ payments for (plan, month)
   monthsOwed = count back from the selected month, stop at the first settled
                month or a month before they joined (cap 24)
   All of it is computed here at read time; nothing derived is stored. */

const CAP = 24;

export type LedgerPlan = {
  id: number;
  name: string;
  phone: string;
  cohort: number;
  program: string;
  co: string;
  level: string;
  fee: number;
  got: number;
  monthsOwed: number;
  owedAmount: number;
};

export type Ledger = {
  ym: string;
  first: string; // earliest month the switcher may go back to
  collected: number; // Σ of ALL payments booked to ym (original recStats.collected)
  plans: LedgerPlan[]; // plans charged in ym only
};

const charged = (status: string, joined: string | null, ym: string) => status === 'active' && (!joined || joined.slice(0, 7) <= ym);

export async function ledger(ym: string): Promise<Ledger> {
  const d = db();
  const studio = await getStudio();
  const defaultFee = studio.recurring.amount;
  const from = ymShift(ym, -CAP);

  const [plans, sums, [col]] = await Promise.all([
    d
      .select({
        id: schema.recurringPlans.id,
        name: schema.recurringPlans.name,
        phone: schema.recurringPlans.phone,
        cohort: schema.recurringPlans.cohort,
        program: schema.recurringPlans.program,
        fee: schema.recurringPlans.fee,
        joined: schema.recurringPlans.joined,
        status: schema.recurringPlans.status,
        co: schema.students.co,
        level: schema.students.level,
      })
      .from(schema.recurringPlans)
      .leftJoin(schema.students, eq(schema.students.id, schema.recurringPlans.id)),
    d
      .select({
        planId: schema.recurringPayments.planId,
        month: schema.recurringPayments.month,
        amount: sql<number>`sum(${schema.recurringPayments.amount})::int`,
      })
      .from(schema.recurringPayments)
      .where(and(gte(schema.recurringPayments.month, from), lte(schema.recurringPayments.month, ym)))
      .groupBy(schema.recurringPayments.planId, schema.recurringPayments.month),
    d
      .select({ n: sql<number>`coalesce(sum(${schema.recurringPayments.amount}),0)::int` })
      .from(schema.recurringPayments)
      .where(eq(schema.recurringPayments.month, ym)),
  ]);

  const paid = new Map<string, number>();
  for (const s of sums) paid.set(`${s.planId}|${s.month}`, s.amount);
  const got = (id: number, m: string) => paid.get(`${id}|${m}`) ?? 0;

  let first = ymNow();
  for (const p of plans) if (p.joined && p.joined.slice(0, 7) < first) first = p.joined.slice(0, 7);

  const out: LedgerPlan[] = [];
  for (const p of plans) {
    if (!charged(p.status, p.joined, ym)) continue;
    const fee = p.fee ?? defaultFee;
    let n = 0;
    let owed = 0;
    let m = ym;
    for (let i = 0; i < CAP; i++) {
      if (!charged(p.status, p.joined, m)) break; // before they joined, nothing is owed
      const g = got(p.id, m);
      if (g >= fee) break; // settled, so the run ends here
      n++;
      owed += fee - g;
      m = ymShift(m, -1);
    }
    out.push({
      id: p.id,
      name: p.name,
      phone: p.phone,
      cohort: p.cohort,
      program: p.program,
      co: p.co ?? '',
      level: p.level ?? 'okay',
      fee,
      got: got(p.id, ym),
      monthsOwed: n,
      owedAmount: owed,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return { ym, first, collected: col?.n ?? 0, plans: out };
}

/* ── recording a payment ──────────────────────────────────────────────── */

export const receiptNo = (studentId: number, ym: string) => `ABS-${ym.replace('-', '')}-${String(studentId).padStart(3, '0')}`;

/** Two instalments in one month by different means: the receipt names both. */
const mergeMethod = (a: string, b: string) => {
  const parts = a && a !== '-' ? a.split(' + ') : [];
  return parts.includes(b) ? a : [...parts, b].join(' + ');
};

export type PaymentUndo = {
  id: number;
  created: boolean;
  prev?: { amount: number; status: string; method: string; paidAt: string | null };
};

/** Mark paid (amount omitted = the rest of the month's fee) or record a part payment.
    Like the original, one row per (plan, month): a second payment adds to it. */
export async function recordPayment(
  p: Principal,
  i: { planId: number; month: string; amount?: number; method: string; paidAt?: string },
): Promise<{ undo: PaymentUndo; amount: number; settled: boolean; name: string }> {
  if (i.month > ymNow()) throw new HttpError(400, 'That month has not started yet.', 'invalid');
  const studio = await getStudio();
  const out = await db().transaction(async (tx) => {
    const [plan] = await tx.select().from(schema.recurringPlans).where(eq(schema.recurringPlans.id, i.planId)).limit(1).for('update');
    if (!plan) throw new HttpError(404, 'That student has no fee plan.', 'not_found');
    const fee = plan.fee ?? studio.recurring.amount;
    const [{ n: already }] = await tx
      .select({ n: sql<number>`coalesce(sum(${schema.recurringPayments.amount}),0)::int` })
      .from(schema.recurringPayments)
      .where(and(eq(schema.recurringPayments.planId, plan.id), eq(schema.recurringPayments.month, i.month)));
    const due = fee - already;
    const amount = i.amount ?? due;
    if (amount <= 0) throw new HttpError(409, `${plan.name.split(' ')[0]} has already paid for ${monthLbl(i.month)}.`, 'settled');
    const settled = already + amount >= fee;
    const status = settled ? 'paid' : 'partial';
    const paidAt = i.paidAt ?? todayISO();
    const [ex] = await tx
      .select()
      .from(schema.recurringPayments)
      .where(and(eq(schema.recurringPayments.planId, plan.id), eq(schema.recurringPayments.month, i.month)))
      .orderBy(desc(schema.recurringPayments.id))
      .limit(1);
    let undo: PaymentUndo;
    if (ex) {
      undo = { id: ex.id, created: false, prev: { amount: ex.amount, status: ex.status, method: ex.method, paidAt: ex.paidAt } };
      await tx
        .update(schema.recurringPayments)
        .set({ amount: ex.amount + amount, status, method: mergeMethod(ex.method, i.method), paidAt, receiptNo: receiptNo(plan.id, i.month), recordedBy: p.id })
        .where(eq(schema.recurringPayments.id, ex.id));
    } else {
      const [row] = await tx
        .insert(schema.recurringPayments)
        .values({ planId: plan.id, month: i.month, amount, status, method: i.method, paidAt, receiptNo: receiptNo(plan.id, i.month), recordedBy: p.id })
        .returning({ id: schema.recurringPayments.id });
      undo = { id: row.id, created: true };
    }
    return { undo, amount, settled, name: plan.name };
  });
  await logActivity(p.id, `${studio.recurring.label} collected`, `${out.name} · ${monthShort(i.month)}${out.settled ? '' : ' (part)'}`);
  await invalidate(TAG.student(i.planId));
  return out;
}

export async function undoPayment(who: number, u: PaymentUndo) {
  const d = db();
  const [row] = await d.select().from(schema.recurringPayments).where(eq(schema.recurringPayments.id, u.id)).limit(1);
  if (!row) return;
  if (u.created) await d.delete(schema.recurringPayments).where(eq(schema.recurringPayments.id, u.id));
  else if (u.prev) await d.update(schema.recurringPayments).set(u.prev).where(eq(schema.recurringPayments.id, u.id));
  await invalidate(TAG.student(row.planId));
  // money changes always leave a trail in Activity
  const [plan] = await d.select({ name: schema.recurringPlans.name }).from(schema.recurringPlans).where(eq(schema.recurringPlans.id, row.planId)).limit(1);
  await logActivity(
    who,
    'Payment undone',
    `${plan?.name ?? `Student ${row.planId}`} · ${monthShort(row.month)} · ${u.created ? `LKR ${row.amount.toLocaleString('en-LK')} removed` : `back to LKR ${(u.prev?.amount ?? 0).toLocaleString('en-LK')}`}`,
  );
}

/* ── documents: receipt + starter guide data ─────────────────────────── */

/** A staff-role user may only print for students they own (original scopeCustomers). */
async function studentFor(p: Principal, id: number) {
  const [s] = await db().select().from(schema.students).where(eq(schema.students.id, id)).limit(1);
  if (!s || (!can(p.role, 'students.view.all') && s.owner !== p.id)) throw new HttpError(404, 'That student was not found.', 'not_found');
  const [plan] = await db().select().from(schema.recurringPlans).where(eq(schema.recurringPlans.id, id)).limit(1);
  return { s, plan };
}

export async function receiptData(p: Principal, studentId: number, month?: string) {
  const { s, plan } = await studentFor(p, studentId);
  const d = db();
  let ym = month;
  if (!ym) {
    // latest month with money on it (original latestPaidYm)
    const [r] = await d
      .select({ m: schema.recurringPayments.month })
      .from(schema.recurringPayments)
      .where(and(eq(schema.recurringPayments.planId, studentId), sql`${schema.recurringPayments.amount} > 0`))
      .orderBy(desc(schema.recurringPayments.month))
      .limit(1);
    ym = r?.m ?? ymNow();
  }
  const rows = await d
    .select()
    .from(schema.recurringPayments)
    .where(and(eq(schema.recurringPayments.planId, studentId), eq(schema.recurringPayments.month, ym)))
    .orderBy(desc(schema.recurringPayments.id));
  const paid = rows.reduce((t, r) => t + r.amount, 0);
  if (paid <= 0) throw new HttpError(404, `No payment recorded for ${monthLbl(ym)} yet`, 'no_payment');
  const studio = await getStudio();
  // recFee: the plan's fee or the Studio default, the same figure the ledger charged
  const due = plan?.fee ?? studio.recurring.amount;
  const methods = [...new Set(rows.map((r) => r.method).filter(Boolean))];
  return {
    rno: receiptNo(s.id, ym),
    month: ym,
    name: s.name,
    cohort: s.cohort,
    program: s.program,
    co: s.co,
    paid,
    due,
    balance: Math.max(0, due - paid),
    date: rows[0]?.paidAt ?? todayISO(),
    method: methods.join(' + ') || 'Cash',
  };
}

export async function guideData(p: Principal, studentId: number) {
  const { s, plan } = await studentFor(p, studentId);
  const studio = await getStudio();
  return {
    name: s.name,
    cohort: s.cohort,
    program: s.program,
    co: s.co,
    joined: plan?.joined ?? s.joined ?? todayISO(),
    fee: plan?.fee ?? studio.recurring.amount,
  };
}
