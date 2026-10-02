import 'server-only';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/server/db';
import { HttpError } from '@/lib/server/auth';

/* Timed MCQ papers and speed drills — the student side (was bswl_mcq_list /
   _start / _save / _submit) plus the staff results.

   RULE ZERO: an answer key never reaches a phone. start() returns questions
   without `answer` or `why`; marking happens here against a clock this
   server started; the right answers leave exactly once, in submit()'s reply.

   Two modes:
     questions — typed in the staff editor (text, optional picture, 2–5 options)
     pdf       — the paper is a PDF in the library (documents bucket); each
                 question row is just "Question N" with its option count and
                 answer, and the student marks an in-app bubble sheet. */

const P = schema.mcqPapers;
const Q = schema.mcqQuestions;
const A = schema.mcqAttempts;

const LATE_GRACE_SEC = 15;

export async function listForStudent(studentId: number, cohort: number) {
  const r = await db().execute<{
    id: number;
    title: string;
    unit: string | null;
    minutes: number;
    instructions: string | null;
    kind: string;
    mode: string;
    document_id: number | null;
    questions: number;
    finished_at: string | null;
    correct: number | null;
    total: number | null;
    marks: number | null;
    max_marks: number | null;
    seconds: number | null;
    in_progress: boolean;
    open_to: string | null;
  }>(sql`
    select p.id, p.title, p.unit, p.minutes, p.instructions, p.kind, p.mode, p.document_id,
           (select count(*)::int from ${Q} q where q.paper_id = p.id) as questions,
           to_char(a.finished_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as finished_at, a.correct, a.total, a.marks, a.max_marks, a.seconds,
           (a.id is not null and a.finished_at is null) as in_progress,
           to_char(p.open_to at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as open_to
    from ${P} p
    left join ${A} a on a.paper_id = p.id and a.student_id = ${studentId}
    where p.published
      and (p.cohort is null or p.cohort = ${cohort})
      and (p.open_from is null or p.open_from <= now())
      and (p.open_to is null or p.open_to >= now() or a.id is not null)
      and exists (select 1 from ${Q} q where q.paper_id = p.id)
    order by (a.finished_at is not null), p.updated_at desc`);
  return r.rows;
}

/** The order a student sees: shuffled papers are stable per attempt (md5 of question + attempt),
    so the review after submit lists questions exactly as they were sat. */
function questionOrder(shuffle: boolean, attemptId: number) {
  return shuffle ? sql`md5(${Q.id}::text || ${attemptId}::text), ${Q.ord}, ${Q.id}` : sql`${Q.ord}, ${Q.id}`;
}

type StartQ = { id: number; text: string; imageId: number | null; opts: string[]; optImages: (number | null)[]; marks: number };

export async function start(paperId: number, studentId: number, cohort: number) {
  const d = db();
  const [p] = await d.select().from(P).where(eq(P.id, paperId)).limit(1);
  if (!p || !p.published) throw new HttpError(400, 'That paper is not open', 'closed');
  if (p.cohort != null && p.cohort !== cohort) throw new HttpError(400, 'That paper is for another batch', 'batch');
  if (p.openFrom && p.openFrom > new Date()) throw new HttpError(400, 'That paper is not open yet', 'not_yet');

  let [att] = await d.select().from(A).where(and(eq(A.paperId, paperId), eq(A.studentId, studentId))).limit(1);
  if (att?.finishedAt) throw new HttpError(400, 'You have already sat this paper', 'done');
  if (!att) {
    if (p.openTo && p.openTo < new Date()) throw new HttpError(400, 'That paper has closed', 'closed');
    const [agg] = await d
      .select({ n: sql<number>`count(*)::int`, m: sql<number>`coalesce(sum(${Q.marks}),0)::int` })
      .from(Q)
      .where(eq(Q.paperId, paperId));
    // the clock starts HERE, on the server; reopening returns the same attempt
    [att] = await d
      .insert(A)
      .values({ paperId, studentId, total: agg.n, maxMarks: agg.m })
      .onConflictDoNothing()
      .returning();
    if (!att) [att] = await d.select().from(A).where(and(eq(A.paperId, paperId), eq(A.studentId, studentId))).limit(1);
  }

  const order = questionOrder(p.shuffle, att.id);
  const qs = await d
    .select({ id: Q.id, text: Q.q, imageId: Q.imageMediaId, opts: Q.opts, optImages: Q.optImages, marks: Q.marks })
    .from(Q)
    .where(eq(Q.paperId, paperId))
    .orderBy(order);

  return {
    paperId: p.id,
    title: p.title,
    kind: p.kind,
    mode: p.mode,
    documentId: p.documentId,
    minutes: p.minutes,
    instructions: p.instructions,
    startedAt: att.startedAt.toISOString(),
    serverNow: new Date().toISOString(),
    answers: att.answers,
    questions: qs.map((q): StartQ => ({ ...q, imageId: q.imageId ?? null, optImages: q.opts.map((_, i) => q.optImages?.[i] ?? null) })),
  };
}

function cleanAnswers(a: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!a || typeof a !== 'object') return out;
  for (const [k, v] of Object.entries(a as Record<string, unknown>)) {
    if (/^\d+$/.test(k) && Number.isInteger(v) && (v as number) >= 0 && (v as number) < 10) out[k] = v as number;
  }
  return out;
}

export async function save(paperId: number, studentId: number, answers: unknown) {
  const r = await db()
    .update(A)
    .set({ answers: cleanAnswers(answers) })
    .where(and(eq(A.paperId, paperId), eq(A.studentId, studentId), sql`${A.finishedAt} is null`))
    .returning({ id: A.id });
  return r.length > 0;
}

