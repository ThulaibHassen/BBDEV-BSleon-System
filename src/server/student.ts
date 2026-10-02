import 'server-only';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/server/db';
import { HttpError, type Principal } from '@/lib/server/auth';
import { cached, TAG } from '@/lib/server/cache';
import { mintTicket } from '@/lib/server/tickets';
import { grant } from '@/server/library';
import { getAppConfig } from '@/server/config';
import { CFG, LOC_LABEL, locClass } from '@/lib/shared/constants';
import { colomboToDate, todayISO } from '@/lib/shared/dates';

/* The student app's server side.

   Every function takes the student id FROM THE SESSION (requireStudent()),
   never from the request body, and every query is scoped to that id or to
   the student's own batch. There is no query here for fees, invoices or
   payments: a phone in a student's hand has no business with them.

   The original app loaded ten tables over REST and let row-level security
   decide; here bootstrap() is that one round trip, with the visibility
   rules (recordings, inbox) decided on the server. */

export type Me = {
  id: number;
  name: string;
  first: string;
  cohort: number;
  batch: string;
  loc: string;
  locLabel: string;
  program: string;
  joined: string | null;
  level: string;
};

export async function loadMe(p: Principal): Promise<Me> {
  const S = schema.students;
  const [s] = await db()
    .select({ id: S.id, name: S.name, cohort: S.cohort, loc: S.loc, co: S.co, program: S.program, joined: S.joined, level: S.level })
    .from(S)
    .where(eq(S.id, p.id))
    .limit(1);
  if (!s) throw new HttpError(404, 'Your record could not be found. Tell Leon.', 'no_student');
  return {
    id: s.id,
    name: s.name,
    first: s.name.split(' ')[0] || s.name,
    cohort: s.cohort,
    batch: String(2027 + s.cohort),
    loc: s.loc,
    locLabel: s.co || LOC_LABEL[s.loc] || s.loc,
    program: s.program,
    joined: s.joined,
    level: s.level || 'okay',
  };
}

/* ── recordings ─────────────────────────────────────────────────────────
   One rule, decided here: a recording is this student's when it is not
   revoked for them and (it was handed to them by name, or it is open to
   their whole batch, or it is an "absent" release and Leon marked them
   absent that day). The viewing window counts from 09:41 on the class day,
   Colombo time, exactly as the original did. A closed recording's link is
   never sent. */

type RecRow = {
  id: number;
  date: string;
  title: string;
  url: string;
  mins: number | null;
  release: string;
  window_days: number;
  granted: boolean;
  absent: boolean;
};

export type StudentRec = {
  id: number;
  date: string;
  title: string;
  url: string;
  mins: number | null;
  release: string;
  granted: boolean;
  missed: boolean;
  daysLeft: number | null;
};

async function visibleRecordings(me: Me, onlyId?: number) {
  const r = await db().execute<RecRow>(sql`
    select r.id, r.date::text as date, r.title, r.url, r.mins, r.release, r.window_days,
           (${me.id} = any(r.grants)) as granted,
           coalesce(a.present = false, false) as absent
    from ${schema.recordings} r
    left join ${schema.attendance} a on a.student_id = ${me.id} and a.date = r.date
    where not (${me.id} = any(r.revoked))
      and (${onlyId ?? null}::int is null or r.id = ${onlyId ?? null}::int)
      and ( ${me.id} = any(r.grants)
            or (r.cohort = ${me.cohort} and (r.release = 'batch' or (r.release = 'absent' and a.present = false))) )
    order by r.date desc, r.id desc`);
  const now = Date.now();
  return r.rows.map((x) => {
    let daysLeft: number | null = null;
    if (x.window_days) {
      const end = colomboToDate(`${x.date} 09:41`).getTime() + x.window_days * 86_400_000;
      daysLeft = Math.ceil((end - now) / 86_400_000);
    }
    return { ...x, daysLeft, live: daysLeft === null || daysLeft > 0 };
  });
}

