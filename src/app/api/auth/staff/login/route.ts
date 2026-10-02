import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { handle, body } from '@/lib/server/api';
import { db, schema } from '@/lib/server/db';
import { verifyPassword } from '@/lib/server/password';
import { startSession, HttpError } from '@/lib/server/auth';
import { rateLimit, clientIp } from '@/lib/server/ratelimit';
import { logLogin } from '@/lib/server/audit';

const Body = z.object({
  email: z.string().trim().toLowerCase().email('That email does not look right').max(200),
  password: z.string().min(1, 'Enter your password.').max(200),
});

const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;

export const POST = handle(async (req) => {
  const ip = clientIp(req);
  const { email, password } = await body(req, Body);

  const byIp = await rateLimit(`staff-login:ip:${ip}`, 30, 600);
  const byEmail = await rateLimit(`staff-login:email:${email}`, 10, 600);
  if (!byIp.ok || !byEmail.ok) {
    throw new HttpError(429, 'Too many tries. Wait a few minutes and try again.', 'rate_limited');
  }

  const d = db();
  const [s] = await d.select().from(schema.staff).where(eq(schema.staff.email, email)).limit(1);
  const ua = req.headers.get('user-agent');

  if (s?.lockedUntil && s.lockedUntil > new Date()) {
    throw new HttpError(423, 'This account is paused after several wrong passwords. Try again in 15 minutes, or ask the owner.', 'locked');
  }

  const ok = await verifyPassword(s?.passwordHash, password);
  if (!s || !ok) {
    if (s) {
      // counted in SQL: parallel guesses must not all read the same old count
      const F = schema.staff.failedLogins;
      await d
        .update(schema.staff)
        .set({
          failedLogins: sql`case when ${F} + 1 >= ${LOCK_AFTER} then 0 else ${F} + 1 end`,
          lockedUntil: sql`case when ${F} + 1 >= ${LOCK_AFTER} then now() + make_interval(mins => ${LOCK_MINUTES}) else ${schema.staff.lockedUntil} end`,
        })
        .where(eq(schema.staff.id, s.id));
      await logLogin({ realm: 'staff', staffId: s.id, name: s.name, role: s.role, ua, ip, ok: false });
    }
    throw new HttpError(401, 'That email and password did not work.', 'bad_credentials');
  }
  if (!s.active) {
    throw new HttpError(403, 'This account is not active in the team. Ask Leon.', 'inactive');
  }

  await d
    .update(schema.staff)
    .set({ failedLogins: 0, lockedUntil: null, lastLoginAt: sql`now()` })
    .where(eq(schema.staff.id, s.id));
  const sess = await startSession({ realm: 'staff', principalId: s.id, role: s.role as 'owner', name: s.name, ip, userAgent: ua ?? undefined });
  await logLogin({ realm: 'staff', staffId: s.id, name: s.name, role: s.role, ua, ip, ok: true });

  return {
    staff: { id: s.id, name: s.name, role: s.role, email: s.email, mustChangePassword: s.mustChangePassword },
    expiresIn: sess.expiresIn,
  };
});