export async function submit(paperId: number, studentId: number, answers: unknown) {
  const d = db();
  const [att] = await d.select().from(A).where(and(eq(A.paperId, paperId), eq(A.studentId, studentId))).limit(1);
  if (!att) throw new HttpError(400, 'Start the paper first', 'not_started');
  if (att.finishedAt) throw new HttpError(400, 'Already submitted', 'done');
  const [p] = await d.select().from(P).where(eq(P.id, paperId)).limit(1);
  const picks = cleanAnswers(answers);
  const qs = await d.select().from(Q).where(eq(Q.paperId, paperId)).orderBy(questionOrder(p.shuffle, att.id));

  const now = new Date();
  const seconds = Math.max(0, Math.round((now.getTime() - att.startedAt.getTime()) / 1000));
  let correct = 0;
  let marks = 0;
  let maxMarks = 0;
  const review = qs.map((row) => {
    const picked = picks[String(row.id)] ?? null;
    const ok = picked != null && picked === row.answer;
    maxMarks += row.marks;
    if (ok) {
      correct++;
      marks += row.marks;
    }
    return { id: row.id, q: row.q, imageId: row.imageMediaId, opts: row.opts, optImages: row.opts.map((_, i) => row.optImages?.[i] ?? null), answer: row.answer, picked, ok, why: row.why, marks: row.marks };
  });
  const late = seconds > p.minutes * 60 + LATE_GRACE_SEC;

  const upd = await d
    .update(A)
    .set({ finishedAt: now, seconds, correct, total: qs.length, marks, maxMarks, answers: picks, late })
    .where(and(eq(A.id, att.id), sql`${A.finishedAt} is null`))
    .returning({ id: A.id });
  if (!upd.length) throw new HttpError(400, 'Already submitted', 'done');

  return { correct, total: qs.length, marks, maxMarks, seconds, late, minutes: p.minutes, mode: p.mode, documentId: p.documentId, review };
}

/** Review of a finished attempt (re-opening a paper you already sat). */
export async function review(paperId: number, studentId: number) {
  const d = db();
  const [att] = await d.select().from(A).where(and(eq(A.paperId, paperId), eq(A.studentId, studentId))).limit(1);
  if (!att?.finishedAt) throw new HttpError(400, 'Finish the paper first', 'not_done');
  const [p] = await d.select().from(P).where(eq(P.id, paperId)).limit(1);
  const qs = await d.select().from(Q).where(eq(Q.paperId, paperId)).orderBy(questionOrder(p.shuffle, att.id));
  return {
    title: p.title,
    correct: att.correct,
    total: att.total,
    marks: att.marks,
    maxMarks: att.maxMarks,
    seconds: att.seconds,
    late: att.late,
    minutes: p.minutes,
    mode: p.mode,
    documentId: p.documentId,
    review: qs.map((row) => {
      const picked = att.answers[String(row.id)] ?? null;
      return { id: row.id, q: row.q, imageId: row.imageMediaId, opts: row.opts, optImages: row.opts.map((_, i) => row.optImages?.[i] ?? null), answer: row.answer, picked, ok: picked === row.answer, why: row.why, marks: row.marks };
    }),
  };
}

/** Staff results: who sat it, marks, time, late; per-question how many got it. */
export async function results(paperId: number) {
  const d = db();
  const attempts = await d
    .select({
      studentId: A.studentId,
      name: schema.students.name,
      correct: A.correct,
      total: A.total,
      marks: A.marks,
      maxMarks: A.maxMarks,
      seconds: A.seconds,
      startedAt: A.startedAt,
      finishedAt: A.finishedAt,
      late: A.late,
      answers: A.answers,
    })
    .from(A)
    .innerJoin(schema.students, eq(schema.students.id, A.studentId))
    .where(eq(A.paperId, paperId))
    .orderBy(sql`${A.marks} desc nulls last`, asc(A.seconds));
  const qs = await d.select().from(Q).where(eq(Q.paperId, paperId)).orderBy(asc(Q.ord), asc(Q.id));
  const done = attempts.filter((a) => a.finishedAt);
  const questions = qs.map((row) => ({
    id: row.id,
    ord: row.ord,
    q: row.q,
    opts: row.opts,
    answer: row.answer,
    sat: done.length,
    gotIt: done.filter((a) => a.answers[String(row.id)] === row.answer).length,
  }));
  // each student's raw answers stay on the server; staff get the totals
  return {
    attempts: attempts.map((a) => {
      const rest: Partial<typeof a> = { ...a };
      delete rest.answers;
      return rest as Omit<typeof a, 'answers'>;
    }),
    questions,
  };
}

/** Staff "Retake": clears one student's attempt so a dead phone does not cost them the paper. */
export async function retake(paperId: number, studentId: number) {
  await db()
    .delete(A)
    .where(and(eq(A.paperId, paperId), eq(A.studentId, studentId)));
}

/** Student's finished MCQ history for Progress. */
export async function history(studentId: number) {
  return db()
    .select({ paperId: A.paperId, title: P.title, kind: P.kind, marks: A.marks, maxMarks: A.maxMarks, finishedAt: A.finishedAt })
    .from(A)
    .innerJoin(P, eq(P.id, A.paperId))
    .where(and(eq(A.studentId, studentId), sql`${A.finishedAt} is not null`))
    .orderBy(desc(A.finishedAt));
}