export async function recordingsFor(me: Me) {
  const all = await visibleRecordings(me);
  const live: StudentRec[] = all
    .filter((x) => x.live)
    .map((x) => ({
      id: x.id,
      date: x.date,
      title: x.title,
      url: x.url,
      mins: x.mins,
      release: x.release,
      granted: x.granted,
      missed: x.absent,
      daysLeft: x.daysLeft,
    }));
  return { recordings: live, closed: all.length - live.length };
}

export async function markRecordingViewed(me: Me, id: number) {
  const [rec] = (await visibleRecordings(me, id)).filter((x) => x.live);
  if (!rec) throw new HttpError(404, 'That recording is not open to you.', 'not_found');
  await db().transaction(async (tx) => {
    const ins = await tx
      .insert(schema.recordingViews)
      .values({ recordingId: id, studentId: me.id })
      .onConflictDoNothing()
      .returning({ id: schema.recordingViews.recordingId });
    if (ins.length) {
      await tx
        .update(schema.recordings)
        .set({ views: sql`${schema.recordings.views} + 1` })
        .where(eq(schema.recordings.id, id));
    }
  });
}

/* ── inbox ──────────────────────────────────────────────────────────────
   A message reaches a student when a recipient row was fanned out for them
   OR its audience code names them (all, their batch, location, mode,
   programme, or them by id). Both paths, because a scheduled message may
   be due before anything fanned it out. */

type MsgRow = {
  id: number;
  type: string;
  title: string;
  body: string;
  at: string | null;
  courier: { co: string; no: string; note?: string } | null;
  read_at: string | null;
  registered_at: string | null;
};

/* mode codes are the staff composer's: physical = taught in a hall
   (Kings, JMC, Sasik, Residence), online = everyone else */
function audCodes(me: Me) {
  const mode = locClass(me.loc) === 'online' ? 'mode:online' : 'mode:physical';
  return ['all', `c${me.cohort}`, `loc:${me.loc}`, mode, `prog:${me.program}`, `student:${me.id}`];
}

async function inboxRows(me: Me, onlyId?: number) {
  const codes = audCodes(me);
  const r = await db().execute<MsgRow>(sql`
    select m.id, m.type, m.title, m.body, coalesce(m.sent_at, m.sched_for) as at, m.courier,
           rc.read_at, rc.registered_at
    from ${schema.messages} m
    left join ${schema.messageRecipients} rc on rc.message_id = m.id and rc.student_id = ${me.id}
    where (m.status = 'sent' or (m.status = 'scheduled' and m.sched_for <= now()))
      and coalesce(m.sent_at, m.sched_for, m.created_at) <= now()
      and (${onlyId ?? null}::int is null or m.id = ${onlyId ?? null}::int)
      and (rc.student_id is not null or m.aud in (${sql.join(
        codes.map((c) => sql`${c}`),
        sql`, `,
      )}))
    order by coalesce(m.sent_at, m.sched_for, m.created_at) desc, m.id desc
    limit 200`);
  return r.rows;
}

export async function inboxFor(me: Me) {
  const rows = await inboxRows(me);
  return rows.map((m) => ({
    id: m.id,
    type: m.type,
    title: m.title,
    body: m.body,
    date: m.at ? todayISO(new Date(m.at)) : todayISO(),
    courier: m.courier ?? null,
    read: !!m.read_at,
    registered: !!m.registered_at,
  }));
}

export async function markRead(me: Me, id: number) {
  const [m] = await inboxRows(me, id);
  if (!m) throw new HttpError(404, 'That update was not found.', 'not_found');
  if (m.read_at) return { ok: true };
  const R = schema.messageRecipients;
  /* only the request that actually flips read_at counts the open, so two
     taps (or two phones) at once still count one student once */
  await db().transaction(async (tx) => {
    const flipped = await tx
      .insert(R)
      .values({ messageId: id, studentId: me.id, readAt: new Date() })
      .onConflictDoUpdate({ target: [R.messageId, R.studentId], set: { readAt: new Date() }, setWhere: sql`${R.readAt} is null` })
      .returning({ id: R.messageId });
    if (!flipped.length) return;
    await tx
      .update(schema.messages)
      .set({ opened: sql`${schema.messages.opened} + 1` })
      .where(eq(schema.messages.id, id));
  });
  return { ok: true };
}

