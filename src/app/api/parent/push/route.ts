import { z } from 'zod';
import { handle, body } from '@/lib/server/api';
import { requireParent } from '@/lib/server/auth';
import { subscribe, unsubscribe, vapidPublicKey } from '@/lib/server/push';

/* The fee reminder on a parent's phone. The only thing a parent can ever
   write: their own device subscription. An endpoint moves to whoever
   registered it last (a shared phone), and re-sending it resets its failures. */

const Sub = z.object({
  endpoint: z.string().regex(/^https:\/\//).max(1000),
  p256dh: z.string().min(1).max(200),
  auth: z.string().min(1).max(100),
  ua: z.string().max(400).optional(),
});

export const GET = handle(async () => {
  await requireParent();
  return { key: vapidPublicKey() };
});

export const POST = handle(async (req) => {
  const p = await requireParent();
  const s = await body(req, Sub);
  await subscribe({ audience: 'parent', parentId: p.id, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth, ua: s.ua });
  return { ok: true };
});

export const DELETE = handle(async (req) => {
  const p = await requireParent();
  const { endpoint } = await body(req, z.object({ endpoint: z.string().max(1000) }));
  await unsubscribe(endpoint, { parentId: p.id });
  return { ok: true };
});
