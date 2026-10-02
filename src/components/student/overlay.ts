'use client';

import { useEffect, useRef } from 'react';

/* BB APP FOUNDATIONS, the behaviour half, for React.

   Every full-screen layer (sheet, Updates, task flow, MCQ paper, quiz) calls
   useOverlay(open, close). While any is open:
     - the body is pinned in place (iOS forgets the scroll otherwise),
     - one history entry exists per open layer, so Android Back closes the TOP
       layer instead of leaving the app, and Escape does the same,
     - focus moves into the layer and comes back when it closes.
   History is reconciled once per tick (settle), so closing one layer and
   opening the next in the same tap nets to nothing instead of a stray Back
   that walks out of the app. */

type Entry = { close: () => void; el: () => HTMLElement | null; lastFocus: Element | null };
const stack: Entry[] = [];
let pushed = 0; // our entries currently in the history
let suppress = 0; // pops we caused ourselves
let lockedY = 0;
let installed = false;
let settleQueued = false;

function lock() {
  if (document.body.classList.contains('sheet-open')) return;
  lockedY = window.scrollY || 0;
  document.body.style.top = `${-lockedY}px`;
  document.body.classList.add('sheet-open');
}
function unlock() {
  if (!document.body.classList.contains('sheet-open')) return;
  document.body.classList.remove('sheet-open');
  document.body.style.top = '';
  window.scrollTo(0, lockedY);
}

function settle() {
  settleQueued = false;
  const diff = stack.length - pushed;
  try {
    if (diff > 0) {
      for (let i = 0; i < diff; i++) history.pushState({ bbSheet: 1 }, '');
      pushed += diff;
    } else if (diff < 0) {
      suppress++;
      pushed += diff;
      history.go(diff);
    }
  } catch {}
  if (stack.length) lock();
  else unlock();
}
function scheduleSettle() {
  if (settleQueued) return;
  settleQueued = true;
  setTimeout(settle, 0);
}

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  try {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  } catch {}
  window.addEventListener('popstate', () => {
    if (suppress > 0) {
      suppress--;
      return;
    }
    if (pushed > 0) pushed--;
    stack[stack.length - 1]?.close();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && stack.length) {
      e.preventDefault();
      history.back();
    }
  });
}

export function useOverlay(open: boolean, close: () => void, el?: () => HTMLElement | null) {
  const ref = useRef(close);
  const elRef = useRef(el);
  useEffect(() => {
    ref.current = close;
    elRef.current = el;
  });
  useEffect(() => {
    if (!open) return;
    install();
    const entry: Entry = { close: () => ref.current(), el: () => elRef.current?.() ?? null, lastFocus: document.activeElement };
    stack.push(entry);
    scheduleSettle();
    const t = setTimeout(() => {
      const f = entry.el()?.querySelector<HTMLElement>('button,[href],input,[tabindex]:not([tabindex="-1"])');
      try {
        f?.focus({ preventScroll: true });
      } catch {}
    }, 40);
    return () => {
      clearTimeout(t);
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      scheduleSettle();
      const lf = entry.lastFocus as HTMLElement | null;
      try {
        if (lf && document.contains(lf)) lf.focus({ preventScroll: true });
      } catch {}
    };
  }, [open]);
}