/** Seminar sign-up. Undo clears it; the message's count is recomputed, never incremented blind. */
export async function registerSeminar(me: Me, id: number, on: boolean) {
  const [m] = await inboxRows(me, id);
  if (!m || m.type !== 'seminar') throw new HttpError(404, 'That seminar was not found.', 'not_found');
  const R = schema.messageRecipients;
  const at = on ? new Date() : null;
  await db().transaction(async (tx) => {
    await tx
      .insert(R)
      .values({ messageId: id, studentId: me.id, readAt: new Date(), registeredAt: at })
      .onConflictDoUpdate({ target: [R.messageId, R.studentId], set: { registeredAt: at } });
    await tx
      .update(schema.messages)
      .set({
        registered: sql`(select count(*)::int from ${R} where ${R.messageId} = ${id} and ${R.registeredAt} is not null)`,
      })
      .where(eq(schema.messages.id, id));
  });
  return { ok: true, registered: on };
}

/* ── teaching aids ─────────────────────────────────────────────────────── */

export async function weights() {
  return cached(
    ['weights', 'published'],
    300,
    async () => {
      const W = schema.unitWeights;
      return db()
        .select({ unit: W.unit, band: W.band, share: W.share, note: W.note })
        .from(W)
        .where(eq(W.published, true))
        .orderBy(asc(W.unit));
    },
    [TAG.weights],
  );
}

export async function essays(cohort: number) {
  return cached(
    ['essays', 'student', String(cohort)],
    120,
    async () => {
      const E = schema.essayTemplates;
      return db()
        .select({ id: E.id, title: E.title, unit: E.unit, marks: E.marks, question: E.question, parts: E.parts, notes: E.notes })
        .from(E)
        .where(and(eq(E.published, true), sql`(${E.cohort} is null or ${E.cohort} = ${cohort})`))
        .orderBy(asc(E.unit), asc(E.title));
    },
    [TAG.essays],
  );
}

/* ── the batch, without a ladder ─────────────────────────────────────────
   Race: location against location on verified turnout this term. Honours:
   at most three names, first name and an initial, at 90% or better. Batch:
   percentages only, and only once the batch is big enough that nobody can
   be picked out (config.checks.minBatch). All of it Leon-marked data. */

function termStart(today: string) {
  const [y, m] = today.split('-').map(Number);
  const startMonth = m <= 4 ? 1 : m <= 8 ? 5 : 9;
  return `${y}-${String(startMonth).padStart(2, '0')}-01`;
}

const initialName = (name: string) => {
  const p = name.trim().split(/\s+/);
  return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0];
};

