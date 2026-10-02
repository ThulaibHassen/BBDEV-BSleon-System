import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { handle, body } from '@/lib/server/api';
import { requireStaff, revokeAllFor, HttpError } from '@/lib/server/auth';
import { db, schema } from '@/lib/server/db';
import { hashPassword, verifyPassword, passwordProblem } from '@/lib/server/password';
import { logActivity } from '@/lib/server/audit';
import { rateLimit } from '@/lib/server/ratelimit';

const Body = z.object({ current: z.string().min(1).max(200), next: z.string().min(1).max(200) });

/** Change your own password. Signs out every OTHER session of this account. */
export const POST = handle(async (req) => {
  const p = await requireStaff();
  const { current, next } = await body(req, Body);
  // a borrowed session must not become a way to guess the current password
  if (!(await rateLimit(`pw-change:${p.id}`, 10, 600)).ok) throw new HttpError(429, 'Too many tries. Wait a few minutes and try again.', 'rate_limited');
  const problem = passwordProblem(next);
  if (problem) throw new HttpError(400, problem, 'weak_password');
  const d = db();
  const [s] = await d.select().from(schema.staff).where(eq(schema.staff.id, p.id)).limit(1);
  if (!(await verifyPassword(s?.passwordHash, current))) throw new HttpError(400, 'Your current password is not right.', 'bad_password');
  if (current === next) throw new HttpError(400, 'Pick a password you have not used here before.', 'same_password');
  await d.update(schema.staff).set({ passwordHash: await hashPassword(next), mustChangePassword: false }).where(eq(schema.staff.id, p.id));
  await revokeAllFor('staff', p.id, p.sid);
  await logActivity(p.id, 'Changed password', s.name);
  return { ok: true };
});
