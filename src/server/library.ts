import 'server-only';
import { and, desc, eq, ne, sql, isNull, or, lte, gte } from 'drizzle-orm';
import { db, schema } from '@/lib/server/db';
import { cached, invalidate, TAG } from '@/lib/server/cache';
import { HttpError } from '@/lib/server/auth';
import { mintTicket } from '@/lib/server/tickets';

/* The document library (was bswl_library + bswl_library_grant).
   Postgres decides who may open what; the PDF bytes stay in the private
   "documents" bucket and reach a phone only through a 120-second ticket.

   Student visibility rule (one place, so the list and the grant agree):
     published AND audience in (public, students)
     AND (cohort is null OR cohort = the student's batch)
     AND (available_from is null OR <= now)
     AND (available_until is null OR >= now)      ← #6 48-hour target papers */

export type StudentDoc = {
  id: number;
  title: string;
  kind: string;
  year: number | null;
  part: string | null;
  lang: string;
  source: string;
  unit: string | null;
  pages: number | null;
  bytes: number;
  hasText: boolean;
  availableUntil: string | null;
  pairId: number | null;
  note: string | null;
};

function studentWhere(cohort: number) {
  const D = schema.documents;
  return and(
    eq(D.published, true),
    sql`${D.audience} in ('public','students')`,
    or(isNull(D.cohort), eq(D.cohort, cohort)),
    or(isNull(D.availableFrom), lte(D.availableFrom, sql`now()`)),
    or(isNull(D.availableUntil), gte(D.availableUntil, sql`now()`)),
  );
}

/** Published documents a student may see. Cached per batch for 60 s (time windows matter). */
export async function listForStudent(cohort: number): Promise<StudentDoc[]> {
  return cached(
    ['library', 'student', String(cohort)],
    60,
    async () => {
      const D = schema.documents;
      const rows = await db()
        .select({
          id: D.id,
          title: D.title,
          kind: D.kind,
          year: D.year,
          part: D.part,
          lang: D.lang,
          source: D.source,
          unit: D.unit,
          pages: D.pages,
          bytes: D.bytes,
          hasText: D.hasText,
          availableUntil: D.availableUntil,
          pairId: D.pairId,
          note: D.note,
        })
        .from(D)
        // an MCQ-paper PDF is reached from Practice once its clock starts, never from the library
        .where(and(studentWhere(cohort), ne(D.kind, 'mcq')))
        .orderBy(desc(D.year), D.part, sql`${D.kind} desc`, D.lang, D.title);
      return rows.map((r) => ({ ...r, availableUntil: r.availableUntil ? r.availableUntil.toISOString() : null }));
    },
    [TAG.library],
  );
}

/** Decide, log, and mint a ticket. Same refusal for "missing" and "forbidden". */
export async function grant(opts: { docId: number; studentId?: number; cohort?: number; staffId?: number }) {
  const D = schema.documents;
  const d = db();
  // A PDF uploaded AS an MCQ paper (kind 'mcq') is never reachable here: it
  // opens only through the student's started attempt (server/student
  // .openDocument), so a timed paper cannot be read before its clock starts.
  // A past paper that an MCQ paper also uses stays an ordinary library paper.
  const where = opts.staffId
    ? eq(D.id, opts.docId)
    : and(eq(D.id, opts.docId), studentWhere(opts.cohort ?? -1), ne(D.kind, 'mcq'));
  const [doc] = await d.select({ id: D.id, title: D.title }).from(D).where(where).limit(1);
  if (!doc) throw new HttpError(403, 'Leon has not shared this one yet.', 'not_available');
  await d.insert(schema.documentLog).values({
    documentId: doc.id,
    studentId: opts.studentId ?? null,
    staffId: opts.staffId ?? null,
    asStaff: !!opts.staffId,
  });
  const who = opts.staffId ? `t${opts.staffId}` : `s${opts.studentId}`;
  const t = mintTicket(doc.id, who);
  return { url: t.url, title: doc.title, expiresAt: new Date(t.expiresAt * 1000).toISOString() };
}

/** Opens per document over the last N days (was bswl_library_reads). */
export async function reads(days = 30) {
  const r = await db().execute<{
    id: number;
    title: string;
    kind: string;
    year: number | null;
    part: number | null;
    student_opens: number;
    students: number;
    last_open: string | null;
  }>(sql`
    select d.id, d.title, d.kind, d.year, d.part,
           count(l.id) filter (where not l.as_staff)::int as student_opens,
           count(distinct l.student_id) filter (where not l.as_staff)::int as students,
           max(l.issued_at) filter (where not l.as_staff) as last_open
    from ${schema.documents} d
    left join ${schema.documentLog} l on l.document_id = d.id and l.issued_at >= now() - make_interval(days => ${days})
    group by d.id
    order by student_opens desc, d.year desc nulls last`);
  return r.rows;
}

export const invalidateLibrary = () => invalidate(TAG.library);
