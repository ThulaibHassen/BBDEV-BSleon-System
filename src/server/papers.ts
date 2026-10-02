import 'server-only';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@/lib/server/db';
import { HttpError } from '@/lib/server/auth';
import { notFound } from '@/lib/server/api';
import { invalidate, TAG } from '@/lib/server/cache';

/* Staff authoring for the Papers page: MCQ papers and speed drills, essay
   templates and live-quiz question sets. The student side and marking live
   in server/mcq.ts and server/quiz.ts.

   The one rule every question form shares (the original's hard-won fix):
   blank options are dropped and the ticked answer FOLLOWS its option to its
   new position. A ticked blank is refused, never silently re-pointed. */

const P = schema.mcqPapers;
const Q = schema.mcqQuestions;
const QZ = schema.quizzes;
const QQ = schema.quizQuestions;
const E = schema.essayTemplates;

/** Drop blank options and re-map the answer. Throws the original's three messages.
    An option is kept if it has words OR a picture; optImages (parallel to opts,
    null = no picture) is filtered in the same pass so it stays parallel. */
export function tidyOptions(q: string, opts: string[], answer: number, maxLen: number, optImages: (number | null)[] = [], qImage: number | null = null) {
  if (!q.trim() && !qImage) throw new HttpError(400, 'The question needs some words.', 'invalid');
  const kept: string[] = [];
  const imgs: (number | null)[] = [];
  let ans = -1;
  opts.forEach((o, i) => {
    const t = String(o ?? '').trim().slice(0, maxLen);
    const img = optImages[i] ?? null;
    if (!t && !img) return;
    if (i === answer) ans = kept.length;
    kept.push(t);
    imgs.push(img);
  });
  if (kept.length < 2) throw new HttpError(400, 'Give at least two options.', 'invalid');
  if (ans < 0) throw new HttpError(400, 'The option you ticked is empty. Tick the right one.', 'invalid');
  // the column is typed number[], but Postgres stores the NULL gaps fine ({7,NULL,9})
  return { opts: kept, answer: ans, optImages: imgs.some((m) => m) ? (imgs as number[]) : null };
}

/** Every picture id a question points at must be a real upload. */
async function assertMedia(ids: (number | null | undefined)[]) {
  const want = [...new Set(ids.filter((m): m is number => !!m))];
  if (!want.length) return;
  const got = await db().select({ id: schema.media.id }).from(schema.media).where(inArray(schema.media.id, want));
  if (got.length !== want.length) throw new HttpError(400, 'That picture is missing. Upload it again.', 'invalid');
}

const mediaId = z.number().int().positive();
const optImages = (n: number) => z.array(mediaId.nullable()).max(n).optional();

const cohort = z.coerce.number().int().min(0).max(9).nullable();
const unit = z
  .string()
  .trim()
  .max(4)
  .nullable()
  .transform((v) => v || null);
const optText = (n: number) =>
  z
    .string()
    .trim()
    .max(n)
    .nullable()
    .transform((v) => v || null);
const when = z
  .string()
  .nullable()
  .transform((v, ctx) => {
    if (!v) return null;
    const d = new Date(v);
    if (isNaN(d.getTime())) {
      ctx.addIssue({ code: 'custom', message: 'not a date' });
      return z.NEVER;
    }
    return d;
  });

/* ═══ MCQ papers & speed drills ═════════════════════════════════════════ */


export const PaperPatch = z.object({
  title: z.string().trim().min(1, 'A paper needs a name').max(80).optional(),
  kind: z.enum(['paper', 'drill']).optional(),
  cohort: cohort.optional(),
  unit: unit.optional(),
  minutes: z.coerce.number().int().min(1).max(240).optional(),
  shuffle: z.boolean().optional(),
  published: z.boolean().optional(),
  instructions: optText(400).optional(),
  openFrom: when.optional(),
  openTo: when.optional(),
  documentId: z.coerce.number().int().positive().nullable().optional(),
});

