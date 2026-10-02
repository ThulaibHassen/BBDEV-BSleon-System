/* Regressions from the papers / library review: the live-quiz host state
   machine, and the library's upload / edit / delete bookkeeping. Real
   Postgres (DATABASE_URL in .env); creates its own rows and removes them. */

import 'dotenv/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import { db, schema, pool } from '@/lib/server/db';
import * as quiz from '@/server/quiz';
import * as docs from '@/server/documents';

let staffId = 0;
let quizId = 0;
const docIds: number[] = [];

async function pdfFile(name: string) {
  const d = await PDFDocument.create();
  d.addPage([200, 200]).drawText(`${name} ${Date.now()} ${Math.random()}`);
  return new File([new Uint8Array(await d.save())], `${name}.pdf`, { type: 'application/pdf' });
}

before(async () => {
  const d = db();
  const [s] = await d.insert(schema.staff).values({ name: 'Test Papers Review', email: `test.papers.${Date.now()}@example.com`, role: 'owner' }).returning();
  staffId = s.id;
  const [q] = await d.insert(schema.quizzes).values({ title: 'TEST host quiz', published: true }).returning();
  quizId = q.id;
  await d.insert(schema.quizQuestions).values([1, 2, 3].map((ord) => ({ quizId, ord, q: `q${ord}`, opts: ['a', 'b'], answer: 0 })));
});

after(async () => {
  const d = db();
  await d.delete(schema.quizzes).where(eq(schema.quizzes.id, quizId));
  await d.delete(schema.tuteAssign).where(eq(schema.tuteAssign.unit, 'TST'));
  if (docIds.length) {
    const left = await d.select({ id: schema.documents.id }).from(schema.documents).where(inArray(schema.documents.id, docIds));
    for (const r of left) await docs.remove(r.id);
  }
  await d.delete(schema.staff).where(eq(schema.staff.id, staffId));
  await pool().end();
});

test('quiz host: a repeated "next" cannot skip a question', async () => {
  const g = await quiz.createGame(quizId, staffId);
  let s = await quiz.host(g.id, 'next', -1);
  assert.equal(s.state, 'question');
  assert.equal(s.qIndex, 0);
  s = await quiz.host(g.id, 'next', -1); // the double click
  assert.equal(s.qIndex, 0);
  s = await quiz.host(g.id, 'next'); // no reveal yet: next is not offered
  assert.equal(s.qIndex, 0);
  s = await quiz.host(g.id, 'reveal', 0);
  assert.equal(s.state, 'reveal');
  const two = await Promise.all([quiz.host(g.id, 'next', 0), quiz.host(g.id, 'next', 0)]);
  assert.deepEqual(
    two.map((x) => x.qIndex),
    [1, 1],
    'two racing clicks move one step',
  );
  s = await quiz.host(g.id, 'reveal', 0); // a late auto-reveal for the previous question
  assert.equal(s.state, 'question');
});

test('quiz host: an ended game stays ended and never shows its answer', async () => {
  const g = await quiz.createGame(quizId, staffId);
  await quiz.host(g.id, 'next');
  await quiz.host(g.id, 'end');
  let s = await quiz.host(g.id, 'reveal');
  assert.equal(s.state, 'ended');
  assert.equal(s.question?.answer, null);
  s = await quiz.host(g.id, 'next');
  assert.equal(s.state, 'ended');
});

test('library upload: a refused pair leaves no row behind', async () => {
  const f = await pdfFile('pairbad');
  await assert.rejects(() => docs.upload(f, docs.DocMeta.parse({ title: 'TEST pair bad', pairId: 2_000_000_000 }), staffId), /pair with was not found/);
  const rows = await db().select({ id: schema.documents.id }).from(schema.documents).where(eq(schema.documents.title, 'TEST pair bad'));
  assert.equal(rows.length, 0);
  // and the same file can still be uploaded (no "already in the library")
  const row = await docs.upload(f, docs.DocMeta.parse({ title: 'TEST pair bad' }), staffId);
  docIds.push(row.id);
});

test('library edit: saving other fields does not mark a picture PDF searchable', async () => {
  const row = await docs.upload(await pdfFile('scan'), docs.DocMeta.parse({ title: 'TEST scan', source: 'leon' }), staffId);
  docIds.push(row.id);
  await db().update(schema.documents).set({ hasText: false }).where(eq(schema.documents.id, row.id)); // as made from pictures
  const after = await docs.update(row.id, docs.DocMeta.parse({ title: 'TEST scan', source: 'leon', published: false }));
  assert.equal(after.hasText, false);
});

test('library delete: a tute set loses its link, not its date', async () => {
  const row = await docs.upload(await pdfFile('tute'), docs.DocMeta.parse({ title: 'TEST tute', kind: 'tute' }), staffId);
  docIds.push(row.id);
  await db().insert(schema.tuteAssign).values({ unit: 'TST', cohort: 9, date: '2026-01-01', documentId: row.id });
  await docs.remove(row.id);
  const [t] = await db().select().from(schema.tuteAssign).where(eq(schema.tuteAssign.unit, 'TST'));
  assert.equal(t.documentId, null);
});
