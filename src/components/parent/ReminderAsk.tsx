'use client';

import { useEffect, useRef } from 'react';

/* The one-time fee-reminder ask, in the app's bottom sheet (.scrim/.sheet).
   It is the only layer the parent app has, so it carries its own small
   share of the student app's overlay rules: one history entry while open
   (Android Back closes it, not the app), Escape and a tap outside do the
   same, the page behind is pinned, and focus moves in. Every way out goes
   through history.back(), so the entry it pushed is always the one used. */
export function ReminderAsk({ onYes, onClose }: { onYes: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const y = window.scrollY || 0;
    document.body.style.top = `${-y}px`;
    document.body.classList.add('sheet-open');
    history.pushState({ bbSheet: 1 }, '');
    const pop = () => closeRef.current();
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      history.back();
    };
    window.addEventListener('popstate', pop);
    window.addEventListener('keydown', key);
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true }), 40);
    return () => {
      clearTimeout(t);
      window.removeEventListener('popstate', pop);
      window.removeEventListener('keydown', key);
      document.body.classList.remove('sheet-open');
      document.body.style.top = '';
      window.scrollTo(0, y);
    };
  }, []);
  return (
    <div
      className="scrim on"
      onClick={(e) => {
        if (e.target === e.currentTarget) history.back();
      }}
    >
      <div className="sheet" ref={ref} role="dialog" aria-modal="true" aria-labelledby="askTitle">
        <div className="grabber" />
        <h3 id="askTitle">Fee reminder</h3>
        <p className="lede">Get a reminder when the class fee is due? You can change this any time in Settings.</p>
        <p className="meta" style={{ marginTop: 'var(--s2)' }}>
          At most two a month: when the fee is due, and a week later if it is still unpaid.
        </p>
        <button
          className="btn btn-primary"
          style={{ width: '100%', marginTop: 'var(--s4)' }}
          onClick={() => {
            /* the permission prompt has to start inside this tap (iPhone) */
            onYes();
            history.back();
          }}
        >
          Turn on
        </button>
        <button className="btn btn-secondary" style={{ width: '100%', marginTop: 'var(--s2)' }} onClick={() => history.back()}>
          Not now
        </button>
      </div>
    </div>
  );
}
