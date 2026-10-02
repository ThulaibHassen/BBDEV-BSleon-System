import 'server-only';
import { and, asc, desc, eq, inArray, isNotNull, lte, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '@/lib/server/db';
import { HttpError } from '@/lib/server/auth';
import { invalidate, TAG } from '@/lib/server/cache';
import { logActivity } from '@/lib/server/audit';
import { pushTo } from '@/lib/server/push';
import { COHORT_SHORT, LOC_LABEL, PROG_LABEL, BSWL_PROGRAMS, MSG_TYPES } from '@/lib/shared/constants';
import { ymNow } from '@/lib/shared/dates';

/* ═══ Messages to the student app ═════════════════════════════════════
   An audience code is resolved to ACTIVE students at the moment of sending
   and fanned out into message_recipients (this replaces the old
   bswl_fan_out_message). Each recipient's phones get a push.

   Audience codes:
     all · c0 · c1 · loc:<Kings|JMC|Sasik|Residence> · mode:online|physical
     prog:<Theory|Revision|Combined> · student:<id>

   THE PRIVACY WALL: debt wording never reaches a student. A reminder about
   money owed is a parent conversation (Fees screen, parent app). */

export const DEBT_WORDS = /owe|owing|outstanding|overdue|arrears|balance|pay immediately|last warning/i;

const active = eq(schema.students.status, 'active');

function audienceWhere(aud: string): SQL | undefined {
  const s = schema.students;
  if (aud === 'all') return active;
  if (aud === 'c0' || aud === 'c1') return and(active, eq(s.cohort, Number(aud[1])));
  if (aud.startsWith('loc:')) return and(active, eq(s.loc, aud.slice(4)));
  if (aud === 'mode:online') return and(active, sql`${s.loc} not in ('Kings','JMC','Sasik','Residence')`);
  if (aud === 'mode:physical') return and(active, sql`${s.loc} in ('Kings','JMC','Sasik','Residence')`);
  if (aud.startsWith('prog:')) return and(active, eq(s.program, aud.slice(5)));
  if (aud.startsWith('student:')) return and(active, eq(s.id, Number(aud.slice(8)) || 0));
  return undefined;
}

export function validAudience(aud: string) {
  if (['all', 'c0', 'c1', 'mode:online', 'mode:physical'].includes(aud)) return true;
  if (aud.startsWith('loc:')) return aud.slice(4) in LOC_LABEL && aud !== 'loc:Online';
  if (aud.startsWith('prog:')) return (BSWL_PROGRAMS as readonly string[]).includes(aud.slice(5));
  return /^student:\d+$/.test(aud);
}

/** Plain-words label, as the original printed it. */
export async function audienceLabel(aud: string) {
  if (aud === 'all') return 'Whole academy';
  if (aud === 'c0' || aud === 'c1') return `${COHORT_SHORT[Number(aud[1])]} Batch`;
  if (aud === 'mode:online') return 'Everyone taught online';
  if (aud === 'mode:physical') return 'Everyone taught in a hall';
  if (aud.startsWith('prog:')) return PROG_LABEL[aud.slice(5)] ?? aud.slice(5);
  if (aud.startsWith('loc:')) return LOC_LABEL[aud.slice(4)] ?? aud.slice(4);
  if (aud.startsWith('student:')) {
    const [s] = await db().select({ name: schema.students.name }).from(schema.students).where(eq(schema.students.id, Number(aud.slice(8)))).limit(1);
    return s?.name ?? 'A student';
  }
  return aud;
}

export async function resolveAudience(aud: string): Promise<number[]> {
  const w = audienceWhere(aud);
  if (!w) throw new HttpError(400, 'Pick who it goes to.', 'invalid');
  const rows = await db().select({ id: schema.students.id }).from(schema.students).where(w);
  return rows.map((r) => r.id);
}

/** Every audience option's reach, so the preview line needs no round trip per change. */
export async function audienceCounts() {
  const rows = await db()
    .select({ cohort: schema.students.cohort, loc: schema.students.loc, program: schema.students.program, n: sql<number>`count(*)::int` })
    .from(schema.students)
    .where(active)
    .groupBy(schema.students.cohort, schema.students.loc, schema.students.program);
  const out: Record<string, number> = { all: 0, c0: 0, c1: 0, 'mode:online': 0, 'mode:physical': 0 };
  const hall = new Set(['Kings', 'JMC', 'Sasik', 'Residence']);
  for (const r of rows) {
    out.all += r.n;
    out[`c${r.cohort}`] = (out[`c${r.cohort}`] ?? 0) + r.n;
    out[`loc:${r.loc}`] = (out[`loc:${r.loc}`] ?? 0) + r.n;
    out[`prog:${r.program}`] = (out[`prog:${r.program}`] ?? 0) + r.n;
    out[hall.has(r.loc) ? 'mode:physical' : 'mode:online'] += r.n;
  }
  return out;
}

export type Compose = {
  type: keyof typeof MSG_TYPES;
  aud: string;
  title: string;
  body: string;
  courier?: { co?: string; no?: string } | null;
  schedFor?: Date | null;
};

function guard(m: Compose) {
  if (!m.title.trim() || !m.body.trim()) throw new HttpError(400, 'A message needs a title and a body.', 'invalid');
  if (DEBT_WORDS.test(`${m.title} ${m.body}`)) throw new HttpError(422, 'Blocked: debt wording never goes to a student app.', 'debt_wording');
  if (m.type === 'delivery' && !m.courier?.no?.trim()) {
    throw new HttpError(400, 'A courier dispatch needs the tracking number in its own field, not in the message.', 'invalid');
  }
  if (!validAudience(m.aud)) throw new HttpError(400, 'Pick who it goes to.', 'invalid');
}

/** Compose → either sent now (fan-out + push) or parked as scheduled. */
export async function createMessage(m: Compose, by: { id: number; name: string }) {
  guard(m);
  const ids = await resolveAudience(m.aud);
  if (!ids.length) throw new HttpError(400, 'That audience has no active students.', 'empty');
  const courier = m.type === 'delivery' && m.courier?.no?.trim() ? { co: m.courier.co?.trim() || 'Courier', no: m.courier.no.trim() } : null;
  const audLabel = await audienceLabel(m.aud);
  const scheduled = !!m.schedFor && m.schedFor.getTime() > Date.now();
  const [row] = await db()
    .insert(schema.messages)
    .values({
      type: m.type,
      title: m.title.trim(),
      body: m.body.trim(),
      aud: m.aud,
      audLabel,
      by: by.id,
      courier,
      status: scheduled ? 'scheduled' : 'sent',
      schedFor: scheduled ? m.schedFor : null,
      sent: scheduled ? 0 : ids.length,
      sentAt: scheduled ? null : new Date(),
    })
    .returning();
  if (scheduled) {
    await logActivity(by.id, 'Message scheduled', `${row.title} · ${audLabel} · by ${by.name}`);
    await invalidate(TAG.messages);
    return { id: row.id, sent: 0, scheduled: true, delivered: 0 };
  }
  const delivered = await deliver(row.id, ids, row.title, row.body);
  await logActivity(by.id, 'Message sent', `${row.title} · ${audLabel} · ${ids.length} students · by ${by.name}`);
  return { id: row.id, sent: ids.length, scheduled: false, delivered };
}

/** Fan out to recipients, then push to their phones. */
async function deliver(messageId: number, ids: number[], title: string, body: string) {
  const d = db();
  for (let i = 0; i < ids.length; i += 500) {
    await d
      .insert(schema.messageRecipients)
      .values(ids.slice(i, i + 500).map((studentId) => ({ messageId, studentId })))
      .onConflictDoNothing();
  }
  await invalidate(TAG.messages, ...ids.map((id) => TAG.student(id)));
  const subs = await d
    .select()
    .from(schema.pushSubs)
    .where(and(eq(schema.pushSubs.audience, 'student'), inArray(schema.pushSubs.studentId, ids)));
  return pushTo(subs, {
    title,
    body: body.length > 140 ? `${body.slice(0, 139)}…` : body,
    url: '/student/?go=inbox',
    tag: `bswl-msg-${messageId}`,
  });
}

/** Called by the cron tick: every scheduled message whose time has come goes out now. */
export async function sendDueScheduled(now = new Date()) {
  const d = db();
  const due = await d
    .select()
    .from(schema.messages)
    .where(and(eq(schema.messages.status, 'scheduled'), isNotNull(schema.messages.schedFor), lte(schema.messages.schedFor, now)))
    .orderBy(asc(schema.messages.schedFor));
  const out: { id: number; sent: number; delivered: number }[] = [];
  for (const m of due) {
    // claim it first so two overlapping ticks cannot both send it
    const claimed = await d
      .update(schema.messages)
      .set({ status: 'sent', sentAt: now })
      .where(and(eq(schema.messages.id, m.id), eq(schema.messages.status, 'scheduled')))
      .returning({ id: schema.messages.id });
    if (!claimed.length) continue;
    // the audience is resolved at send time: a student who left in between gets nothing
    const ids = validAudience(m.aud) ? await resolveAudience(m.aud) : [];
    await d.update(schema.messages).set({ sent: ids.length }).where(eq(schema.messages.id, m.id));
    const delivered = ids.length ? await deliver(m.id, ids, m.title, m.body) : 0;
    await logActivity(m.by, 'Scheduled message sent', `${m.title} · ${m.audLabel || m.aud} · ${ids.length} students`);
    out.push({ id: m.id, sent: ids.length, delivered });
  }
  if (due.length) await invalidate(TAG.messages);
  return out;
}

export async function cancelScheduled(id: number, by: { id: number; name: string }) {
  const gone = await db()
    .delete(schema.messages)
    .where(and(eq(schema.messages.id, id), eq(schema.messages.status, 'scheduled')))
    .returning();
  if (!gone.length) throw new HttpError(404, 'That scheduled message was not found. It may have gone out already.', 'not_found');
  await logActivity(by.id, 'Scheduled message cancelled', `${gone[0].title} · by ${by.name}`);
  await invalidate(TAG.messages);
}

/** The Messages page: KPIs, the table (with live opened / registered counts) and seminar sign-ups. */
export async function messagesPage() {
  const d = db();
  const [rows, counts, rsvps] = await Promise.all([
    d.select().from(schema.messages).orderBy(desc(sql`coalesce(${schema.messages.sentAt}, ${schema.messages.schedFor})`), desc(schema.messages.id)).limit(200),
    d
      .select({
        id: schema.messageRecipients.messageId,
        n: sql<number>`count(*)::int`,
        opened: sql<number>`count(${schema.messageRecipients.readAt})::int`,
        reg: sql<number>`count(${schema.messageRecipients.registeredAt})::int`,
      })
      .from(schema.messageRecipients)
      .groupBy(schema.messageRecipients.messageId),
    d
      .select({
        messageId: schema.messages.id,
        seminar: schema.messages.title,
        student: schema.students.name,
        cohort: schema.students.cohort,
      })
      .from(schema.messageRecipients)
      .innerJoin(schema.messages, eq(schema.messages.id, schema.messageRecipients.messageId))
      .innerJoin(schema.students, eq(schema.students.id, schema.messageRecipients.studentId))
      .where(and(eq(schema.messages.type, 'seminar'), isNotNull(schema.messageRecipients.registeredAt)))
      .orderBy(asc(schema.messages.id), asc(schema.students.name)),
  ]);
  const by = new Map(counts.map((c) => [c.id, c]));
  const list = rows.map((m) => {
    const c = by.get(m.id);
    // live figures once recipients exist; older rows keep the stored numbers
    return {
      id: m.id,
      type: m.type,
      title: m.title,
      body: m.body,
      aud: m.audLabel || m.aud,
      status: m.status,
      sentAt: m.sentAt,
      schedFor: m.schedFor,
      courier: m.courier,
      sent: c ? c.n : m.sent,
      opened: c ? c.opened : m.opened,
      registered: m.type === 'seminar' ? (c ? c.reg : m.registered) : null,
    };
  });
  const ym = ymNow();
  const sent = list.filter((m) => m.status === 'sent');
  const reach = sent.reduce((a, m) => a + (m.sent || 0), 0);
  const opened = sent.reduce((a, m) => a + (m.opened || 0), 0);
  const thisMonth = sent.filter((m) => m.sentAt && new Date(m.sentAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' }).slice(0, 7) === ym);
  return {
    kpis: {
      sentThisMonth: thisMonth.length,
      scheduled: list.filter((m) => m.status === 'scheduled').length,
      readRate: reach ? Math.round((opened / reach) * 100) : null,
    },
    messages: list,
    rsvps: rsvps.map((r) => ({ seminar: r.seminar, student: r.student, batch: `${COHORT_SHORT[r.cohort] ?? ''}` })),
    counts: await audienceCounts(),
  };
}