export async function cohortStats(cohort: number) {
  /* tagged with every member's student tag, so a register Leon saves (which
     invalidates TAG.student per child) shows in the race and honours at once */
  const members = await db()
    .select({ id: schema.students.id })
    .from(schema.students)
    .where(eq(schema.students.cohort, cohort));
  return cached(
    ['student', 'cohort-stats', String(cohort), todayISO()],
    300,
    async () => {
      const from = termStart(todayISO());
      const race = await db().execute<{ loc: string; pct: number }>(sql`
        select s.loc, round(100.0 * count(*) filter (where a.present) / nullif(count(*), 0))::int as pct
        from ${schema.attendance} a join ${schema.students} s on s.id = a.student_id
        where s.cohort = ${cohort} and s.status = 'active' and a.date >= ${from}::date
        group by s.loc having count(*) > 0
        order by pct desc, s.loc`);
      const hon = await db().execute<{ name: string; att: number }>(sql`
        select s.name, round(100.0 * count(*) filter (where a.present) / count(*))::int as att
        from ${schema.attendance} a join ${schema.students} s on s.id = a.student_id
        where s.cohort = ${cohort} and s.status = 'active' and a.date >= ${from}::date
        group by s.id, s.name having count(*) >= 3
          and 100.0 * count(*) filter (where a.present) / count(*) >= 90
        order by att desc, count(*) desc, s.name
        limit 3`);
      const [b] = (
        await db().execute<{ n: number; tute_rate: number | null; median: number | null }>(sql`
          with cur as (
            select unit from ${schema.tuteAssign} where cohort = ${cohort} order by date desc limit 1
          ), batch as (
            select id from ${schema.students} where cohort = ${cohort} and status = 'active'
          )
          select (select count(*)::int from batch) as n,
                 case when exists (select 1 from cur) then
                   (select round(100.0 * count(*) filter (where t.state = 'done') / nullif((select count(*) from batch), 0))::int
                      from ${schema.tutes} t join cur on cur.unit = t.unit where t.student_id in (select id from batch))
                 end as tute_rate,
                 (select round((percentile_cont(0.5) within group (order by 20.0 * p.score / p.max))::numeric)::int
                    from ${schema.paperAttempts} p where p.max > 0 and p.student_id in (select id from batch)) as median`)
      ).rows;
      return {
        race: race.rows.map((r) => ({ loc: r.loc, pct: r.pct })),
        honours: hon.rows.map((h) => ({ name: initialName(h.name), att: h.att })),
        batch: { n: b?.n ?? 0, tuteRate: b?.tute_rate ?? null, median: b?.median ?? null },
      };
    },
    ['race', ...members.map((s) => TAG.student(s.id))],
  );
}

/* ── bootstrap: everything Today, Learn and Progress need, in one call ── */

export async function bootstrap(p: Principal) {
  const me = await loadMe(p);
  const d = db();
  const [attendance, classLog, checks, tutes, tuteAssign, papers, checkins, recs, inbox, w, cfg, stats] = await Promise.all([
    d
      .select({ date: schema.attendance.date, present: schema.attendance.present })
      .from(schema.attendance)
      .where(eq(schema.attendance.studentId, me.id))
      .orderBy(asc(schema.attendance.date)),
    d
      .select({ date: schema.classLog.date, topics: schema.classLog.topics })
      .from(schema.classLog)
      .where(eq(schema.classLog.cohort, me.cohort))
      .orderBy(asc(schema.classLog.date)),
    d
      .select({ kind: schema.topicChecks.kind, topic: schema.topicChecks.topic, state: schema.topicChecks.state, checkedAt: schema.topicChecks.checkedAt })
      .from(schema.topicChecks)
      .where(eq(schema.topicChecks.studentId, me.id)),
    d.select({ unit: schema.tutes.unit, state: schema.tutes.state }).from(schema.tutes).where(eq(schema.tutes.studentId, me.id)),
    d
      .select({ unit: schema.tuteAssign.unit, date: schema.tuteAssign.date, documentId: schema.tuteAssign.documentId })
      .from(schema.tuteAssign)
      .where(eq(schema.tuteAssign.cohort, me.cohort))
      .orderBy(desc(schema.tuteAssign.date)),
    d
      .select({
        id: schema.paperAttempts.id,
        date: schema.paperAttempts.date,
        paper: schema.paperAttempts.paper,
        q: schema.paperAttempts.q,
        score: schema.paperAttempts.score,
        max: schema.paperAttempts.max,
        timed: schema.paperAttempts.timed,
        marker: schema.paperAttempts.marker,
        err: schema.paperAttempts.err,
      })
      .from(schema.paperAttempts)
      .where(eq(schema.paperAttempts.studentId, me.id))
      .orderBy(asc(schema.paperAttempts.date), asc(schema.paperAttempts.id)),
    d
      .select({ month: schema.checkins.month, mood: schema.checkins.mood, blocker: schema.checkins.blocker })
      .from(schema.checkins)
      .where(eq(schema.checkins.studentId, me.id)),
    recordingsFor(me),
    inboxFor(me),
    weights(),
    getAppConfig(),
    cohortStats(me.cohort),
  ]);

  const conf: Record<string, string> = {};
  const ev: Record<string, { s: string; d: string }> = {};
  for (const c of checks) {
    if (c.kind === 'conf') conf[c.topic] = c.state;
    else ev[c.topic] = { s: c.state, d: c.checkedAt };
  }
  const featureOn = (k: string) => {
    const f = (cfg.features as Record<string, { on: boolean; aud: string }>)[k];
    return !!f && f.on && (f.aud === 'all' || f.aud === `c${me.cohort}`);
  };

  return {
    me,
    serverNow: new Date().toISOString(),
    attendance,
    classLog,
    conf,
    ev,
    tutes: Object.fromEntries(tutes.map((t) => [t.unit, t.state])),
    tuteAssign,
    papers: papers.map((x) => ({ ...x, err: x.err ?? '' })),
    checkins,
    recordings: recs.recordings,
    recClosed: recs.closed,
    inbox,
    weights: w,
    config: {
      examDate: cfg.schedule?.examDate || CFG.examAt.slice(0, 10),
      classes: (cfg.schedule?.classes ?? []).filter((c) => (!c.loc || c.loc === me.loc) && (c.cohort == null || c.cohort === me.cohort)),
      pages: cfg.pages,
      support: cfg.support,
      splash: cfg.splash,
      recheckDays: cfg.checks?.recheckDays ?? 42,
      minBatch: cfg.checks?.minBatch ?? 10,
      rewardTiers: cfg.rewardTiers,
      features: {
        rewards: featureOn('rewards'),
        batchStats: featureOn('batchStats'),
        seminars: featureOn('seminars'),
        competition: featureOn('competition'),
      },
    },
    race: stats.race,
    honours: stats.honours,
    batch: stats.batch,
  };
}

