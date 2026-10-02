'use client';

import { useEffect, useSyncExternalStore } from 'react';

/* Light and dark. localStorage 'bswl_par_mode': '' (Auto, follows the phone),
   'light' or 'dark'. The layout applies it before first paint; this keeps it
   moving afterwards. Everything that depends on the mode (the login mark,
   the dock pill, the Appearance buttons) listens for EVENT. */

export type PMode = '' | 'light' | 'dark';
const KEY = 'bswl_par_mode';
export const MODE_EVENT = 'bswl-par-mode';

export function pMode(): PMode {
  try {
    const m = localStorage.getItem(KEY) || '';
    return m === 'light' || m === 'dark' ? m : '';
  } catch {
    return '';
  }
}

export function isLight() {
  const m = document.documentElement.getAttribute('data-mode') || '';
  return m === 'light' || (!m && !!window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
}

export function setPMode(m: PMode) {
  try {
    if (m) localStorage.setItem(KEY, m);
    else localStorage.removeItem(KEY);
  } catch {}
  if (m) document.documentElement.setAttribute('data-mode', m);
  else document.documentElement.removeAttribute('data-mode');
  /* #f6f6f7 is --bg in light mode, so the strip above the page matches it */
  const t = document.querySelector('meta[name="theme-color"]');
  if (t) t.setAttribute('content', isLight() ? '#f6f6f7' : '#0d0d0d');
  window.dispatchEvent(new CustomEvent(MODE_EVENT, { detail: m }));
}

function subscribe(cb: () => void) {
  window.addEventListener(MODE_EVENT, cb);
  return () => window.removeEventListener(MODE_EVENT, cb);
}

/** The stored mode, kept in step with setPMode. Auto keeps following the
    phone while the app is open, not only at boot, or an evening switch
    leaves the page in yesterday's mode. */
export function usePMode(): PMode {
  const m = useSyncExternalStore(subscribe, pMode, () => '' as PMode);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: light)');
    const onScheme = () => {
      if (!pMode()) setPMode('');
    };
    mq?.addEventListener?.('change', onScheme);
    return () => mq?.removeEventListener?.('change', onScheme);
  }, []);
  return m;
}
