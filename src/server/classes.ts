import 'server-only';
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/server/db';
import { HttpError } from '@/lib/server/auth';
import { invalidate, TAG } from '@/lib/server/cache';
import { logActivity } from '@/lib/server/audit';
import { BSWL_SYLLABUS, COHORT_SHORT, LOC_LABEL, topicCount } from '@/lib/shared/constants';
import { colomboToDate, dPlus, todayISO } from '@/lib/shared/dates';

/* ═══ One class, one screen ═══════════════════════════════════════════
   Attendance, the topic marker, tute assignment, batch signals and the
   class recordings. The rules come from the original Class page:
   - a student shows Absent only when a row says present=false; no row = Present
   - "Save register" writes a row for EVERY student on the roll, so a class
     where everyone came is still on record
   - coverage is per batch, never per student
   - recording availability is computed from the class date, never stored
   - recording audience: absent-in, present-out, hand-grant-wins, revoke beats grant */

export type Release = 'absent' | 'batch' | 'picked';
export const RELEASE_L: Record<Release, string> = {
  absent: 'Students marked absent',
  batch: 'The whole batch',
  picked: 'Chosen students only',
};

type Who = { id: number; name: string };

/* ── roster ─────────────────────────────────────────────────────────── */

export async function activeStudents() {
  return db()
    .select({
      id: schema.students.id,
      name: schema.students.name,
      cohort: schema.students.cohort,
      loc: schema.students.loc,
      co: schema.students.co,
      program: schema.students.program,
      joined: schema.students.joined,
      phone: schema.students.phone,
    })
    .from(schema.students)
    .where(eq(schema.students.status, 'active'))
    .orderBy(asc(schema.students.name));
}
type Student = Awaited<ReturnType<typeof activeStudents>>[number];

/** The roll for a date: active, joined by then, this batch, this hall (co label or 'all'). */
export function roll(students: Student[], date: string, cohort: number, co = 'all') {
  return students.filter((s) => (s.joined || '0000') <= date && s.cohort === cohort && (co === 'all' || s.co === co));
}

export async function lastSessionDate() {
  const r = await db().execute<{ date: string | null }>(sql`select max(date)::text as date from ${schema.attendance}`);
  return r.rows[0]?.date ?? null;
}

/* ── the class context the page loads in one go ─────────────────────── */

export async function classContext(date: string, cohort: number) {
  const d = db();
  const [students, attDay, rateRows, lastRows, logs, tutes, recs] = await Promise.all([
    activeStudents(),
    d
      .select({ studentId: schema.attendance.studentId, present: schema.attendance.present })
      .from(schema.attendance)
      .where(eq(schema.attendance.date, date)),
    d.execute<{ sid: number; p: number; n: number }>(sql`
      select student_id as sid, count(*) filter (where present)::int as p, count(*)::int as n
      from ${schema.attendance} group by student_id`),
    d.execute<{ date: string }>(sql`select max(date)::text as date from ${schema.attendance}`),
    d.select().from(schema.classLog).orderBy(asc(schema.classLog.date)),
    d.select().from(schema.tuteAssign).orderBy(asc(schema.tuteAssign.unit)),
    d
      .select({ id: schema.recordings.id })
      .from(schema.recordings)
      .where(and(eq(schema.recordings.date, date), eq(schema.recordings.cohort, cohort)))
      .limit(1),
  ]);

  const rates: Record<number, number | null> = {};
  for (const r of rateRows.rows) rates[r.sid] = r.n ? Math.round((r.p / r.n) * 100) : null;

  // coverage: topic → latest date it was logged, per batch
  const covered: Record<number, Record<string, string>> = { 0: {}, 1: {} };
  for (const l of logs) for (const t of l.topics) (covered[l.cohort] ??= {})[t] = l.date;
  const total = topicCount();
  const coverage = [0, 1].map((c) => {
    const n = Object.keys(covered[c] ?? {}).length;
    return { cohort: c, n, total, pc: Math.round((n / total) * 100) };
  });
  const todayLog = logs.find((l) => l.date === date && l.cohort === cohort);

  return {
    date,
    cohort,
    students,
    attendance: attDay,
    marked: attDay.length > 0,
    rates,
    lastSession: lastRows.rows[0]?.date ?? null,
    covered: covered[cohort] ?? {},
    coverage,
    logged: todayLog?.topics ?? [],
    tutes: tutes.filter((t) => t.cohort === cohort).map((t) => ({ unit: t.unit, date: t.date, by: t.by })),
    hasRecording: recs.length > 0,
    signals: await batchSignals(cohort, students, covered[cohort] ?? {}),
    queue: await attentionQueue(cohort, students),
  };
}

