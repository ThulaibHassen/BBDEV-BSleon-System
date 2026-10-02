import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { handle } from '@/lib/server/api';
import { requireStaff, HttpError } from '@/lib/server/auth';
import { env } from '@/lib/server/env';
import { runReminders, sendTest } from '@/server/push-reminders';

/* The hourly tick (Railway cron at :00 Colombo → scripts/cron-push.ts).
   Sends scheduled messages that are due, student reminders in a sending
   hour, and parent fee reminders on their own day and hour.

   Callers:
   - cron: header x-cron-secret must equal CRON_SECRET
   - an owner or manager (staff session): {test:true, studentId} or {run:true}
   Repeat calls are harmless: hours, daily caps and rest periods hold. */

function cronOk(req: Request) {
  const want = env().CRON_SECRET;
  const got = req.headers.get('x-cron-secret');
  if (!want || !got) return false;
  const a = Buffer.from(want);
  const b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

const Body = z
  .object({ test: z.boolean().optional(), studentId: z.number().int().positive().optional(), run: z.boolean().optional() })
  .catch({});

export const POST = handle(async (req) => {
  const raw = await req.json().catch(() => ({}));
  const b = Body.parse(raw);
  if (cronOk(req) && !b.test && !b.run) return runReminders('tick');

  const p = await requireStaff('app.manage');
  if (b.test) {
    if (!b.studentId) throw new HttpError(400, 'Which student?', 'invalid');
    return sendTest(b.studentId, p.id);
  }
  if (b.run) return runReminders('run');
  throw new HttpError(400, 'Say test or run.', 'invalid');
});
