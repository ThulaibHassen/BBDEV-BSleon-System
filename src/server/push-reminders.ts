import 'server-only';
import { and, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/server/db';
import { HttpError } from '@/lib/server/auth';
import { pushReady, pushTo, type PushPayload } from '@/lib/server/push';
import { getAppConfig } from '@/server/config';
import { sendDueScheduled } from '@/server/messages';
import { colomboParts, daysBetween, dPlus, MN_FULL, todayISO, ymShift } from '@/lib/shared/dates';
import { CFG } from '@/lib/shared/constants';

/* ═══ Phone reminders (the old push-reminders edge function) ══════════
   Called hourly at :00 Colombo by the cron service, or by an owner/manager
   ("Send test", "Send due reminders now").

   Students: at most `max` a day, only in the computed sending hours, one
   notification per student per run, the first due kind wins; every
   (kind, ref) has a rest period so the same nudge is not sent daily.
   push_log is the history and the daily cap counts it.

   Parents: the monthly fee only, on day `day` and `day2` at `hour`, and only
   if something is still due. FIXED from the original: this runs on its own
   schedule — not inside a student sending hour, and not silenced by the
   student master switch — so the defaults (hour 18 vs student hours 16/19)
   actually fire. */

export const PUSH_DEFAULTS = {
  on: true,
  max: 2,
  from: 16,
  to: 19,
  kinds: { recording: true, tute: true, checkin: true, topics: true, comeback: true, exam: true } as Record<string, boolean>,
  parent: { on: true, day: 5, day2: 12, hour: 18 },
};
export type PushCfg = typeof PUSH_DEFAULTS & { examDate: string };

export async function pushConfig(): Promise<PushCfg> {
  const app = await getAppConfig();
  const p = (app.push ?? {}) as Partial<PushCfg>;
  return {
    ...PUSH_DEFAULTS,
    ...p,
    kinds: { ...PUSH_DEFAULTS.kinds, ...(p.kinds ?? {}) },
    parent: { ...PUSH_DEFAULTS.parent, ...(p.parent ?? {}) },
    // the exam date Leon edits (Content → schedule) wins: push.examDate always carries
    // the built-in default after the merge, so it must not shadow his date
    examDate: app.schedule?.examDate || p.examDate || CFG.examAt.slice(0, 10),
  };
}

/** Sending hours spread evenly between from and to, one per "max a day". */
export function slots(max: number, from: number, to: number) {
  const m = Math.max(1, Math.min(6, Math.round(+max) || 1));
  const f = Math.max(0, Math.min(23, Math.round(+from)));
  const t = Math.max(f, Math.min(23, Math.round(+to)));
  if (m === 1) return [t];
  const o: number[] = [];
  for (let i = 0; i < m; i++) {
    const h = Math.round(f + (i * (t - f)) / (m - 1));
    if (!o.includes(h)) o.push(h);
  }
  return o.sort((a, b) => a - b);
}

const EXAM_MARKS = [300, 200, 150, 100, 75, 60, 45, 30, 21, 14, 7, 3, 1];
const REST: Record<string, number> = { recording: 1, tute: 2, checkin: 3, exam: 100000, topics: 7, comeback: 4 };
const s = (n: number) => (n === 1 ? '' : 's');
const colomboDay = (d: Date) => todayISO(d);

type Candidate = { kind: string; ref: string; title: string; body: string; url: string };

/* ── test: one notification to one student's phones now ─────────────── */

export async function sendTest(studentId: number, staffId: number) {
  if (!pushReady()) throw new HttpError(503, 'Push keys are not set up', 'no_vapid');
  const subs = await db()
    .select()
    .from(schema.pushSubs)
    .where(and(eq(schema.pushSubs.audience, 'student'), eq(schema.pushSubs.studentId, studentId)));
  if (!subs.length) throw new HttpError(404, 'That student has not turned reminders on yet', 'no_subs');
  const payload: PushPayload = { title: 'Test from BS With Leon', body: 'Reminders are working on this phone.', url: '/student/?go=next', tag: 'bswl-test' };
  const delivered = await pushTo(subs, payload);
  await db().insert(schema.pushLog).values({
    studentId,
    kind: 'test',
    ref: String(staffId),
    title: payload.title,
    body: payload.body,
    devices: subs.length,
    delivered,
    test: true,
  });
  return { ok: true, devices: subs.length, delivered };
}

/* ── the tick ───────────────────────────────────────────────────────── */

export async function runReminders(mode: 'tick' | 'run', now = new Date()) {
  const messages = await sendDueScheduled(now);
  const cfg = await pushConfig();
  const p = colomboParts(now);
  const hours = slots(cfg.max, cfg.from, cfg.to);
  const base = { ok: true, hour: p.h, hours, messages: messages.length };
  if (!pushReady()) return { ...base, sent: 0, detail: [], parents: { sent: 0, note: 'push keys are not set up' }, note: 'push keys are not set up' };

  const out = await alone(async () => {
    const parents = await parentFees(cfg, now);
    if (!cfg.on) return { ...base, sent: 0, detail: [], parents, note: 'reminders are switched off' };
    if (mode === 'tick' && !hours.includes(p.h)) return { ...base, sent: 0, detail: [], parents, note: 'not a sending hour' };
    const students = await studentReminders(cfg, now);
    return { ...base, ...students, parents };
  });
  const busy = 'another reminder run is in progress';
  return out ?? { ...base, sent: 0, detail: [], parents: { sent: 0, note: busy }, note: busy };
}

/* The caps and rest periods are read from push_log before anything is written,
   so two overlapping runs (the cron tick and "Send due reminders now", or a
   retried tick) would both pass them and send everything twice. One run at a
   time: a transaction-scoped advisory lock, released when the run ends. */
const REMINDER_LOCK = 0x62737770; // 'bswp'

async function alone<T>(fn: () => Promise<T>): Promise<T | null> {
  return db().transaction(async (tx) => {
    const r = await tx.execute<{ ok: boolean }>(sql`select pg_try_advisory_xact_lock(${REMINDER_LOCK}::bigint) as ok`);
    return r.rows[0]?.ok ? fn() : null;
  });
}

async function studentReminders(cfg: PushCfg, now: Date) {
  const d = db();
  const subs = await d.select().from(schema.pushSubs).where(and(eq(schema.pushSubs.audience, 'student'), isNotNull(schema.pushSubs.studentId)));
  if (!subs.length) return { sent: 0, detail: [], note: 'nobody has turned reminders on yet' };
  const ids = [...new Set(subs.map((x) => x.studentId!))];
  const today = colomboDay(now);
  const ym = today.slice(0, 7);
  const dayOfMonth = Number(today.slice(8, 10));

  const [students, logins, log, recs, att, views, tutes, assigns, checkins, lost] = await Promise.all([
    d.select({ id: schema.students.id, name: schema.students.name, status: schema.students.status, cohort: schema.students.cohort }).from(schema.students).where(inArray(schema.students.id, ids)),
    d.select().from(schema.appLogins).where(inArray(schema.appLogins.studentId, ids)),
    d
      .select()
      .from(schema.pushLog)
      .where(and(inArray(schema.pushLog.studentId, ids), gte(schema.pushLog.sentAt, new Date(now.getTime() - 120 * 86_400_000)))),
    d.select().from(schema.recordings).where(gte(schema.recordings.date, dPlus(today, -60))),
    d
      .select({ sid: schema.attendance.studentId, date: schema.attendance.date })
      .from(schema.attendance)
      .where(and(inArray(schema.attendance.studentId, ids), eq(schema.attendance.present, false), gte(schema.attendance.date, dPlus(today, -60)))),
    d.select().from(schema.recordingViews).where(inArray(schema.recordingViews.studentId, ids)),
    d.select().from(schema.tutes).where(inArray(schema.tutes.studentId, ids)),
    d.select().from(schema.tuteAssign).where(gte(schema.tuteAssign.date, dPlus(today, -45))),
    d.select().from(schema.checkins).where(inArray(schema.checkins.studentId, ids)),
    d
      .select({ sid: schema.topicChecks.studentId, n: sql<number>`count(*)::int` })
      .from(schema.topicChecks)
      .where(and(inArray(schema.topicChecks.studentId, ids), eq(schema.topicChecks.kind, 'conf'), eq(schema.topicChecks.state, 'lost')))
      .groupBy(schema.topicChecks.studentId),
  ]);

  const loginOf = new Map(logins.map((l) => [l.studentId, l]));
  const lostOf = new Map(lost.map((l) => [l.sid, l.n]));
  const examDays = daysBetween(today, cfg.examDate);
  const detail: { studentId: number; kind: string; delivered: number }[] = [];

  for (const st of students) {
    if (st.status && st.status !== 'active') continue;
    if (loginOf.get(st.id)?.status === 'locked') continue;
    const mine = log.filter((l) => l.studentId === st.id && !l.test);
    if (mine.filter((l) => colomboDay(l.sentAt) === today).length >= cfg.max) continue; // daily cap (parent fee rows count too)

    const rested = (kind: string, ref: string) => {
      const last = mine.filter((l) => l.kind === kind && l.ref === ref).sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())[0];
      return !last || daysBetween(colomboDay(last.sentAt), today) >= REST[kind];
    };
    const cands: Candidate[] = [];
    const first = st.name.trim().split(/\s+/)[0] || st.name;

    if (cfg.kinds.recording) {
      const absent = new Set(att.filter((a) => a.sid === st.id).map((a) => a.date));
      const seen = new Set(views.filter((v) => v.studentId === st.id).map((v) => v.recordingId));
      for (const r of recs) {
        if (r.cohort !== st.cohort || seen.has(r.id) || r.revoked.includes(st.id) || r.windowDays <= 0) continue;
        if (!((r.release === 'absent' && absent.has(r.date)) || r.grants.includes(st.id))) continue;
        const left = daysBetween(today, dPlus(r.date, r.windowDays));
        if (left < 1 || left > 3) continue;
        cands.push({
          kind: 'recording',
          ref: String(r.id),
          title: 'Your missed class closes soon',
          body: `Watch "${r.title}". ${left} day${s(left)} left before it closes.`,
          url: '/student/?go=recordings',
        });
      }
    }

    if (cfg.kinds.tute) {
      const own = tutes.filter((t) => t.studentId === st.id);
      const ownUnits = new Set(own.map((t) => t.unit));
      const open = [
        ...own.filter((t) => ['assigned', 'started', 'fix'].includes(t.state)).map((t) => ({ unit: t.unit, state: t.state })),
        ...assigns.filter((a) => a.cohort === st.cohort && !ownUnits.has(a.unit)).map((a) => ({ unit: a.unit, state: 'assigned' })),
      ].sort((a, b) => (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0));
      const t = open[0];
      if (t) {
        const [title, body] =
          t.state === 'fix'
            ? [`Unit ${t.unit} tute: one thing to fix`, `Leon marked something to fix in your Unit ${t.unit} tute.`]
            : t.state === 'started'
              ? ['Your tute is waiting', `You started the Unit ${t.unit} tute. Twenty minutes and it is done.`]
              : ['Your tute is waiting', `The Unit ${t.unit} tute is not finished yet. Start it tonight.`];
        cands.push({ kind: 'tute', ref: t.unit, title, body, url: '/student/?go=tutes' });
      }
    }

    if (cfg.kinds.checkin) {
      const done = new Set(checkins.filter((c) => c.studentId === st.id).map((c) => c.month));
      const prev = ymShift(ym, -1);
      const due = !done.has(prev) ? prev : dayOfMonth >= 25 && !done.has(ym) ? ym : null;
      if (due) {
        cands.push({
          kind: 'checkin',
          ref: due,
          title: `Two taps: how did ${MN_FULL[Number(due.slice(5, 7)) - 1]} go?`,
          body: 'Your monthly check-in is ready. It goes to Leon only, never the class.',
          url: '/student/?go=next',
        });
      }
    }

    if (cfg.kinds.exam && EXAM_MARKS.includes(examDays)) {
      const n = examDays;
      cands.push({
        kind: 'exam',
        ref: String(n),
        title: `${n} day${s(n)} to your A/L`,
        body:
          n > 150
            ? "Plenty of time, if you use it. Today's one thing is ready."
            : n > 30
              ? 'Timed questions and fixing errors matter most now.'
              : 'Full papers and pacing. You have got this.',
        url: '/student/?go=next',
      });
    }

    const nLost = lostOf.get(st.id) ?? 0;
    if (cfg.kinds.topics && nLost > 0) {
      cands.push({
        kind: 'topics',
        ref: 'lost',
        title: 'Rebuild one topic',
        body: `You marked ${nLost} topic${s(nLost)} as Lost. Ten minutes on one is a real start.`,
        url: '/student/?go=syllabus',
      });
    }

    const la = loginOf.get(st.id)?.lastActive;
    if (cfg.kinds.comeback && la) {
      const n = daysBetween(la, today);
      if (n >= 4) {
        cands.push({
          kind: 'comeback',
          ref: 'comeback',
          title: `${first}, your next step is ready`,
          body: `It has been ${n} days. Open the app for today's one thing.`,
          url: '/student/?go=next',
        });
      }
    }

    const pick = cands.find((c) => rested(c.kind, c.ref));
    if (!pick) continue;
    const mySubs = subs.filter((x) => x.studentId === st.id);
    const delivered = await pushTo(mySubs, { title: pick.title, body: pick.body, url: pick.url, tag: `bswl-${pick.kind}` });
    await d.insert(schema.pushLog).values({
      studentId: st.id,
      kind: pick.kind,
      ref: pick.ref,
      title: pick.title,
      body: pick.body,
      devices: mySubs.length,
      delivered,
    });
    detail.push({ studentId: st.id, kind: pick.kind, delivered });
  }
  return { sent: detail.length, detail };
}