/* ── attendance ─────────────────────────────────────────────────────── */

/** Toggle one student: no row → Absent; otherwise flip. Upsert on (student_id, date). */
export async function setAttendance(studentId: number, date: string, present: boolean, by: number) {
  const [s] = await db().select({ id: schema.students.id }).from(schema.students).where(eq(schema.students.id, studentId)).limit(1);
  if (!s) throw new HttpError(404, 'That student was not found.', 'not_found');
  await db()
    .insert(schema.attendance)
    .values({ studentId, date, present, markedBy: by })
    .onConflictDoUpdate({
      target: [schema.attendance.studentId, schema.attendance.date],
      set: { present, markedBy: by },
    });
  await invalidate(TAG.student(studentId));
}

export async function saveRegister(date: string, cohort: number, co: string, who: Who) {
  const students = roll(await activeStudents(), date, cohort, co);
  if (!students.length) throw new HttpError(400, 'No students in this class on that date.', 'empty');
  const d = db();
  const ids = students.map((s) => s.id);
  await d
    .insert(schema.attendance)
    .values(ids.map((studentId) => ({ studentId, date, present: true, markedBy: who.id })))
    .onConflictDoNothing({ target: [schema.attendance.studentId, schema.attendance.date] });
  const rows = await d
    .select({ present: schema.attendance.present })
    .from(schema.attendance)
    .where(and(eq(schema.attendance.date, date), inArray(schema.attendance.studentId, ids)));
  const absent = rows.filter((r) => !r.present).length;
  const present = ids.length - absent;
  await logActivity(who.id, 'Register saved', `${date} · ${present} present, ${absent} absent · by ${who.name}`);
  for (const id of ids) await invalidate(TAG.student(id));
  return { present, absent };
}

/* ── topics and tutes ───────────────────────────────────────────────── */

const TOPIC_IDS = new Set(BSWL_SYLLABUS.flatMap((u) => u.topics.map(([k]) => k)));

export async function saveClassTopics(date: string, cohort: number, topics: string[]) {
  const clean = [...new Set(topics.filter((t) => TOPIC_IDS.has(t)))];
  if (!clean.length) throw new HttpError(400, 'Tick at least one topic first', 'empty');
  // append without duplicates when the class already has a log row
  await db()
    .insert(schema.classLog)
    .values({ date, cohort, topics: clean })
    .onConflictDoUpdate({
      target: [schema.classLog.date, schema.classLog.cohort],
      set: {
        topics: sql`(select array_agg(distinct t order by t) from unnest(${schema.classLog.topics} || excluded.topics) as t)`,
      },
    });
  // the parent view (cached per child) shows the batch's coverage and last class
  const kids = await db().select({ id: schema.students.id }).from(schema.students).where(eq(schema.students.cohort, cohort));
  await invalidate(TAG.syllabus, ...kids.map((k) => TAG.student(k.id)));
}

const UNITS = new Set(BSWL_SYLLABUS.map((u) => u.u));

/** At most one live assignment per unit per batch: assigning replaces any earlier one. */
export async function assignTute(unit: string, cohort: number, date: string, who: Who) {
  if (!UNITS.has(unit)) throw new HttpError(400, 'No such unit.', 'invalid');
  await db().transaction(async (tx) => {
    await tx.delete(schema.tuteAssign).where(and(eq(schema.tuteAssign.unit, unit), eq(schema.tuteAssign.cohort, cohort)));
    await tx.insert(schema.tuteAssign).values({ unit, cohort, date, by: who.name });
  });
  await logActivity(who.id, 'Tute assigned', `Unit ${unit} · ${COHORT_SHORT[cohort]} Batch`);
  await invalidate(TAG.syllabus);
}

