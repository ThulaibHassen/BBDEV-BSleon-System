import { z } from 'zod';
import { handle, body } from '@/lib/server/api';
import { requireStudent, HttpError } from '@/lib/server/auth';
import { subscribe, unsubscribe } from '@/lib/server/push';

/* This phone, on or off for reminders. The device is saved against the
   signed-in student; who they are comes from the session, never the body. */

const Sub = z.object({
  endpoint: z.string().url().max(1000),
  p256dh: z.string().min(10).max(200),
  auth: z.string().min(8).max(100),
  ua: z.string().max(400).optional(),
});

export const POST = handle(async (req) => {
  const p = await requireStudent();
  const b = await body(req, Sub);
  try {
    await subscribe({ audience: 'student', studentId: p.id, endpoint: b.endpoint, p256dh: b.p256dh, auth: b.auth, ua: b.ua });
  } catch {
    throw new HttpError(400, 'This phone gave an address the server cannot use.', 'bad_endpoint');
  }
  return { ok: true };
});

export const DELETE = handle(async (req) => {
  const p = await requireStudent();
  const { endpoint } = await body(req, z.object({ endpoint: z.string().max(1000) }));
  await unsubscribe(endpoint, { studentId: p.id });
  return { ok: true };
});
