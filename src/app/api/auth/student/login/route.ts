import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { handle, body } from '@/lib/server/api';
import { db, schema } from '@/lib/server/db';
import { verifyPassword } from '@/lib/server/password';
import { startSession, HttpError } from '@/lib/server/auth';
import { rateLimit, clientIp } from '@/lib/server/ratelimit';
import { todayISO } from '@/lib/shared/dates';

/* Student sign-in: username (first name, de-duplicated) + the one-time code
   Leon's team issued. The code is not consumed — it keeps working until it
   expires, so a student can sign in on a second phone. Five wrong codes lock
   the login until staff issue a new code. Wording is for teenagers. */

const Body = z.object({
  username: z.string().trim().min(1, 'Enter your name.').max(60),
  code: z.string().trim().transform((s) => s.replace(/\D/g, '')).pipe(z.string().min(4, 'Enter the code from Leon.').max(10)),
});

const MAX_FAILED = 5;

export const POST = handle(async (req) => {
  const ip = clientIp(req);
  const { username, code } = await body(req, Body);
  if (!(await rateLimit(`student-login:ip:${ip}`, 40, 600)).ok || !(await rateLimit(`student-login:u:${username.toLowerCase()}`, 12, 600)).ok) {
    throw new HttpError(429, 'Too many tries. Wait a few minutes, then try again.', 'rate_limited');
  }
  const d = db();
  const [login] = await d
    .select()
    .from(schema.appLogins)
    .where(sql`lower(${schema.appLogins.username}) = ${username.toLowerCase()}`)
    .limit(1);

  const generic = new HttpError(401, 'That name and code do not match. Check both and try again.', 'bad_credentials');
  if (!login) {
    await verifyPassword(null, code); // same timing as a real check
    throw generic;
  }
  if (login.status === 'locked') {
    throw new HttpError(423, 'Your login is locked after too many tries. Ask Leon or Bihandu at class for a new code.', 'locked');
  }
  if (!login.codeHash) {
    throw new HttpError(401, 'No code has been issued for you yet. Ask Leon or Bihandu at class.', 'no_code');
  }
  if (login.codeExpires && login.codeExpires < new Date()) {
    throw new HttpError(401, 'That code has expired. Ask Leon or Bihandu at class for a new one.', 'expired');
  }
  if (!(await verifyPassword(login.codeHash, code))) {
    // counted in SQL: parallel guesses must not all read the same old count
    const F = schema.appLogins.failed;
    const [after] = await d
      .update(schema.appLogins)
      .set({
        failed: sql`${F} + 1`,
        status: sql`case when ${F} + 1 >= ${MAX_FAILED} then 'locked' else ${schema.appLogins.status} end`,
      })
      .where(eq(schema.appLogins.id, login.id))
      .returning({ failed: F });
    if ((after?.failed ?? 0) >= MAX_FAILED) {
      throw new HttpError(423, 'Your login is locked after too many tries. Ask Leon or Bihandu at class for a new code.', 'locked');
    }
    throw generic;
  }

  const [st] = await d.select().from(schema.students).where(eq(schema.students.id, login.studentId)).limit(1);
  if (!st) throw new HttpError(404, 'Your record could not be found. Tell Leon.', 'no_student');

  await d
    .update(schema.appLogins)
    .set({ failed: 0, status: 'active', lastActive: todayISO(), sessions: sql`${schema.appLogins.sessions} + 1` })
    .where(eq(schema.appLogins.id, login.id));
  await startSession({ realm: 'student', principalId: st.id, role: 'student', name: st.name, ip, userAgent: req.headers.get('user-agent') ?? undefined });
  return { student: { id: st.id, name: st.name, cohort: st.cohort } };
});