export async function unassignTute(unit: string, cohort: number, who: Who) {
  const gone = await db()
    .delete(schema.tuteAssign)
    .where(and(eq(schema.tuteAssign.unit, unit), eq(schema.tuteAssign.cohort, cohort)))
    .returning();
  await logActivity(who.id, 'Tute unassigned', `Unit ${unit} · ${COHORT_SHORT[cohort]} Batch`);
  await invalidate(TAG.syllabus);
  return gone[0] ?? null;
}

/* ── batch signals: real aggregates from the student app's own records ── */

async function batchSignals(cohort: number, students: Student[], covered: Record<string, string>) {
  const d = db();
  const batch = students.filter((s) => s.cohort === cohort);
  const ids = batch.map((s) => s.id);
  const total = topicCount();
  const covTopics = Object.keys(covered);
  const covPc = Math.round((covTopics.length / total) * 100);
  const last = await d.execute<{ date: string | null }>(sql`
    select max(a.date)::text as date from ${schema.attendance} a
    join ${schema.students} s on s.id = a.student_id where s.cohort = ${cohort}`);
  const lastDate = last.rows[0]?.date ?? null;
  const empty = { covPc, demPc: 0, tutePc: 0, median: null as number | null, mismatch: 0, sample: 0, tuteN: 0, papers: 0 };
  if (!ids.length) return { ...empty, lastDate, lastPresent: 0, batchN: 0 };

  const [checks, tutes, papers, absentLast] = await Promise.all([
    d
      .select({ sid: schema.topicChecks.studentId, kind: schema.topicChecks.kind, topic: schema.topicChecks.topic, state: schema.topicChecks.state })
      .from(schema.topicChecks)
      .where(inArray(schema.topicChecks.studentId, ids)),
    d.select({ state: schema.tutes.state }).from(schema.tutes).where(inArray(schema.tutes.studentId, ids)),
    d
      .select({ score: schema.paperAttempts.score, max: schema.paperAttempts.max })
      .from(schema.paperAttempts)
      .where(and(inArray(schema.paperAttempts.studentId, ids), gte(schema.paperAttempts.date, dPlus(todayISO(), -60)))),
    lastDate
      ? d
          .select({ sid: schema.attendance.studentId })
          .from(schema.attendance)
          .where(and(eq(schema.attendance.date, lastDate), eq(schema.attendance.present, false), inArray(schema.attendance.studentId, ids)))
      : Promise.resolve([] as { sid: number }[]),
  ]);

  // demonstrated: share of (student × covered topic) pairs Leon has seen demonstrated
  const covSet = new Set(covTopics);
  const sample = new Set(checks.map((c) => c.sid)).size;
  const dem = checks.filter((c) => c.kind === 'ev' && c.state === 'demonstrated' && covSet.has(c.topic)).length;
  const demPc = covTopics.length ? Math.min(100, Math.round((dem / (ids.length * covTopics.length)) * 100)) : 0;

  // confidence and evidence disagree: the student says "got it", the evidence says still developing
  const ev = new Map(checks.filter((c) => c.kind === 'ev').map((c) => [`${c.sid}:${c.topic}`, c.state]));
  const mismatch = new Set(
    checks.filter((c) => c.kind === 'conf' && c.state === 'got' && ev.get(`${c.sid}:${c.topic}`) === 'developing').map((c) => c.sid),
  ).size;

  const tutePc = tutes.length ? Math.round((tutes.filter((t) => t.state === 'done').length / tutes.length) * 100) : 0;

  const scaled = papers.filter((p) => p.max > 0).map((p) => (p.score / p.max) * 20).sort((a, b) => a - b);
  const median = scaled.length
    ? Math.round(scaled.length % 2 ? scaled[(scaled.length - 1) / 2] : (scaled[scaled.length / 2 - 1] + scaled[scaled.length / 2]) / 2)
    : null;

  return {
    covPc,
    demPc,
    tutePc,
    tuteN: tutes.length,
    median,
    papers: scaled.length,
    mismatch,
    sample,
    lastDate,
    batchN: ids.length,
    lastPresent: ids.length - new Set(absentLast.map((a) => a.sid)).size,
  };
}