export async function listPapers(kind: 'paper' | 'drill') {
  return db()
    .select({
      id: P.id,
      title: P.title,
      kind: P.kind,
      mode: P.mode,
      documentId: P.documentId,
      unit: P.unit,
      cohort: P.cohort,
      minutes: P.minutes,
      published: P.published,
      shuffle: P.shuffle,
      openFrom: P.openFrom,
      openTo: P.openTo,
      updatedAt: P.updatedAt,
      n: sql<number>`(select count(*)::int from ${Q} q where q.paper_id = "mcq_papers"."id")`,
      sat: sql<number>`(select count(*)::int from ${schema.mcqAttempts} a where a.paper_id = "mcq_papers"."id" and a.finished_at is not null)`,
    })
    .from(P)
    .where(eq(P.kind, kind))
    .orderBy(desc(P.updatedAt));
}

export async function createPaper(title: string, kind: 'paper' | 'drill', staffId: number) {
  const [row] = await db()
    .insert(P)
    .values({ title: title.slice(0, 80), kind, minutes: kind === 'drill' ? 10 : 15, createdBy: staffId })
    .returning();
  await invalidate(TAG.mcq);
  return row;
}

async function paperOr404(id: number) {
  const [p] = await db().select().from(P).where(eq(P.id, id)).limit(1);
  if (!p) throw notFound('That paper');
  return p;
}

export async function getPaper(id: number) {
  const p = await paperOr404(id);
  const qs = await db().select().from(Q).where(eq(Q.paperId, id)).orderBy(asc(Q.ord), asc(Q.id));
  let doc: { id: number; title: string; pages: number | null } | null = null;
  if (p.documentId) {
    const [d] = await db()
      .select({ id: schema.documents.id, title: schema.documents.title, pages: schema.documents.pages })
      .from(schema.documents)
      .where(eq(schema.documents.id, p.documentId))
      .limit(1);
    doc = d ?? null;
  }
  const [{ attempts }] = await db()
    .select({ attempts: sql<number>`count(*)::int` })
    .from(schema.mcqAttempts)
    .where(eq(schema.mcqAttempts.paperId, id));
  return { paper: p, questions: qs, document: doc, attempts };
}

export async function patchPaper(id: number, patch: z.infer<typeof PaperPatch>) {
  const cur = await paperOr404(id);
  const from = patch.openFrom !== undefined ? patch.openFrom : cur.openFrom;
  const to = patch.openTo !== undefined ? patch.openTo : cur.openTo;
  if (from && to && to <= from) throw new HttpError(400, 'It closes before it opens.', 'invalid');
  if (patch.published && !(await questionCount(id))) throw new HttpError(400, 'Add a question before publishing.', 'empty');
  if (patch.documentId) await assertDocument(patch.documentId);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) set[k] = v;
  const [row] = await db().update(P).set(set).where(eq(P.id, id)).returning();
  await invalidate(TAG.mcq);
  return row;
}

async function questionCount(paperId: number) {
  const [{ n }] = await db().select({ n: sql<number>`count(*)::int` }).from(Q).where(eq(Q.paperId, paperId));
  return n;
}

async function assertDocument(id: number) {
  const [d] = await db().select({ id: schema.documents.id }).from(schema.documents).where(eq(schema.documents.id, id)).limit(1);
  if (!d) throw new HttpError(400, 'That PDF is not in the library.', 'invalid');
}

export async function deletePaper(id: number) {
  const p = await paperOr404(id);
  await db().delete(P).where(eq(P.id, id));
  await invalidate(TAG.mcq);
  return p;
}

/* the list sorts on updated_at, so editing a question touches the paper */
const touchPaper = (id: number) => db().update(P).set({ updatedAt: new Date() }).where(eq(P.id, id));

