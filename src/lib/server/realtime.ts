import 'server-only';
import { EventEmitter } from 'node:events';
import Redis from 'ioredis';

/* Realtime nudges for the live class quiz (replaces the hand-rolled Supabase
   Realtime socket). Same contract as before: the channel only says
   "something changed — refresh"; the authoritative state is always read
   from the server. Phones also poll every 2 s, so a lost nudge costs nothing.

   Transport: Server-Sent Events from a route handler. Fan-out across app
   instances goes through Redis pub/sub when REDIS_URL is set; with one
   instance (or no Redis) an in-process EventEmitter is enough. */

const g = globalThis as unknown as { __bswlBus?: EventEmitter; __bswlSub?: Redis | null; __bswlPub?: Redis | null };

function bus() {
  if (!g.__bswlBus) {
    g.__bswlBus = new EventEmitter();
    g.__bswlBus.setMaxListeners(1000);
    const url = process.env.REDIS_URL;
    if (url) {
      try {
        g.__bswlPub = new Redis(url, { maxRetriesPerRequest: 2 });
        g.__bswlSub = new Redis(url, { maxRetriesPerRequest: null });
        g.__bswlPub.on('error', () => {});
        g.__bswlSub.on('error', () => {});
        g.__bswlSub.psubscribe('bswl:rt:*').catch(() => {});
        g.__bswlSub.on('pmessage', (_p, ch, msg) => g.__bswlBus!.emit(ch.slice('bswl:rt:'.length), msg));
      } catch {
        g.__bswlPub = g.__bswlSub = null;
      }
    }
  }
  return g.__bswlBus;
}

export async function publish(channel: string, event: string, data: unknown = {}) {
  const msg = JSON.stringify({ event, data, at: Date.now() });
  const pub = (bus(), g.__bswlPub);
  if (pub && pub.status === 'ready') {
    try {
      await pub.publish(`bswl:rt:${channel}`, msg);
      return;
    } catch {
      /* fall back to local */
    }
  }
  bus().emit(channel, msg);
}

/** An SSE response that forwards every message on `channel` until the client goes away. */
export function sseResponse(req: Request, channel: string) {
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (s: string) => {
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          cleanup();
        }
      };
      const onMsg = (msg: string) => send(`data: ${msg}\n\n`);
      bus().on(channel, onMsg);
      send(`retry: 2000\n: connected\n\n`);
      const hb = setInterval(() => send(`: ping\n\n`), 25_000);
      cleanup = () => {
        clearInterval(hb);
        bus().off(channel, onMsg);
        try {
          controller.close();
        } catch {}
      };
      req.signal.addEventListener('abort', cleanup);
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