/** Worth a look: 2+ absences, or a miss in the last two classes. Worst first, at most ten. */
async function attentionQueue(cohort: number, students: Student[]) {
  const batch = students.filter((s) => s.cohort === cohort);
  if (!batch.length) return [];
  const rows = await db()
    .select({ sid: schema.attendance.studentId, date: schema.attendance.date, present: schema.attendance.present })
    .from(schema.attendance)
    .where(inArray(schema.attendance.studentId, batch.map((s) => s.id)))
    .orderBy(asc(schema.attendance.date));
  const by = new Map<number, boolean[]>();
  for (const r of rows) {
    const a = by.get(r.sid) ?? [];
    a.push(r.present);
    by.set(r.sid, a);
  }
  return batch
    .map((s) => {
      const a = by.get(s.id) ?? [];
      return {
        id: s.id,
        name: s.name,
        phone: s.phone,
        absent: a.filter((p) => !p).length,
        recent: a.slice(-2).filter((p) => !p).length,
      };
    })
    .filter((x) => x.absent >= 2 || x.recent > 0)
    .sort((a, b) => b.absent * 2 + b.recent - (a.absent * 2 + a.recent))
    .slice(0, 10);
}

/* ═══ Recordings ═════════════════════════════════════════════════════ */

type Rec = typeof schema.recordings.$inferSelect;

/** Whole days left before the window closes (null = no limit). The class "starts" 09:41 Colombo. */
export function daysLeft(r: Pick<Rec, 'date' | 'windowDays'>, now = new Date()) {
  if (!r.windowDays) return null;
  const end = colomboToDate(`${dPlus(r.date, r.windowDays)} 09:41`);
  return Math.ceil((end.getTime() - now.getTime()) / 86_400_000);
}
export const isLive = (r: Pick<Rec, 'date' | 'windowDays'>, now = new Date()) => {
  const dl = daysLeft(r, now);
  return dl === null || dl > 0;
};

type AudienceInput = { students: Student[]; absentOn: Map<string, Set<number>> };

/** Who can watch, each with the rule that let them in. Revoke beats grant; no duplicates. */
export function audience(r: Rec, a: AudienceInput) {
  const byId = new Map(a.students.map((s) => [s.id, s]));
  const batch = a.students.filter((s) => s.cohort === r.cohort);
  const have = new Map<number, { id: number; name: string; why: string }>();
  if (r.release === 'batch') for (const s of batch) have.set(s.id, { id: s.id, name: s.name, why: 'whole batch' });
  if (r.release === 'absent') {
    const abs = a.absentOn.get(r.date) ?? new Set();
    for (const s of batch) if (abs.has(s.id)) have.set(s.id, { id: s.id, name: s.name, why: 'marked absent' });
  }
  for (const id of r.grants) {
    const s = byId.get(id);
    if (s) have.set(id, { id, name: s.name, why: 'given by hand' });
  }
  for (const id of r.revoked) have.delete(id);
  return [...have.values()].sort((x, y) => x.name.localeCompare(y.name));
}

async function absentMap(dates: string[]) {
  const m = new Map<string, Set<number>>();
  if (!dates.length) return m;
  const rows = await db()
    .select({ sid: schema.attendance.studentId, date: schema.attendance.date })
    .from(schema.attendance)
    .where(and(inArray(schema.attendance.date, [...new Set(dates)]), eq(schema.attendance.present, false)));
  for (const r of rows) {
    const s = m.get(r.date) ?? new Set<number>();
    s.add(r.sid);
    m.set(r.date, s);
  }
  return m;
}

export async function listRecordings() {
  const recs = await db().select().from(schema.recordings).orderBy(desc(schema.recordings.date), desc(schema.recordings.id));
  const input = { students: await activeStudents(), absentOn: await absentMap(recs.map((r) => r.date)) };
  const now = new Date();
  const rows = recs.map((r) => ({ ...r, audience: audience(r, input), daysLeft: daysLeft(r, now), live: isLive(r, now) }));
  return { rows, total: rows.length, live: rows.filter((r) => r.live).length };
}