export const McqQuestionIn = z.object({
  q: z.string().max(600),
  opts: z.array(z.string().max(180)).min(1).max(5),
  answer: z.number().int().min(0).max(4),
  marks: z.coerce.number().int().min(1).max(5).default(1),
  why: optText(300).optional(),
  imageMediaId: mediaId.nullable().optional(),
  optImages: optImages(5),
});

export async function saveMcqQuestion(paperId: number, qid: number | null, input: z.infer<typeof McqQuestionIn>) {
  await paperOr404(paperId);
  const t = tidyOptions(input.q, input.opts, input.answer, 180, input.optImages, input.imageMediaId ?? null);
  await assertMedia([input.imageMediaId, ...(t.optImages ?? [])]);
  const row = {
    q: input.q.trim().slice(0, 600),
    opts: t.opts,
    optImages: t.optImages,
    answer: t.answer,
    marks: input.marks,
    why: input.why ?? null,
    imageMediaId: input.imageMediaId ?? null,
  };
  let out;
  if (qid) {
    [out] = await db()
      .update(Q)
      .set(row)
      .where(and(eq(Q.id, qid), eq(Q.paperId, paperId)))
      .returning();
    if (!out) throw notFound('That question');
  } else {
    const [{ last }] = await db().select({ last: sql<number | null>`max(${Q.ord})` }).from(Q).where(eq(Q.paperId, paperId));
    [out] = await db()
      .insert(Q)
      .values({ ...row, paperId, ord: (last ?? 0) + 1 })
      .returning();
  }
  await touchPaper(paperId);
  await invalidate(TAG.mcq);
  return out;
}

export async function deleteMcqQuestion(paperId: number, qid: number) {
  await db()
    .delete(Q)
    .where(and(eq(Q.id, qid), eq(Q.paperId, paperId)));
  await touchPaper(paperId);
  await invalidate(TAG.mcq);
}

/** Swap two neighbours' ord; equal ords fall back to positions (the original rule). */
async function swapOrd(rows: { id: number; ord: number }[], id: number, dir: -1 | 1, setOrd: (id: number, ord: number) => Promise<unknown>) {
  const i = rows.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= rows.length) return;
  let ao = rows[i].ord;
  let bo = rows[j].ord;
  if (ao === bo) {
    ao = i + 1;
    bo = j + 1;
  }
  await setOrd(rows[i].id, bo);
  await setOrd(rows[j].id, ao);
}

export async function moveMcqQuestion(paperId: number, qid: number, dir: -1 | 1) {
  const rows = await db().select({ id: Q.id, ord: Q.ord }).from(Q).where(eq(Q.paperId, paperId)).orderBy(asc(Q.ord), asc(Q.id));
  await swapOrd(rows, qid, dir, (id, ord) => db().update(Q).set({ ord }).where(eq(Q.id, id)));
  await touchPaper(paperId);
}

/* ── PDF mode ──────────────────────────────────────────────────────────
   The questions are a PDF from the library. Each row is "Question N" with
   options '1'..'n' and the key. Rows are updated IN PLACE by position so a
   student who has already started keeps answers that point at live ids. */

export const PdfKeyIn = z.object({
  documentId: z.number().int().positive(),
  options: z.number().int().min(2).max(5),
  marks: z.number().int().min(1).max(5).default(1),
  answers: z.array(z.number().int().min(-1).max(4)).min(1).max(100),
});

