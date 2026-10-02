import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { handle, body, jsonCached, query } from '@/lib/server/api';
import { db, schema } from '@/lib/server/db';
import { requireStaff, HttpError } from '@/lib/server/auth';
import { createMessage, messagesPage } from '@/server/messages';
import { MSG_TYPES } from '@/lib/shared/constants';
import { colomboToDate } from '@/lib/shared/dates';

/* Messages to the student app. POST sends now (fan-out + push) or, with
   schedFor ('YYYY-MM-DD HH:MM' Colombo), parks it for the hourly tick. */

/** ?to=<studentId> also returns that student, for the "Message their app" jump. */
export const GET = handle(async (req) => {
  await requireStaff('messages.send');
  const to = Number(query(req).get('to')) || 0;
  const [page, student] = await Promise.all([
    messagesPage(),
    to
      ? db()
          .select({ id: schema.students.id, name: schema.students.name, status: schema.students.status })
          .from(schema.students)
          .where(eq(schema.students.id, to))
          .limit(1)
      : Promise.resolve([]),
  ]);
  return jsonCached({ ...page, to: student[0] ?? null });
});

const Body = z.object({
  type: z.enum(Object.keys(MSG_TYPES) as [keyof typeof MSG_TYPES, ...(keyof typeof MSG_TYPES)[]]),
  aud: z.string().max(40),
  title: z.string().trim().max(80, 'Keep the title under 80 characters.'),
  body: z.string().trim().max(400, 'Keep the message under 400 characters.'),
  courier: z.object({ co: z.string().max(40).optional(), no: z.string().max(30).optional() }).nullish(),
  schedFor: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/, 'Pick a date and time.')
    .nullish(),
});

export const POST = handle(async (req) => {
  const p = await requireStaff('messages.send');
  const b = await body(req, Body);
  let schedFor: Date | null = null;
  if (b.schedFor) {
    schedFor = colomboToDate(b.schedFor);
    if (Number.isNaN(schedFor.getTime())) throw new HttpError(400, 'Pick a date and time.', 'invalid');
    if (schedFor.getTime() <= Date.now()) throw new HttpError(400, 'Pick a time in the future, or send it now.', 'invalid');
  }
  return createMessage({ ...b, schedFor }, p);
});
