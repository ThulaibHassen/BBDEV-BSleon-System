import { handle } from '@/lib/server/api';
import { vapidPublicKey } from '@/lib/server/push';

/* The public half of the VAPID pair. Public by design: a phone needs it to
   subscribe before the server knows who it belongs to. */
export const GET = handle(async () => ({ key: vapidPublicKey() }));