/* ── parents: the fee, twice a month at most, only while unpaid ─────── */

async function parentFees(cfg: PushCfg, now: Date) {
  const pc = cfg.parent;
  if (!pc.on) return { sent: 0, note: 'parent reminders are switched off' };
  const p = colomboParts(now);
  const which = p.d === pc.day ? 'a' : p.d === pc.day2 ? 'b' : null;
  if (!which) return { sent: 0, note: 'not a reminder day' };
  if (p.h !== pc.hour) return { sent: 0, note: 'not the reminder hour' };

  const d = db();
  const subs = await d
    .select({ sub: schema.pushSubs, parent: schema.parentLogins })
    .from(schema.pushSubs)
    .innerJoin(schema.parentLogins, eq(schema.parentLogins.id, schema.pushSubs.parentId))
    .where(eq(schema.pushSubs.audience, 'parent'));
  // every live parent account of a child shares one reminder (all their phones together)
  const byChild = new Map<number, (typeof subs)[number]['sub'][]>();
  for (const r of subs) {
    if (r.parent.status === 'locked' || !r.parent.active) continue;
    const a = byChild.get(r.parent.studentId) ?? [];
    a.push(r.sub);
    byChild.set(r.parent.studentId, a);
  }
  if (!byChild.size) return { sent: 0, note: 'no parent has turned reminders on yet' };

  const kids = [...byChild.keys()];
  const ym = todayISO(now).slice(0, 7);
  const ref = `${ym}-${which}`;
  const [plans, paid, sentAlready] = await Promise.all([
    d.select().from(schema.recurringPlans).where(inArray(schema.recurringPlans.id, kids)),
    d
      .select({ id: schema.recurringPayments.planId, sum: sql<number>`coalesce(sum(${schema.recurringPayments.amount}),0)::int` })
      .from(schema.recurringPayments)
      .where(and(inArray(schema.recurringPayments.planId, kids), eq(schema.recurringPayments.month, ym)))
      .groupBy(schema.recurringPayments.planId),
    d
      .select({ sid: schema.pushLog.studentId })
      .from(schema.pushLog)
      .where(
        and(
          eq(schema.pushLog.audience, 'parent'),
          eq(schema.pushLog.kind, 'fee'),
          eq(schema.pushLog.ref, ref),
          inArray(schema.pushLog.studentId, kids),
          gte(schema.pushLog.sentAt, new Date(now.getTime() - 40 * 86_400_000)),
        ),
      ),
  ]);
  const paidOf = new Map(paid.map((x) => [x.id, x.sum]));
  const done = new Set(sentAlready.map((x) => x.sid));
  const month = MN_FULL[p.m - 1];
  let sent = 0;
  for (const plan of plans) {
    if (done.has(plan.id) || (plan.status && plan.status !== 'active') || plan.fee == null) continue;
    const due = Math.max(0, plan.fee - (paidOf.get(plan.id) ?? 0));
    if (due <= 0) continue; // nothing is ever sent to a parent who has paid
    const first = plan.name.trim().split(/\s+/)[0] || plan.name;
    const amt = due.toLocaleString('en-LK');
    const [title, body] =
      which === 'a'
        ? [`${month} class fee`, `${first}'s fee of LKR ${amt} is due this month.`]
        : [`${month} fee still due`, `LKR ${amt} is still outstanding for ${first}. Pay Leon at class or by transfer.`];
    const devs = byChild.get(plan.id)!;
    const delivered = await pushTo(devs, { title, body, url: '/parent/', tag: 'bswl-fee' });
    await d.insert(schema.pushLog).values({ studentId: plan.id, audience: 'parent', kind: 'fee', ref, title, body, devices: devs.length, delivered });
    sent++;
  }
  return { sent, note: which === 'a' ? 'first fee reminder' : 'follow-up fee reminder' };
}

