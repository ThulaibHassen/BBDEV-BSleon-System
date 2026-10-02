/* Port of the original _dev/tests/sql/flow.sql — the MCQ lifecycle against a
   REAL Postgres (the bug that would have broken every submission was caught
   only that way). Run:  npm test
   Uses the DATABASE_URL in .env; creates its own rows and removes them. */

import 'dotenv/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema, pool } from '@/lib/server/db';
import * as mcq from '@/server/mcq';
import { points } from '@/server/quiz';

let s1 = 0;
let s2 = 0;
let other = 0;
let paper = 0;
let draft = 0;
let shuffled = 0;
let q11 = 0;
let q12 = 0;
let q13 = 0;

before(async () => {
  const d = db();
  const st = await d
    .insert(schema.students)
    .values([
      { name: 'Test Flow One', cohort: 0, loc: 'Kings' },
      { name: 'Test Flow Two', cohort: 0, loc: 'Kings' },
      { name: 'Test Flow Other', cohort: 1, loc: 'Kings' },
    ])
    .returning();
  [s1, s2, other] = st.map((s) => s.id);
  const [p] = await d.insert(schema.mcqPapers).values({ title: 'TEST paper', cohort: 0, minutes: 10, published: true }).returning();
  paper = p.id;
  const qs = await d
    .insert(schema.mcqQuestions)
    .values([
      { paperId: paper, ord: 1, q: 'q11', opts: ['a', 'b', 'c'], answer: 1, marks: 2, why: 'because' },
      { paperId: paper, ord: 2, q: 'q12', opts: ['a', 'b'], answer: 0, marks: 1 },
      { paperId: paper, ord: 3, q: 'q13', opts: ['a', 'b', 'c', 'd'], answer: 3, marks: 1 },
    ])
    .returning();
  [q11, q12, q13] = qs.map((q) => q.id);
  const [dr] = await d.insert(schema.mcqPapers).values({ title: 'TEST draft', cohort: 0, published: false }).returning();
  draft = dr.id;
  await d.insert(schema.mcqQuestions).values({ paperId: draft, q: 'x', opts: ['a', 'b'], answer: 0 });
  const [sh] = await d.insert(schema.mcqPapers).values({ title: 'TEST shuffle', cohort: null, published: true, shuffle: true }).returning();
  shuffled = sh.id;
  await d.insert(schema.mcqQuestions).values(Array.from({ length: 12 }, (_, i) => ({ paperId: shuffled, ord: i + 1, q: `s${i}`, opts: ['a', 'b'], answer: 0 })));
});

after(async () => {
  const d = db();
  await d.delete(schema.mcqPapers).where(inArray(schema.mcqPapers.id, [paper, draft, shuffled]));
  await d.delete(schema.students).where(inArray(schema.students.id, [s1, s2, other]));
  await pool().end();
});

test('1 list shows only the published paper for my batch, with questions', async () => {
  const l = await mcq.listForStudent(s1, 0);
  const ids = l.map((x) => x.id);
  assert.ok(ids.includes(paper));
  assert.ok(!ids.includes(draft));
  const lo = await mcq.listForStudent(other, 1);
  assert.ok(!lo.map((x) => x.id).includes(paper), 'other batch must not see it');
});

test('2 start returns questions WITHOUT answer or why', async () => {
  const s = await mcq.start(paper, s1, 0);
  assert.equal(s.questions.length, 3);
  for (const q of s.questions) {
    assert.ok(!('answer' in q), 'answer leaked');
    assert.ok(!('why' in q), 'why leaked');
  }
});

test('3 starting twice keeps one attempt and the same clock', async () => {
  const a = await mcq.start(paper, s1, 0);
  const b = await mcq.start(paper, s1, 0);
  assert.equal(a.startedAt, b.startedAt);
  const rows = await db().select().from(schema.mcqAttempts).where(eq(schema.mcqAttempts.studentId, s1));
  assert.equal(rows.length, 1);
});

test('4 save stores answers', async () => {
  assert.equal(await mcq.save(paper, s1, { [q11]: 1 }), true);
});

