import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/server/db';
import { cached, TAG } from '@/lib/server/cache';
import { getAppConfig } from '@/server/config';

/* The parent app's whole read model: bswl_parent_view(), ported one to one.

   The child is ALWAYS the one in the parent's session (p.sidOf). Nothing a
   phone sends can name another child, so there is no parameter to tamper with.

   Parents see the fee, the register, what the class covered and Leon's read.
   Deliberately NOT here (Leon, 23 Sep 2026): topic self-ratings, paper and
   MCQ marks, messages. A student who knows every attempt is watched stops
   logging honest ones. */

export type ParentView = {
  child: { name: string; batch: number; class: string; program: string; joined: string | null; status: string; read: string };
  fee: { month: string; amount: number; paid: number; due: number; months_behind: number; total_owed: number };
  payments: { month: string; amount: number; paid_at: string | null }[];
  attendance: { marked: number; present: number; recent: { date: string; present: boolean }[] };
  syllabus: { covered: number; last_class: { date: string; topics: string[] } | null };
};

export type ParentSchedule = {
  examDate: string;
  classes: { day: string; time: string; loc: string; note?: string }[];
};

/* One statement, same arithmetic as the SQL function — including its month
   series: generate_series(joined, today, '1 month') counts a month only once
   the day-of-month of `joined` has been reached, a month is "behind" when the
   sum paid for it is below the fee, and an overpayment in one month never
   offsets another. Changing that changes what parents see; it needs Leon. */
async function load(kid: number): Promise<(ParentView & { loc: string; cohort: number }) | null> {
  const r = await db().execute(sql`
    with s as (
      select id, name, cohort, co, loc, program, joined, status, level from students where id = ${kid}
    ),
    plan as (select fee, joined from recurring_plans where id = ${kid}),
    ym as (select to_char(now() at time zone 'Asia/Colombo', 'YYYY-MM') m),
    f as (select coalesce((select fee from plan), 0) fee),
    paid as (
      select coalesce(sum(amount), 0)::int v from recurring_payments
       where plan_id = ${kid} and month = (select m from ym)
    ),
    owed as (
      select count(*)::int months, coalesce(sum(greatest(0, (select fee from f) - coalesce(p.got, 0))), 0)::int total
        from (
          select to_char(d, 'YYYY-MM') m
            from generate_series(
                   coalesce((select joined from plan), (now() at time zone 'Asia/Colombo')::date),
                   (now() at time zone 'Asia/Colombo')::date,
                   interval '1 month') d
        ) months
        left join (
          select month, sum(amount) got from recurring_payments where plan_id = ${kid} group by month
        ) p on p.month = months.m
       where coalesce(p.got, 0) < (select fee from f)
    )
    select json_build_object(
      'child', (select json_build_object('name', name, 'batch', cohort, 'class', co, 'program', program,
                                         'joined', joined, 'status', status, 'read', level) from s),
      'loc', (select loc from s),
      'cohort', (select cohort from s),
      'fee', json_build_object(
        'month', (select m from ym),
        'amount', (select fee from f),
        'paid', (select v from paid),
        'due', greatest(0, (select fee from f) - (select v from paid)),
        'months_behind', (select months from owed),
        'total_owed', (select total from owed)),
      'payments', coalesce((
        select json_agg(json_build_object('month', month, 'amount', amount, 'paid_at', paid_at) order by month desc)
          from (select month, sum(amount)::int amount, max(paid_at) paid_at
                  from recurring_payments where plan_id = ${kid}
                 group by month order by month desc limit 6) x), '[]'::json),
      'attendance', json_build_object(
        'marked', (select count(*)::int from attendance where student_id = ${kid}),
        'present', (select count(*)::int from attendance where student_id = ${kid} and present),
        'recent', coalesce((
          select json_agg(json_build_object('date', date, 'present', present) order by date desc)
            from (select date, present from attendance where student_id = ${kid} order by date desc limit 8) a), '[]'::json)),
      'syllabus', json_build_object(
        'covered', (select count(distinct t)::int from class_log c, unnest(c.topics) t
                     where c.cohort = (select cohort from s)),
        'last_class', (select json_build_object('date', date, 'topics', topics) from class_log
                        where cohort = (select cohort from s) order by date desc limit 1))
    ) as v
    where exists (select 1 from s)
  `);
  const row = r.rows[0] as { v: ParentView & { loc: string; cohort: number } } | undefined;
  return row?.v ?? null;
}

/** The parent's view of their child, cached a minute per child. Any write that
    touches the child (payment, attendance, level) invalidates TAG.student(id). */
export function parentView(kid: number) {
  return cached(['parent-view', String(kid)], 60, () => load(kid), [TAG.student(kid)]);
}

/** #3 — exam date and the class times for the child's own location and batch.
    Read through the config cache, not the child's, so Leon's edits show at once. */
export async function parentSchedule(loc: string, cohort: number): Promise<ParentSchedule> {
  const { schedule } = await getAppConfig();
  return {
    examDate: schedule.examDate,
    classes: (schedule.classes ?? [])
      .filter((c) => c.loc === loc && (c.cohort == null || c.cohort === cohort))
      .map((c) => ({ day: c.day, time: c.time, loc: c.loc, ...(c.note ? { note: c.note } : {}) })),
  };
}