async function audienceOf(r: Rec) {
  return audience(r, { students: await activeStudents(), absentOn: await absentMap([r.date]) });
}

export type RecInput = { date: string; cohort: number; loc: string; title: string; url: string; mins: number };

/** One validator for add and edit, so an edit can never bring in a link the add form refuses. */
async function check(i: Pick<RecInput, 'date' | 'title' | 'url'>, skipId: number | null) {
  if (!i.date) return 'Pick the date of the class.';
  if (!i.title) return 'Say what the class covered, so a student knows what they are opening.';
  if (!/^https:\/\//.test(i.url)) return 'Paste the full recording link, starting with https://';
  const [dup] = await db().select({ id: schema.recordings.id, date: schema.recordings.date }).from(schema.recordings).where(eq(schema.recordings.url, i.url));
  if (dup && dup.id !== skipId) return `That exact link is already on ${dup.date}.`;
  return '';
}

function bad(msg: string) {
  return new HttpError(400, msg, 'invalid');
}

export async function addRecording(i: RecInput & { release: Release; windowDays: number }, who: Who) {
  const problem = await check(i, null);
  if (problem) throw bad(problem);
  if (!(i.loc in LOC_LABEL)) throw bad('Pick the class it was.');
  if (i.release === 'absent') {
    const [m] = await db().select({ id: schema.attendance.id }).from(schema.attendance).where(eq(schema.attendance.date, i.date)).limit(1);
    if (!m) throw bad(`Mark attendance for ${i.date} first, or nobody gets this recording.`);
  }
  // two quick presses of Add (or two staff pasting the same link) must not both pass
  // the duplicate-link check: serialise on the link, then check again inside
  const r = await db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${i.url}))`);
    const [dup] = await tx.select({ date: schema.recordings.date }).from(schema.recordings).where(eq(schema.recordings.url, i.url)).limit(1);
    if (dup) throw bad(`That exact link is already on ${dup.date}.`);
    const [row] = await tx
      .insert(schema.recordings)
      .values({
        date: i.date,
        cohort: i.cohort,
        loc: i.loc,
        title: i.title,
        url: i.url,
        mins: i.mins || 0,
        addedBy: who.name,
        addedOn: todayISO(),
        release: i.release,
        windowDays: i.windowDays,
      })
      .returning();
    return row;
  });
  await logActivity(who.id, 'Recording added', `${i.title} · ${i.date} · by ${who.name}`);
  await invalidate(TAG.recordings);
  return { id: r.id, reach: (await audienceOf(r)).length };
}

async function getRec(id: number) {
  const [r] = await db().select().from(schema.recordings).where(eq(schema.recordings.id, id)).limit(1);
  if (!r) throw new HttpError(404, 'That recording was not found.', 'not_found');
  return r;
}

/** Edit the details. The row keeps its id, so grants and views survive the correction. */
export async function editRecording(id: number, i: RecInput, who: Who) {
  const r = await getRec(id);
  const problem = await check(i, id);
  if (problem) throw bad(problem);
  if (!(i.loc in LOC_LABEL)) throw bad('Pick the class it was.');
  const was: string[] = [];
  if (r.date !== i.date) was.push(`date ${r.date} to ${i.date}`);
  if (r.title !== i.title) was.push('title');
  if (r.url !== i.url) was.push('link');
  if ((r.mins ?? 0) !== (i.mins || 0)) was.push(`length ${r.mins ?? 0} to ${i.mins || 0}`);
  if (r.cohort !== i.cohort) was.push(`batch ${COHORT_SHORT[r.cohort]} to ${COHORT_SHORT[i.cohort]}`);
  if (r.loc !== i.loc) was.push('place');
  if (!was.length) return { changes: 0 };
  await db()
    .update(schema.recordings)
    .set({ date: i.date, title: i.title, url: i.url, mins: i.mins || 0, cohort: i.cohort, loc: i.loc })
    .where(eq(schema.recordings.id, id));
  await logActivity(who.id, 'Recording edited', `${i.title} · ${was.join(', ')} · by ${who.name}`);
  await invalidate(TAG.recordings);
  return { changes: was.length };
}

/** Taking access away is the dangerous direction: it needs `confirm` when anyone would lose it. */
export async function setRelease(id: number, release: Release, confirm: boolean, who: Who) {
  const r = await getRec(id);
  const before = (await audienceOf(r)).map((s) => s.id);
  const after = (await audienceOf({ ...r, release })).map((s) => s.id);
  const lost = before.filter((x) => !after.includes(x)).length;
  const gained = after.filter((x) => !before.includes(x)).length;
  if (lost > 0 && !confirm) {
    throw new HttpError(409, `That takes it away from ${lost} student${lost === 1 ? '' : 's'}. Choose it again to confirm.`, 'confirm');
  }
  await db().update(schema.recordings).set({ release }).where(eq(schema.recordings.id, id));
  await logActivity(
    who.id,
    'Recording audience changed',
    `${r.title} · ${RELEASE_L[r.release as Release] ?? r.release} → ${RELEASE_L[release]} · +${gained} / -${lost} · by ${who.name}`,
  );
  await invalidate(TAG.recordings);
  return { reach: after.length, lost };
}

export async function setWindow(id: number, windowDays: number, who: Who) {
  const r = await getRec(id);
  await db().update(schema.recordings).set({ windowDays }).where(eq(schema.recordings.id, id));
  await logActivity(who.id, 'Recording window changed', `${r.title} → ${windowDays ? `${windowDays} days` : 'no limit'} · by ${who.name}`);
  await invalidate(TAG.recordings);
}

async function studentName(id: number) {
  const [s] = await db().select({ name: schema.students.name }).from(schema.students).where(eq(schema.students.id, id)).limit(1);
  if (!s) throw new HttpError(404, 'That student was not found.', 'not_found');
  return s.name;
}

/* Grants and revokes are changed in SQL, not read-modify-write: a few quick taps
   on different students would otherwise overwrite each other's change. */
const R = schema.recordings;
type IdList = typeof R.grants | typeof R.revoked;
const arrayRemove = (col: IdList, id: number) => sql`array_remove(${col}, ${id}::int)`;
const arrayAdd = (col: IdList, id: number) => sql`case when ${id}::int = any(${col}) then ${col} else array_append(${col}, ${id}::int) end`;

export async function grant(id: number, studentId: number, who: Who) {
  const r = await getRec(id);
  const nm = await studentName(studentId);
  await db()
    .update(schema.recordings)
    .set({ revoked: arrayRemove(R.revoked, studentId), grants: arrayAdd(R.grants, studentId) })
    .where(eq(schema.recordings.id, id));
  await logActivity(who.id, 'Recording access granted', `${nm} · ${r.title} · by ${who.name}`);
  await invalidate(TAG.recordings, TAG.student(studentId));
  return nm;
}

export async function revoke(id: number, studentId: number, who: Who) {
  const r = await getRec(id);
  const nm = await studentName(studentId);
  await db()
    .update(schema.recordings)
    .set({ grants: arrayRemove(R.grants, studentId), revoked: arrayAdd(R.revoked, studentId) })
    .where(eq(schema.recordings.id, id));
  await logActivity(who.id, 'Recording access removed', `${nm} · ${r.title} · by ${who.name}`);
  await invalidate(TAG.recordings, TAG.student(studentId));
  return nm;
}

export async function removeRecording(id: number, who: Who) {
  const r = await getRec(id);
  await db().delete(schema.recordings).where(eq(schema.recordings.id, id));
  await logActivity(who.id, 'Recording removed', `${r.title} · by ${who.name}`);
  await invalidate(TAG.recordings);
}

/** Preview counts for the add form: whole batch, and marked absent on that date. */
export async function recordingPreview(date: string, cohort: number) {
  const students = (await activeStudents()).filter((s) => s.cohort === cohort);
  const abs = (await absentMap([date])).get(date) ?? new Set();
  const [m] = await db().select({ id: schema.attendance.id }).from(schema.attendance).where(eq(schema.attendance.date, date)).limit(1);
  return { batch: students.length, absent: students.filter((s) => abs.has(s.id)).length, marked: !!m };
}