/* ── opening a PDF ───────────────────────────────────────────────────────
   The library rule (grant) decides first. Two documents reach a student
   without being in the public library: the tute PDF Leon attached to an
   assignment for THEIR batch, and the question PDF of an MCQ paper they
   have already started (the bubble sheet needs it beside it). Both are
   still logged and still a 120-second ticket. */

export async function openDocument(me: Me, docId: number) {
  try {
    return await grant({ docId, studentId: me.id, cohort: me.cohort });
  } catch (e) {
    if (!(e instanceof HttpError) || e.status !== 403) throw e;
  }
  const d = db();
  const [viaTute] = await d
    .select({ unit: schema.tuteAssign.unit })
    .from(schema.tuteAssign)
    .where(and(eq(schema.tuteAssign.documentId, docId), eq(schema.tuteAssign.cohort, me.cohort)))
    .limit(1);
  const [viaMcq] = await d
    .select({ id: schema.mcqPapers.id })
    .from(schema.mcqPapers)
    .innerJoin(schema.mcqAttempts, and(eq(schema.mcqAttempts.paperId, schema.mcqPapers.id), eq(schema.mcqAttempts.studentId, me.id)))
    .where(and(eq(schema.mcqPapers.documentId, docId), eq(schema.mcqPapers.published, true)))
    .limit(1);
  if (!viaTute && !viaMcq) throw new HttpError(403, 'Leon has not shared this one yet.', 'not_available');
  /* the started MCQ paper needs its PDF whatever the library says; a tute
     link opens only a document Leon has published to students, so a draft
     or staff-only PDF is never readable just because a tute points at it */
  const D = schema.documents;
  const shared = and(eq(D.published, true), sql`${D.audience} in ('public','students')`);
  const [doc] = await d
    .select({ id: D.id, title: D.title })
    .from(D)
    .where(viaMcq ? eq(D.id, docId) : and(eq(D.id, docId), shared))
    .limit(1);
  if (!doc) throw new HttpError(403, 'Leon has not shared this one yet.', 'not_available');
  await d.insert(schema.documentLog).values({ documentId: doc.id, studentId: me.id, asStaff: false });
  const t = mintTicket(doc.id, `s${me.id}`);
  return { url: t.url, title: doc.title, expiresAt: new Date(t.expiresAt * 1000).toISOString() };
}
