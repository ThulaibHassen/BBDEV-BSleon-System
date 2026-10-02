'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';
import { api, del, post } from '@/lib/client/api';

/* ══ REMINDERS on the parent's phone ═══════════════════════════════════
   Two a month at most: one when the fee is due, one a week later if it is
   still unpaid. Nothing else is ever sent here.

   The worker is registered with scope '/parent', so the registration is
   fetched by scope rather than through serviceWorker.ready. ═══════════ */

export type PushState = 'on' | 'off' | 'denied' | 'install' | 'unsupported';

const LINE: Record<PushState, string> = {
  on: 'On for this phone. At most two a month, never more.',
  off: 'Off. Turn it on for a quiet reminder when the monthly fee is due.',
  denied: 'Blocked in your phone settings for this app.',
  install: 'On iPhone, add this page to your home screen first: Share, then Add to Home Screen.',
  unsupported: 'This browser cannot show reminders.',
};
/* the tile on the fee panel says it in three words; the card says it properly */
const SHORT: Record<PushState, string> = {
  on: 'On for this phone',
  off: 'Currently off',
  denied: 'Blocked in phone settings',
  install: 'Add to home screen first',
  unsupported: 'Not available here',
};

const iOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent);
const installed = () =>
  (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
  (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
const supported = () =>
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window &&
  (location.protocol === 'https:' || location.hostname === 'localhost');

function computeState(on: boolean): PushState {
  if (iOS() && !installed()) return 'install';
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return on ? 'on' : 'off';
}

function keyBytes(b64: string) {
  let b = b64.replace(/-/g, '+').replace(/_/g, '/');
  b += '==='.slice((b.length + 3) % 4);
  const raw = atob(b),
    a = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) a[i] = raw.charCodeAt(i);
  return a;
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration('/parent')) ?? navigator.serviceWorker.register('/parent/sw.js', { scope: '/parent' });
}

async function send(sub: PushSubscription) {
  const j = sub.toJSON();
  await post('/api/parent/push', {
    endpoint: j.endpoint,
    p256dh: j.keys?.p256dh,
    auth: j.keys?.auth,
    ua: navigator.userAgent.slice(0, 200),
  });
}

export function usePush(toast: (m: string) => void) {
  const [on, setOn] = useState(false);
  /* state() reads the browser, so it is only meaningful after mount */
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const state: PushState = mounted ? computeState(on) : 'off';

  /** After every hub load: a phone that already has a subscription is
      re-attached to this parent (and its failure count reset). */
  const relink = useCallback(async () => {
    if (!supported() || Notification.permission !== 'granted') return;
    try {
      const s = await (await registration()).pushManager.getSubscription();
      if (!s) return setOn(false);
      await send(s);
      setOn(true);
    } catch {
      /* stays as it was */
    }
  }, []);

  const turnOn = async () => {
    const st = computeState(on);
    if (st === 'install') return toast('Add this page to your home screen first');
    if (!supported()) return toast('This browser cannot show reminders');
    try {
      const p = await Notification.requestPermission();
      if (p !== 'granted') {
        setOn(false);
        return toast(p === 'denied' ? 'Blocked. Allow notifications for this app in your phone settings.' : 'Not turned on');
      }
      const reg = await registration();
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const { key } = await api<{ key: string }>('/api/parent/push');
        if (!key) throw new Error('Reminders are not set up yet');
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
      }
      await send(sub);
      setOn(true);
      toast('Reminder on');
    } catch (e) {
      setOn(false);
      toast((e as Error).message || 'Could not turn it on');
    }
  };

  const turnOff = async () => {
    try {
      const s = supported() ? await (await registration()).pushManager.getSubscription() : null;
      if (s) {
        const ep = s.endpoint;
        await s.unsubscribe();
        await del('/api/parent/push', { endpoint: ep });
      }
      setOn(false);
      toast('Reminder off');
    } catch {
      setOn(false);
    }
  };

  return {
    state,
    line: LINE[state],
    short: SHORT[state],
    relink,
    turnOn,
    toggle: () => (on ? turnOff() : turnOn()),
  };
}

/* THE ONE-TIME ASK. After a parent's first sign-in on this phone the hub
   offers the fee reminder once; whatever the answer, it never asks that
   parent again here. Settings keeps the switch. The login page leaves the
   parent's id in bswl_par_fresh; a session restored on reopen does not. */
const askedKey = (pid: number) => `bswl_par_push_asked_${pid}`;
export function freshSignIn(): number | null {
  try {
    const v = sessionStorage.getItem('bswl_par_fresh');
    sessionStorage.removeItem('bswl_par_fresh');
    return v && /^\d+$/.test(v) ? +v : null;
  } catch {
    return null;
  }
}
export function pushAsked(pid: number) {
  try {
    return localStorage.getItem(askedKey(pid)) === '1';
  } catch {
    return true; // no storage: asking on every sign-in would be the nag we are avoiding
  }
}
export function markPushAsked(pid: number) {
  try {
    localStorage.setItem(askedKey(pid), '1');
  } catch {}
}
/** Worth asking only when a tap could turn it on: not where the browser
    cannot, not where the phone already said yes or no, and not iPhone
    Safari, whose home-screen app gets its own first sign-in and ask. */
export const pushAskable = () => computeState(false) === 'off' && Notification.permission === 'default';
