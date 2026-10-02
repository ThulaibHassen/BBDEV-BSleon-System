import { z } from 'zod';
import { handle, body } from '@/lib/server/api';
import { requireStudent } from '@/lib/server/auth';
import { db, schema } from '@/lib/server/db';
import { todayISO } from '@/lib/shared/dates';

/* A past-paper attempt the student logs themselves. Always self-marked:
   only Leon's side can record an attempt as marked by him. */

const ERRS = ['', 'Knowledge gap', 'Misread question', 'Application', 'Answer structure', 'Terminology', 'Time management', 'Careless'] as const;
const Body = z
  .object({
    paper: z.string().trim().min(1, 'Which paper?').max(80),
    q: z.string().trim().min(1, 'Which question?').max(40),
    score: z.number().int().min(0).max(1000),
    max: z.number().int().min(1).max(1000),
    timed: z.boolean(),
    err: z.enum(ERRS).default(''),
  })
  .refine((b) => b.score <= b.max, { message: 'Score must be between 0 and the maximum.', path: ['score'] });

export const POST = handle(async (req) => {
  const p = await requireStudent();
  const b = await body(req, Body);
  const A = schema.paperAttempts;
  const [row] = await db()
    .insert(A)
    .values({ studentId: p.id, date: todayISO(), paper: b.paper, q: b.q, score: b.score, max: b.max, timed: b.timed, marker: 'self', err: b.err || null })
    .returning({ id: A.id, date: A.date, paper: A.paper, q: A.q, score: A.score, max: A.max, timed: A.timed, marker: A.marker, err: A.err });
  return { attempt: { ...row, err: row.err ?? '' } };
});