export async function savePdfKey(paperId: number, input: z.infer<typeof PdfKeyIn>) {
  await paperOr404(paperId);
  await assertDocument(input.documentId);
  const missing = input.answers.findIndex((a) => a < 0 || a >= input.options);
  if (missing >= 0) throw new HttpError(400, `Question ${missing + 1} has no answer ticked.`, 'invalid');
  const opts = Array.from({ length: input.options }, (_, i) => String(i + 1));
  await db().transaction(async (tx) => {
    const cur = await tx.select({ id: Q.id }).from(Q).where(eq(Q.paperId, paperId)).orderBy(asc(Q.ord), asc(Q.id));
    for (let i = 0; i < input.answers.length; i++) {
      const row = { q: `Question ${i + 1}`, opts, answer: input.answers[i], marks: input.marks, ord: i + 1, why: null, imageMediaId: null, optImages: null };
      if (cur[i]) await tx.update(Q).set(row).where(eq(Q.id, cur[i].id));
      else await tx.insert(Q).values({ ...row, paperId });
    }
    for (const extra of cur.slice(input.answers.length)) await tx.delete(Q).where(eq(Q.id, extra.id));
    await tx.update(P).set({ mode: 'pdf', documentId: input.documentId, updatedAt: new Date() }).where(eq(P.id, paperId));
  });
  await invalidate(TAG.mcq);
  return getPaper(paperId);
}

/** Back to typed questions. The bubble rows are only placeholders, so they go. */
export async function leavePdfMode(paperId: number) {
  const p = await paperOr404(paperId);
  if (p.mode !== 'pdf') return getPaper(paperId);
  await db().transaction(async (tx) => {
    await tx.delete(Q).where(eq(Q.paperId, paperId));
    await tx.update(P).set({ mode: 'questions', documentId: null, published: false, updatedAt: new Date() }).where(eq(P.id, paperId));
  });
  await invalidate(TAG.mcq);
  return getPaper(paperId);
}

/* ── CSV import: question, option1..option5, answer (1-based), marks, why ── */

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

export async function importCsv(paperId: number, text: string) {
  const p = await paperOr404(paperId);
  if (p.mode === 'pdf') throw new HttpError(400, 'This paper is in PDF mode. Switch to typed questions first.', 'pdf_mode');
  const rows = parseCsv(text);
  if (!rows.length) throw new HttpError(400, 'That file is empty.', 'invalid');
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const hasHeader = head[0] === 'question';
  const col = (name: string, fallback: number) => {
    const i = head.indexOf(name);
    return hasHeader && i >= 0 ? i : fallback;
  };
  const cq = col('question', 0);
  const co = [1, 2, 3, 4, 5].map((n) => col(`option${n}`, n));
  const ca = col('answer', 6);
  const cm = col('marks', 7);
  const cw = col('why', 8);
  const body = hasHeader ? rows.slice(1) : rows;
  const out: (typeof Q.$inferInsert)[] = [];
  const errors: string[] = [];
  body.forEach((r, i) => {
    const line = i + (hasHeader ? 2 : 1);
    try {
      const ans = Number(r[ca]) - 1;
      if (!Number.isInteger(ans) || ans < 0 || ans > 4) throw new HttpError(400, 'answer must be 1–5');
      const t = tidyOptions(r[cq] ?? '', co.map((c) => r[c] ?? ''), ans, 180);
      const marks = Math.min(5, Math.max(1, Number(r[cm]) || 1));
      out.push({ paperId, q: String(r[cq]).trim().slice(0, 600), opts: t.opts, answer: t.answer, marks, why: (r[cw] ?? '').trim().slice(0, 300) || null, ord: 0 });
    } catch (e) {
      errors.push(`Line ${line}: ${(e as Error).message}`);
    }
  });
  if (errors.length) throw new HttpError(400, errors.slice(0, 5).join(' · ') + (errors.length > 5 ? ` · and ${errors.length - 5} more` : ''), 'csv');
  if (!out.length) throw new HttpError(400, 'No questions found in that file.', 'invalid');
  if (out.length > 200) throw new HttpError(400, 'At most 200 questions at a time.', 'invalid');
  await db().transaction(async (tx) => {
    const [{ last }] = await tx.select({ last: sql<number | null>`max(${Q.ord})` }).from(Q).where(eq(Q.paperId, paperId));
    let ord = last ?? 0;
    await tx.insert(Q).values(out.map((r) => ({ ...r, ord: ++ord })));
    await tx.update(P).set({ updatedAt: new Date() }).where(eq(P.id, paperId));
  });
  await invalidate(TAG.mcq);
  return { added: out.length };
}

