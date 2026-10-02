/* RBAC matrix (must match the original nav: staff see Dashboard, Enquiries,
   Students, Task Book only; managers everything but Settings and adding
   users; owners everything) and the document library's access rules. */

import 'dotenv/config';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';
import { can, STAFF_NAV } from '@/lib/shared/rbac';
import { db, schema, pool } from '@/lib/server/db';
import { listForStudent, grant, invalidateLibrary } from '@/server/library';
import { checkTicket } from '@/lib/server/tickets';

after(async () => {
  await pool().end();
});

test('staff role sees exactly the four original pages', () => {
  const pages = STAFF_NAV.filter((n) => can('staff', n.perm)).map((n) => n.id);
  assert.deepEqual(pages.sort(), ['customers', 'dashboard', 'records', 'tasks']);
});

test('manager sees everything except Settings; owner sees all', () => {
  const m = STAFF_NAV.filter((n) => can('manager', n.perm)).map((n) => n.id);
  assert.ok(!m.includes('settings'));
  assert.equal(m.length, STAFF_NAV.length - 1);
  assert.equal(STAFF_NAV.filter((n) => can('owner', n.perm)).length, STAFF_NAV.length);
  assert.equal(can('manager', 'team.manage'), false);
  assert.equal(can('owner', 'team.manage'), true);
});

test('students and parents hold no staff permission', () => {
  for (const p of ['dashboard.view', 'students.view.own', 'library.manage', 'fees.manage'] as const) {
    assert.equal(can('student', p), false);
    assert.equal(can('parent', p), false);
  }
  assert.equal(can('student', 'parent.self'), false);
  assert.equal(can('parent', 'student.self'), false);
});

test('library: published, batch, audience and the 48-hour window decide visibility', async () => {
  const d = db();
  const base = { kind: 'paper', storageKey: '', sha256: 'x', bytes: 1 } as const;
  const now = Date.now();
  const rows = await d
    .insert(schema.documents)
    .values([
      { ...base, title: 'T open all', storageKey: `t/${now}-1.pdf`, sha256: `t/${now}-1.pdf`, published: true },
      { ...base, title: 'T draft', storageKey: `t/${now}-2.pdf`, sha256: `t/${now}-2.pdf`, published: false },
      { ...base, title: 'T 2028 only', storageKey: `t/${now}-3.pdf`, sha256: `t/${now}-3.pdf`, published: true, cohort: 1 },
      { ...base, title: 'T staff only', storageKey: `t/${now}-4.pdf`, sha256: `t/${now}-4.pdf`, published: true, audience: 'staff' },
      { ...base, title: 'T target live', storageKey: `t/${now}-5.pdf`, sha256: `t/${now}-5.pdf`, published: true, kind: 'target', availableUntil: new Date(now + 48 * 3600_000) },
      { ...base, title: 'T target over', storageKey: `t/${now}-6.pdf`, sha256: `t/${now}-6.pdf`, published: true, kind: 'target', availableUntil: new Date(now - 1000) },
      { ...base, title: 'T not yet', storageKey: `t/${now}-7.pdf`, sha256: `t/${now}-7.pdf`, published: true, availableFrom: new Date(now + 3600_000) },
    ])
    .returning();
  const ids = rows.map((r) => r.id);
  try {
    await invalidateLibrary(); // the upload route does this after every write
    const seen = (await listForStudent(0)).map((r) => r.title).filter((t) => t.startsWith('T '));
    assert.deepEqual(seen.sort(), ['T open all', 'T target live']);

    const ok = await grant({ docId: rows[0].id, studentId: 1, cohort: 0 });
    assert.match(ok.url, new RegExp(`^/api/files/${rows[0].id}\\?`));
    for (const r of [rows[1], rows[2], rows[3], rows[5], rows[6]]) {
      await assert.rejects(() => grant({ docId: r.id, studentId: 1, cohort: 0 }), /not shared/);
    }
    // staff may open drafts
    await grant({ docId: rows[1].id, staffId: 1 });

    // a ticket is bound to its document and cannot be edited
    const q = new URL('http://x' + ok.url).searchParams;
    assert.ok(checkTicket(rows[0].id, q));
    assert.equal(checkTicket(rows[1].id, q), null, 'swapped document');
    const tampered = new URLSearchParams(q);
    tampered.set('exp', String(Number(q.get('exp')) + 600));
    assert.equal(checkTicket(rows[0].id, tampered), null, 'edited expiry');
  } finally {
    await d.delete(schema.documents).where(inArray(schema.documents.id, ids));
  }
});

test('library: a past paper used by an MCQ paper stays listed; an MCQ-paper PDF never is', async () => {
  const d = db();
  const now = Date.now();
  const base = { sha256: 'x', bytes: 1, published: true } as const;
  const [past, mcqPdf] = await d
    .insert(schema.documents)
    .values([
      { ...base, title: 'T past paper', kind: 'paper', storageKey: `t/${now}-a.pdf`, sha256: `t/${now}-a.pdf` },
      { ...base, title: 'T mcq pdf', kind: 'mcq', storageKey: `t/${now}-b.pdf`, sha256: `t/${now}-b.pdf` },
    ])
    .returning();
  const papers = await d
    .insert(schema.mcqPapers)
    .values([
      { title: 'T draft built on the past paper', mode: 'pdf', documentId: past.id, published: false },
      { title: 'T mcq paper', mode: 'pdf', documentId: mcqPdf.id, published: true },
    ])
    .returning();
  try {
    await invalidateLibrary(); // the upload route does this after every write
    const seen = (await listForStudent(0)).map((r) => r.title);
    assert.ok(seen.includes('T past paper'), 'the past paper must stay in the library');
    assert.ok(!seen.includes('T mcq pdf'), 'an MCQ-paper PDF opens only from its started attempt');
    await grant({ docId: past.id, studentId: 1, cohort: 0 });
    await assert.rejects(() => grant({ docId: mcqPdf.id, studentId: 1, cohort: 0 }), /not shared/);
  } finally {
    await d.delete(schema.mcqPapers).where(inArray(schema.mcqPapers.id, papers.map((p) => p.id)));
    await d.delete(schema.documents).where(inArray(schema.documents.id, [past.id, mcqPdf.id]));
  }
});
