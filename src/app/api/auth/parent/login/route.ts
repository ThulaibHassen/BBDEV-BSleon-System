import { z } from 'zod';
import { eq, ilike, inArray, sql } from 'drizzle-orm';
import { handle, body } from '@/lib/server/api';
import { db, schema } from '@/lib/server/db';
import { verifyPassword } from '@/lib/server/password';
import { startSession, HttpError } from '@/lib/server/auth';
import { rateLimit, clientIp } from '@/lib/server/ratelimit';
import { todayISO } from '@/lib/shared/dates';

/* Parent sign-in: the CHILD's name + the parent's 6-digit code.
   Same rules as the original parent-login function:
   - one uniform failure message, so the roster cannot be probed
   - name match: exact (case-insensitive) → unique prefix → unique first word
   - 5 wrong codes lock EVERY live parent account on that child
   - the code is not consumed; it lasts a day and works on several phones */

const Body = z.object({
  child: z.string().trim().min(1).max(80),
  code: z.string().transform((s) => s.replace(/\D/g, '')).pipe(z.string().min(4).max(10)),
});

const MAX_FAILED = 5;
const UNIFORM = () => new HttpError(401, 'That name and code do not match', 'bad_credentials');

export const POST = handle(async (req) => {
  const ip = clientIp(req);
  let parsed;
  try {
    parsed = await body(req, Body);
  } catch {
    throw new HttpError(400, "Enter your child's name and the code", 'invalid');
  }
  const { child, code } = parsed;
  if (!(await rateLimit(`parent-login:ip:${ip}`, 30, 600)).ok || !(await rateLimit(`parent-login:c:${child.toLowerCase()}`, 12, 600)).ok) {
    throw new HttpError(429, 'Too many tries. Wait a few minutes, then try again.', 'rate_limited');
  }
  const d = db();
  const esc = (s: string) => s.replace(/[%_\\]/g, (m) => '\\' + m);

  let kids = await d.select().from(schema.students).where(ilike(schema.students.name, esc(child))).limit(5);
  if (kids.length === 0) {
    const pre = await d.select().from(schema.students).where(ilike(schema.students.name, esc(child) + '%')).limit(2);
    if (pre.length === 1) kids = pre;
  }
  if (kids.length === 0 && child.includes(' ')) {
    const fw = await d
      .select()
      .from(schema.students)
      .where(ilike(schema.students.name, esc(child.split(/\s+/)[0]) + '%'))
      .limit(2);
    if (fw.length === 1) kids = fw;
  }
  if (kids.length === 0) {
    await verifyPassword(null, code);
    throw UNIFORM();
  }

  // two students can share a name: the code decides whose parent this is
  const accounts = await d.select().from(schema.parentLogins).where(inArray(schema.parentLogins.studentId, kids.map((k) => k.id)));
  if (accounts.length === 0) {
    await verifyPassword(null, code);
    throw UNIFORM();
  }
  const now = new Date();
  const live = accounts.filter((a) => a.active && a.status !== 'locked' && a.codeHash && (!a.codeExpires || a.codeExpires > now));
  if (live.length === 0) throw new HttpError(401, 'No code is active. Ask Leon for a new one.', 'no_code');

  let match: (typeof live)[number] | undefined;
  for (const a of live) {
    if (await verifyPassword(a.codeHash, code)) {
      match = a;
      break;
    }
  }
  if (!match) {
    await d
      .update(schema.parentLogins)
      .set({
        failed: sql`${schema.parentLogins.failed} + 1`,
        status: sql`case when ${schema.parentLogins.failed} + 1 >= ${MAX_FAILED} then 'locked' else ${schema.parentLogins.status} end`,
      })
      .where(inArray(schema.parentLogins.id, live.map((a) => a.id)));
    throw UNIFORM();
  }

  const kid = kids.find((k) => k.id === match.studentId)!;
  await d
    .update(schema.parentLogins)
    .set({ failed: 0, status: 'active', lastActive: todayISO(), sessions: sql`${schema.parentLogins.sessions} + 1` })
    .where(eq(schema.parentLogins.id, match.id));
  await startSession({
    realm: 'parent',
    principalId: match.id,
    role: 'parent',
    name: match.label,
    childStudentId: kid.id,
    ip,
    userAgent: req.headers.get('user-agent') ?? undefined,
  });
  return { parent: { id: match.id, label: match.label }, child: { name: kid.name } };
});