/* ═══ Essay templates ═══════════════════════════════════════════════════ */


export async function listEssays() {
  return db()
    .select()
    .from(E)
    .orderBy(sql`${E.unit} asc nulls last`, asc(E.title));
}

export async function createEssay(title: string, staffId: number) {
  const parts = ['Introduction', 'Point 1', 'Point 2', 'Point 3', 'Conclusion'].map((h) => ({ h, t: '', m: null as unknown as number }));
  const [row] = await db()
    .insert(E)
    .values({ title: title.slice(0, 120), marks: 15, parts, createdBy: staffId })
    .returning();
  await invalidate(TAG.essays);
  return row;
}

export const EssayIn = z.object({
  title: z.string().trim().min(1, 'A template needs a title').max(120),
  unit: unit,
  cohort,
  marks: z.coerce.number().int().min(1).max(50),
  question: optText(600),
  parts: z
    .array(z.object({ h: z.string().max(80).default(''), t: z.string().max(800).default(''), m: z.number().int().min(0).max(25).nullable().optional() }))
    .max(30),
  notes: optText(800),
  published: z.boolean(),
});

export async function saveEssay(id: number, input: z.infer<typeof EssayIn>) {
  // a part with no heading and no words is an empty row, not a part
  const parts = input.parts
    .map((p) => ({ h: p.h.trim(), t: p.t.trim(), m: p.m ?? null }))
    .filter((p) => p.h || p.t) as { h: string; t?: string; m?: number }[];
  if (!parts.length) throw new HttpError(400, 'Add at least one part to the layout', 'invalid');
  const [row] = await db()
    .update(E)
    .set({ ...input, parts, updatedAt: new Date() })
    .where(eq(E.id, id))
    .returning();
  if (!row) throw notFound('That template');
  await invalidate(TAG.essays);
  return row;
}

export async function deleteEssay(id: number) {
  const [row] = await db().delete(E).where(eq(E.id, id)).returning();
  if (!row) throw notFound('That template');
  await invalidate(TAG.essays);
  return row;
}

/* ═══ Live class quiz: question sets ════════════════════════════════════ */

export const QUIZ_SECONDS = [10, 15, 20, 30, 45, 60];

export async function listQuizzes() {
  return db()
    .select({
      id: QZ.id,
      title: QZ.title,
      unit: QZ.unit,
      cohort: QZ.cohort,
      note: QZ.note,
      published: QZ.published,
      updatedAt: QZ.updatedAt,
      n: sql<number>`(select count(*)::int from ${QQ} q where q.quiz_id = "quizzes"."id")`,
    })
    .from(QZ)
    .orderBy(desc(QZ.updatedAt));
}

export async function createQuiz(title: string, staffId: number) {
  const [row] = await db()
    .insert(QZ)
    .values({ title: title.slice(0, 80), createdBy: staffId })
    .returning();
  return row;
}

async function quizOr404(id: number) {
  const [q] = await db().select().from(QZ).where(eq(QZ.id, id)).limit(1);
  if (!q) throw notFound('That question set');
  return q;
}

export async function getQuiz(id: number) {
  const quiz = await quizOr404(id);
  const questions = await db().select().from(QQ).where(eq(QQ.quizId, id)).orderBy(asc(QQ.ord), asc(QQ.id));
  return { quiz, questions };
}

export const QuizPatch = z.object({
  title: z.string().trim().min(1, 'A set needs a name').max(80).optional(),
  unit: unit.optional(),
  cohort: cohort.optional(),
  note: optText(400).optional(),
  published: z.boolean().optional(),
});