test('5 submit marks right, wrong and blank', async () => {
  const r = await mcq.submit(paper, s1, { [q11]: 1, [q12]: 1 });
  assert.equal(r.correct, 1);
  assert.equal(r.total, 3);
  assert.equal(r.marks, 2);
  assert.equal(r.maxMarks, 4);
  assert.equal(r.late, false);
  const byId = Object.fromEntries(r.review.map((x) => [x.id, x]));
  assert.equal(byId[q11].ok, true);
  assert.equal(byId[q12].ok, false);
  assert.equal(byId[q13].picked, null);
  assert.equal(byId[q11].why, 'because', 'answers and why arrive after submit');
});

test('6 a second start or submit is refused', async () => {
  await assert.rejects(() => mcq.start(paper, s1, 0), /already sat/);
  await assert.rejects(() => mcq.submit(paper, s1, {}), /Already submitted/);
});

test('7 other batch and draft are refused', async () => {
  await assert.rejects(() => mcq.start(paper, other, 1), /another batch/);
  await assert.rejects(() => mcq.start(draft, s2, 0), /not open/);
});

test('8 a student 20 min into a 10 min paper is marked late', async () => {
  await mcq.start(paper, s2, 0);
  await db()
    .update(schema.mcqAttempts)
    .set({ startedAt: new Date(Date.now() - 20 * 60_000) })
    .where(eq(schema.mcqAttempts.studentId, s2));
  const r = await mcq.submit(paper, s2, { [q11]: 1, [q12]: 0, [q13]: 3 });
  assert.equal(r.late, true);
  assert.equal(r.correct, 3, 'late submissions are still marked');
});

test('9 the list shows my score', async () => {
  const l = await mcq.listForStudent(s1, 0);
  const row = l.find((x) => x.id === paper)!;
  assert.equal(row.marks, 2);
  assert.ok(row.finished_at);
});

test('10 staff results list both attempts and per-question counts', async () => {
  const r = await mcq.results(paper);
  assert.equal(r.attempts.length, 2);
  assert.equal(r.attempts[0].studentId, s2, 'ordered by marks desc');
  const q1 = r.questions.find((q) => q.id === q11)!;
  assert.equal(q1.sat, 2);
  assert.equal(q1.gotIt, 2);
});

test('11 retake clears the attempt so the student can sit again', async () => {
  await mcq.retake(paper, s1);
  const s = await mcq.start(paper, s1, 0);
  assert.deepEqual(s.answers, {});
});

test('12 shuffle gives two students different, stable orders', async () => {
  const a1 = (await mcq.start(shuffled, s1, 0)).questions.map((q) => q.id);
  const a2 = (await mcq.start(shuffled, s1, 0)).questions.map((q) => q.id);
  const b = (await mcq.start(shuffled, s2, 0)).questions.map((q) => q.id);
  assert.deepEqual(a1, a2, 'stable for one student');
  assert.notDeepEqual(a1, b, 'differs between students');
});

test('12b on a shuffled paper the review lists questions in the order they were sat', async () => {
  const sat = (await mcq.start(shuffled, s2, 0)).questions.map((q) => q.id);
  const r = await mcq.submit(shuffled, s2, {});
  assert.deepEqual(
    r.review.map((q) => q.id),
    sat,
  );
  assert.deepEqual(
    (await mcq.review(shuffled, s2)).review.map((q) => q.id),
    sat,
  );
});

test('13 junk in answers is ignored, never stored', async () => {
  await mcq.save(paper, s1, { [q11]: 'x', '../../etc': 1, [q12]: 99, [q13]: 2 });
  const [a] = await db()
    .select()
    .from(schema.mcqAttempts)
    .where(and(eq(schema.mcqAttempts.studentId, s1), eq(schema.mcqAttempts.paperId, paper)));
  assert.deepEqual(a.answers, { [q13]: 2 });
});

test('14 quiz points: 1000 at 0 ms, 500 at the limit, double, streak cap', () => {
  assert.equal(points(0, 20, 1, 0), 1000);
  assert.equal(points(20_000, 20, 1, 0), 500);
  assert.equal(points(99_000, 20, 1, 0), 500);
  assert.equal(points(0, 20, 2, 0), 2000);
  assert.equal(points(0, 20, 1, 3), 1300);
  assert.equal(points(0, 20, 1, 9), 1500);
});
