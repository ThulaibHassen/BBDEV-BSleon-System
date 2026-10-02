import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { handle, body } from '@/lib/server/api';
import { requireStudent } from '@/lib/server/auth';
import { db, schema } from '@/lib/server/db';
import { BSWL_SYLLABUS } from '@/lib/shared/constants';
import { todayISO } from '@/lib/shared/dates';

/* A student's own read of a topic. Only kind 'conf' is ever written here:
   evidence ('ev') is what Leon has seen, and a phone cannot promote itself. */

const TOPICS = new Set(BSWL_SYLLABUS.flatMap((u) => u.topics.map((t) => t[0])));
const Body = z.object({
  topic: z.string().refine((t) => TOPICS.has(t), 'Unknown topic'),
  state: z.enum(['got', 'shaky', 'lost', 'none']),
});

export const PUT = handle(async (req) => {
  const p = await requireStudent();
  const { topic, state } = await body(req, Body);
  const T = schema.topicChecks;
  if (state === 'none') {
    await db()
      .delete(T)
      .where(and(eq(T.studentId, p.id), eq(T.kind, 'conf'), eq(T.topic, topic)));
  } else {
    await db()
      .insert(T)
      .values({ studentId: p.id, kind: 'conf', topic, state, checkedAt: todayISO() })
      .onConflictDoUpdate({ target: [T.studentId, T.kind, T.topic], set: { state, checkedAt: todayISO() } });
  }
  return { ok: true };
});
