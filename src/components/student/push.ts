'use client';

import { api, del, post } from '@/lib/client/api';

/* PHONE REMINDERS (web push). This module only switches THIS phone on or
   off; the server decides what to send and when (Leon's hours and daily
   limit). iPhone needs the app on the home screen first (iOS 16.4+).

   States: on | off | denied | install (iPhone, not on the home screen) |
   unsupported. `on` is learned, not assumed: relink() after sign-in checks
   that this phone really holds a subscription and re-saves it under the
   student who is signed in now. */

export type PushState = 'on' | 'off' | 'denied' | 'install' | 'unsupported';

let on = false;
let key: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());
export const onPushChange = (f: () => void) => {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
};

export function isInstalled() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}
export const isIOS = () =>
  typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const supported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window &&
  (location.protocol === 'https:' || location.hostname === 'localhost');

export function pushState(): PushState {
  if (typeof window === 'undefined') return 'unsupported';
  if (isIOS() && !isInstalled()) return 'install';
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return on ? 'on' : 'off';
}

export const PUSH_LINE: Record<PushState, string> = {
  on: 'On for this phone. Leon decides how many a day, never more.',
  off: 'Off. Turn them on and you will not miss a closing recording or a waiting tute.',
  denied: 'Blocked in your phone settings for this app.',
  install: 'On iPhone, add the app to your home screen first.',
  unsupported: 'This browser cannot show reminders. Try Chrome, or add the app to your home screen.',
};

/* THE ONE-TIME ASK. After a student's first sign-in on this phone the app
   offers reminders once; whatever they answer (or if they swipe it away) it
   never asks that student again here. Progress keeps the way back in. */
const askedKey = (sid: number) => `bswl_push_asked_${sid}`;
export function pushAsked(sid: number) {
  try {
    return localStorage.getItem(askedKey(sid)) === '1';
  } catch {
    return true; // no storage: asking on every sign-in would be the nag we are avoiding
  }
}
export function markPushAsked(sid: number) {
  try {
    localStorage.setItem(askedKey(sid), '1');
  } catch {}
}
/** Worth asking only when a tap could turn them on: not on a browser that
    cannot, not one that already said yes (granted) or no (denied), and not
    iPhone Safari, where the home-screen app keeps its own storage and so
    gets its own first sign-in, and its own ask, once installed. */
export function pushAskable() {
  return pushState() === 'off' && Notification.permission === 'default';
}

async function vapid() {
  if (key) return key;
  const r = await api<{ key: string }>('/api/push/vapid');
  key = r.key;
  if (!key) throw new Error('Reminders are not set up on the server yet');
  return key;
}
function b64urlToBytes(b64: string) {
  let b = b64.replace(/-/g, '+').replace(/_/g, '/');
  b += '==='.slice((b.length + 3) % 4);
  const raw = atob(b);
  const a = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) a[i] = raw.charCodeAt(i);
  return a;
}
async function currentSub() {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}
async function save(sub: PushSubscription) {
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await post('/api/student/push', { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, ua: navigator.userAgent.slice(0, 200) });
}

/** MUST run from a tap: iPhone refuses a permission prompt that is not. */
export async function pushEnable(): Promise<string> {
  if (pushState() === 'install') return 'install';
  if (!supported()) return 'This browser cannot show reminders';
  const p = await Notification.requestPermission();
  if (p !== 'granted') {
    on = false;
    emit();
    return p === 'denied' ? 'Blocked. Allow notifications for this app in your phone settings.' : 'Not turned on';
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const k = await vapid();
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(k) }));
    await save(sub);
    on = true;
    emit();
    return 'Reminders on';
  } catch (e) {
    emit();
    return 'Could not turn on reminders: ' + ((e as Error)?.message || String(e));
  }
}

export async function pushDisable() {
  try {
    const sub = await currentSub();
    if (sub) {
      const ep = sub.endpoint;
      await sub.unsubscribe();
      await del('/api/student/push', { endpoint: ep });
    }
  } catch {}
  on = false;
  emit();
}

/** After sign-in: an already-allowed phone is attached to whoever is signed in now. */
export async function pushRelink() {
  try {
    if (!supported() || Notification.permission !== 'granted') return emit();
    const sub = await currentSub();
    if (!sub) {
      on = false;
      return emit();
    }
    await save(sub);
    on = true;
  } catch {}
  emit();
}

/** Sign-out: detach this phone while the session still works. */
export async function pushForget() {
  on = false;
  try {
    const sub = await currentSub();
    if (!sub) return;
    const ep = sub.endpoint;
    await fetch('/api/student/push', {
      method: 'DELETE',
      keepalive: true,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: ep }),
    }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  } catch {}
}
