import 'server-only';
import { and, asc, eq, gte, lt, notInArray, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/server/db';
import { HttpError, type Principal } from '@/lib/server/auth';
import { logActivity } from '@/lib/server/audit';
import { todayISO, ymNow, ymShift } from '@/lib/shared/dates';
import { getStudio } from './config';

/* ═══ Invoices (original §11) and Reports (original §12) ═════════════════
   Invoice balance = amount − paid. Status, ageing and the KPI maths are the
   original's and run in the browser over this list; the server only stores
   and validates. */

export type Invoice = typeof schema.invoices.$inferSelect;

export async function listInvoices(): Promise<Invoice[]> {
  return db().select().from(schema.invoices).orderBy(asc(schema.invoices.id));
}

type InvoiceInput = {
  cust: string;
  studentId?: number | null;
  amount: number;
  date?: string;
  due: string;
  ref?: string;
  method?: string;
};

export async function createInvoice(p: Principal, i: InvoiceInput) {
  const d = db();
  const row = await d.transaction(async (tx) => {
    const [r] = await tx
      .insert(schema.invoices)
      .values({
        ref: i.ref?.trim() || 'pending',
        cust: i.cust.trim(),
        studentId: i.studentId ?? null,
        amount: i.amount,
        date: i.date ?? todayISO(),
        due: i.due,
        method: i.method ?? '-',
      })
      .returning();
    if (i.ref?.trim()) return r;
    // INV-2026-0042: year of issue + the row id, so two people never collide
    const ref = `INV-${r.date.slice(0, 4)}-${String(r.id).padStart(4, '0')}`;
    const [u] = await tx.update(schema.invoices).set({ ref }).where(eq(schema.invoices.id, r.id)).returning();
    return u;
  });
  await logActivity(p.id, 'Invoice created', `${row.ref} · ${row.cust}`);
  return row;
}

export async function updateInvoice(id: number, patch: Partial<InvoiceInput> & { paid?: number }) {
  const d = db();
  const [cur] = await d.select().from(schema.invoices).where(eq(schema.invoices.id, id)).limit(1);
  if (!cur) throw new HttpError(404, 'That invoice was not found.', 'not_found');
  const amount = patch.amount ?? cur.amount;
  const paid = patch.paid ?? cur.paid;
  if (paid > amount) throw new HttpError(400, 'Paid cannot be more than the invoiced amount.', 'invalid');
  const [row] = await d
    .update(schema.invoices)
    .set({
      cust: patch.cust?.trim() ?? cur.cust,
      studentId: patch.studentId === undefined ? cur.studentId : patch.studentId,
      amount,
      paid,
      date: patch.date ?? cur.date,
      due: patch.due ?? cur.due,
      ref: patch.ref?.trim() || cur.ref,
      method: patch.method ?? cur.method,
    })
    .where(eq(schema.invoices.id, id))
    .returning();
  return row;
}

/** Record a payment. No amount = settle the balance in full (original "Mark paid"). */
export async function payInvoice(p: Principal, id: number, i: { amount?: number; method: string }) {
  const d = db();
  const [cur] = await d.select().from(schema.invoices).where(eq(schema.invoices.id, id)).limit(1);
  if (!cur) throw new HttpError(404, 'That invoice was not found.', 'not_found');
  const balance = cur.amount - cur.paid;
  if (balance <= 0) throw new HttpError(409, `${cur.ref} is already paid in full.`, 'settled');
  const amount = Math.min(i.amount ?? balance, balance);
  const [row] = await d
    .update(schema.invoices)
    // added in SQL and capped at the amount: two payments at once cannot lose one or overpay
    .set({ paid: sql`least(${schema.invoices.amount}, ${schema.invoices.paid} + ${amount})`, method: i.method })
    .where(eq(schema.invoices.id, id))
    .returning();
  await logActivity(p.id, 'Payment recorded', `${cur.ref} · ${cur.cust}`);
  return { invoice: row, prev: { paid: cur.paid, method: cur.method } };
}

/* ── Reports ──────────────────────────────────────────────────────────── */

type Rec = { id: number; name: string; co: string; value: number; owner: number | null; ym: string };

const daysIn = (ym: string) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();

export async function report(ym: string, cmp?: string) {
  const now = ymNow();
  if (ym > now) ym = now;
  let prev = cmp && cmp < ym ? cmp : ymShift(ym, -1);
  if (prev >= ym) prev = ymShift(ym, -1);
  const d = db();
  const studio = await getStudio();
  const wonKeys = studio.stages.filter((s) => s.terminal === 'won').map((s) => s.k);
  const termKeys = studio.stages.filter((s) => s.terminal).map((s) => s.k);
  const probOf = new Map(studio.stages.map((s) => [s.k, s.prob]));

  // the months this report touches: the 6-month trend ending at ym, plus prev
  const months = new Set<string>([prev]);
  for (let i = 5; i >= 0; i--) months.add(ymShift(ym, -i));
  const lo = [...months].sort()[0];

  const ymOf = sql<string>`to_char(${schema.records.createdOn}, 'YYYY-MM')`;
  const [rows, open, team] = await Promise.all([
    d
      .select({
        id: schema.records.id,
        name: schema.records.name,
        co: schema.records.co,
        value: sql<number>`coalesce(${schema.records.value},0)::int`,
        owner: schema.records.owner,
        stage: schema.records.stage,
        ym: ymOf,
      })
      .from(schema.records)
      .where(and(gte(schema.records.createdOn, `${lo}-01`), lt(schema.records.createdOn, `${ymShift(ym, 1)}-01`))),
    d
      .select({ stage: schema.records.stage, value: sql<number>`coalesce(${schema.records.value},0)::int` })
      .from(schema.records)
      .where(termKeys.length ? notInArray(schema.records.stage, termKeys) : undefined),
    d.select({ id: schema.staff.id, name: schema.staff.name, active: schema.staff.active }).from(schema.staff),
  ]);

  const won = (m: string): Rec[] => rows.filter((r) => r.ym === m && wonKeys.includes(r.stage));
  const created = (m: string) => rows.filter((r) => r.ym === m).length;
  const sum = (a: Rec[]) => a.reduce((t, r) => t + r.value, 0);
  const nameOf = (id: number | null) => team.find((s) => s.id === id)?.name ?? '-';

  const curWon = won(ym);
  const prvWon = won(prev);
  const byOwner = team
    .filter((s) => s.active)
    .map((s) => ({ name: s.name, v: sum(curWon.filter((r) => r.owner === s.id)) }))
    .filter((o) => o.v > 0)
    .sort((a, b) => b.v - a.v);
  const sorted = [...curWon].sort((a, b) => b.value - a.value);

  return {
    ym,
    prev,
    running: ym === now,
    day: ym === now ? +todayISO().slice(8, 10) : 0,
    daysIn: daysIn(ym),
    cur: { rev: sum(curWon), won: curWon.length, created: created(ym) },
    prv: { rev: sum(prvWon), won: prvWon.length, created: created(prev) },
    trend: [5, 4, 3, 2, 1, 0].map((i) => {
      const m = ymShift(ym, -i);
      return { ym: m, v: sum(won(m)), n: won(m).length };
    }),
    byOwner,
    top: sorted.slice(0, 5).map((r) => ({ id: r.id, name: r.name, co: r.co, value: r.value })),
    wins: sorted.map((r) => ({ name: r.name, co: r.co, owner: nameOf(r.owner), value: r.value })),
    open: { n: open.length, weighted: open.reduce((t, r) => t + (r.value * (probOf.get(r.stage) ?? 0)) / 100, 0) },
  };
}