export async function patchQuiz(id: number, patch: z.infer<typeof QuizPatch>) {
  await quizOr404(id);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) set[k] = v;
  const [row] = await db().update(QZ).set(set).where(eq(QZ.id, id)).returning();
  return row;
}

export async function deleteQuiz(id: number) {
  const q = await quizOr404(id);
  await db().delete(QZ).where(eq(QZ.id, id));
  return q;
}

const touchQuiz = (id: number) => db().update(QZ).set({ updatedAt: new Date() }).where(eq(QZ.id, id));

export const QuizQuestionIn = z.object({
  q: z.string().max(300),
  opts: z.array(z.string().max(120)).min(1).max(4),
  answer: z.number().int().min(0).max(3),
  seconds: z.coerce
    .number()
    .int()
    .refine((s) => QUIZ_SECONDS.includes(s), 'pick 10, 15, 20, 30, 45 or 60')
    .default(20),
  pointsX: z.coerce.number().int().min(1).max(2).default(1),
  why: optText(200).optional(),
  imageMediaId: mediaId.nullable().optional(),
  optImages: optImages(4),
});

export async function saveQuizQuestion(quizId: number, qid: number | null, input: z.infer<typeof QuizQuestionIn>) {
  await quizOr404(quizId);
  const t = tidyOptions(input.q, input.opts, input.answer, 120, input.optImages, input.imageMediaId ?? null);
  await assertMedia([input.imageMediaId, ...(t.optImages ?? [])]);
  const row = {
    q: input.q.trim().slice(0, 300),
    imageMediaId: input.imageMediaId ?? null,
    opts: t.opts,
    optImages: t.optImages,
    answer: t.answer,
    seconds: input.seconds,
    pointsX: input.pointsX,
    why: input.why ?? null,
  };
  let out;
  if (qid) {
    [out] = await db()
      .update(QQ)
      .set(row)
      .where(and(eq(QQ.id, qid), eq(QQ.quizId, quizId)))
      .returning();
    if (!out) throw notFound('That question');
  } else {
    const [{ last }] = await db().select({ last: sql<number | null>`max(${QQ.ord})` }).from(QQ).where(eq(QQ.quizId, quizId));
    [out] = await db()
      .insert(QQ)
      .values({ ...row, quizId, ord: (last ?? 0) + 1 })
      .returning();
  }
  await touchQuiz(quizId);
  return out;
}

export async function deleteQuizQuestion(quizId: number, qid: number) {
  await db()
    .delete(QQ)
    .where(and(eq(QQ.id, qid), eq(QQ.quizId, quizId)));
  await touchQuiz(quizId);
}

export async function moveQuizQuestion(quizId: number, qid: number, dir: -1 | 1) {
  const rows = await db().select({ id: QQ.id, ord: QQ.ord }).from(QQ).where(eq(QQ.quizId, quizId)).orderBy(asc(QQ.ord), asc(QQ.id));
  await swapOrd(rows, qid, dir, (id, ord) => db().update(QQ).set({ ord }).where(eq(QQ.id, id)));
}

/** The lobby list: everyone who joined, in join order (a joining list, not a ranking). */
export async function lobbyPlayers(gameId: number) {
  return db()
    .select({ nickname: schema.quizPlayers.nickname, avatar: schema.quizPlayers.avatar })
    .from(schema.quizPlayers)
    .where(eq(schema.quizPlayers.gameId, gameId))
    .orderBy(asc(schema.quizPlayers.joinedAt));
}

export async function gameMeta(gameId: number) {
  const [g] = await db()
    .select({ id: schema.quizGames.id, pin: schema.quizGames.pin, quizId: schema.quizGames.quizId, title: QZ.title, state: schema.quizGames.state })
    .from(schema.quizGames)
    .innerJoin(QZ, eq(QZ.id, schema.quizGames.quizId))
    .where(eq(schema.quizGames.id, gameId))
    .limit(1);
  if (!g) throw notFound('That game');
  return g;
}
