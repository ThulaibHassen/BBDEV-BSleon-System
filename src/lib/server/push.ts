import 'server-only';
import webpush from 'web-push';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from './db';
import { env } from './env';
import { HttpError } from './auth';

/* Web push (VAPID). One table of devices for students and parents
   (push_subs.audience). Dead endpoints (404/410) are deleted; other failures
   bump `fails`. Payload shape the service workers expect:
   { title, body, url, tag } */

export type PushPayload = { title: string; body: string; url: string; tag: string };
type Sub = typeof schema.pushSubs.$inferSelect;

let configured = false;
export function pushReady() {
  const e = env();
  if (!e.VAPID_PUBLIC_KEY || !e.VAPID_PRIVATE_KEY) return false;
  if (!configured) {
    webpush.setVapidDetails(e.VAPID_SUBJECT, e.VAPID_PUBLIC_KEY, e.VAPID_PRIVATE_KEY);
    configured = true;
  }
  return true;
}

export function vapidPublicKey() {
  return env().VAPID_PUBLIC_KEY ?? '';
}

export async function pushTo(subs: Sub[], payload: PushPayload): Promise<number> {
  if (!pushReady() || subs.length === 0) return 0;
  const d = db();
  let delivered = 0;
  const dead: number[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), {
          TTL: 12 * 3600,
          urgency: 'normal',
        });
        delivered++;
        await d.update(schema.pushSubs).set({ lastOk: new Date(), fails: 0 }).where(eq(schema.pushSubs.id, s.id));
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(s.id);
        else await d.update(schema.pushSubs).set({ fails: sql`${schema.pushSubs.fails} + 1` }).where(eq(schema.pushSubs.id, s.id));
      }
    }),
  );
  if (dead.length) await d.delete(schema.pushSubs).where(inArray(schema.pushSubs.id, dead));
  return delivered;
}

/* Only the browser vendors' push services. Anything else would let a signed-in
   phone make this server POST to an arbitrary address. */
const PUSH_HOSTS = [/\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /\.push\.apple\.com$/];
export function pushHostAllowed(endpoint: string) {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && PUSH_HOSTS.some((h) => h.test('.' + u.hostname));
  } catch {
    return false;
  }
}

/** Register a device. An endpoint moves to whoever registers it last (shared phone). */
export async function subscribe(i: { audience: 'student' | 'parent'; studentId?: number; parentId?: number; endpoint: string; p256dh: string; auth: string; ua?: string }) {
  if (!pushHostAllowed(i.endpoint) || i.endpoint.length > 1000) throw new HttpError(400, 'That is not a browser push address.', 'bad_endpoint');
  const row = {
    audience: i.audience,
    studentId: i.audience === 'student' ? i.studentId! : null,
    parentId: i.audience === 'parent' ? i.parentId! : null,
    endpoint: i.endpoint,
    p256dh: i.p256dh,
    auth: i.auth,
    ua: i.ua?.slice(0, 200) ?? null,
    fails: 0,
  };
  await db()
    .insert(schema.pushSubs)
    .values(row)
    .onConflictDoUpdate({ target: schema.pushSubs.endpoint, set: { ...row } });
}

export async function unsubscribe(endpoint: string, owner: { studentId?: number; parentId?: number }) {
  const d = db();
  const [s] = await d.select().from(schema.pushSubs).where(eq(schema.pushSubs.endpoint, endpoint)).limit(1);
  if (!s) return;
  if ((owner.studentId && s.studentId === owner.studentId) || (owner.parentId && s.parentId === owner.parentId)) {
    await d.delete(schema.pushSubs).where(eq(schema.pushSubs.id, s.id));
  }
}