/* ── the Health tab's "How it is going" ─────────────────────────────── */

export async function pushStatus() {
  const d = db();
  const [subs, log, active] = await Promise.all([
    d.select({ audience: schema.pushSubs.audience, studentId: schema.pushSubs.studentId, parentId: schema.pushSubs.parentId }).from(schema.pushSubs),
    d
      .select({
        id: schema.pushLog.id,
        studentId: schema.pushLog.studentId,
        name: schema.students.name,
        kind: schema.pushLog.kind,
        title: schema.pushLog.title,
        delivered: schema.pushLog.delivered,
        test: schema.pushLog.test,
        audience: schema.pushLog.audience,
        sentAt: schema.pushLog.sentAt,
      })
      .from(schema.pushLog)
      .leftJoin(schema.students, eq(schema.students.id, schema.pushLog.studentId))
      .orderBy(sql`${schema.pushLog.sentAt} desc`)
      .limit(12),
    d.select({ n: sql<number>`count(*)::int` }).from(schema.students).where(eq(schema.students.status, 'active')),
  ]);
  const st = subs.filter((x) => x.audience === 'student' && x.studentId);
  const pa = subs.filter((x) => x.audience === 'parent' && x.parentId);
  const ids = [...new Set(st.map((x) => x.studentId!))];
  const names = ids.length
    ? await d.select({ id: schema.students.id, name: schema.students.name }).from(schema.students).where(inArray(schema.students.id, ids))
    : [];
  return {
    ready: pushReady(),
    students: { people: ids.length, phones: st.length, of: active[0]?.n ?? 0 },
    parents: { people: new Set(pa.map((x) => x.parentId)).size, phones: pa.length },
    subscribed: names.sort((a, b) => a.name.localeCompare(b.name)),
    log: log.map((l) => ({ ...l, name: l.name ?? `Student ${l.studentId}` })),
  };
}
