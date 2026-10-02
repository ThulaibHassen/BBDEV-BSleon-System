'use client';

import { useEffect, useRef, useState } from 'react';
import { daysBetween, todayISO } from '@/lib/shared/dates';
import { useApp } from './ctx';
import { Ic } from './icons';
import { useOverlay } from './overlay';
import { isInstalled } from './push';
import { examDateOf, splashLine } from './model';
import { DEFAULT_APP_CONFIG } from '@/lib/shared/constants';

/* ══ THE SPLASH. After an explicit sign-in only, time-boxed, tap to skip.
   One line chosen by date (two students opening it the same morning see
   the same line), never a promise of a grade. ══ */
export function Splash({ onDone }: { onDone: () => void }) {
  const { m } = useApp();
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGone(true), 1200);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!gone) return;
    const t = setTimeout(onDone, 360);
    return () => clearTimeout(t);
  }, [gone, onDone]);
  const lines = m?.config.splash?.length ? m.config.splash : DEFAULT_APP_CONFIG.splash;
  const d = daysBetween(todayISO(), examDateOf(m));
  return (
    <div className={`splash${gone ? ' gone' : ''}`} role="status" aria-live="polite" onClick={() => setGone(true)}>
      <svg className="sp-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 18h6M10 21h4" />
        <path d="M12 3a6 6 0 0 0-4 10.5c.8.7 1 1.6 1 2.5h6c0-.9.2-1.8 1-2.5A6 6 0 0 0 12 3z" />
      </svg>
      <div className="sp-name">BS With Leon</div>
      <div className="sp-line">{splashLine(lines)}</div>
      <div className="sp-foot">{d > 0 ? `${d} days to the exam` : 'Exam time'}</div>
    </div>
  );
}

/* ══ THE WALKTHROUGH. It TEACHES and is forgotten by tomorrow; the install
   block CHANGES something, because a student who never puts the app on the
   home screen opens it once. Reopenable forever from Progress. ══ */

type BIP = Event & { prompt: () => void };
let installEvt: BIP | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvt = e as BIP;
  });
}

function InstallBlock() {
  const [, bump] = useState(0);
  if (isInstalled())
    return (
      <div className="wt-inst">
        <b>It is already on your home screen.</b> Nothing to do.
      </div>
    );
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (installEvt)
    return (
      <div className="wt-inst">
        <b>Put it on your home screen</b>
        <p className="wt-p">Its own icon, no address bar, and it still opens when you have no signal.</p>
        <button
          className="btn btn-primary"
          style={{ width: '100%', marginTop: 'var(--s3)' }}
          onClick={() => {
            installEvt?.prompt();
            installEvt = null;
            bump((n) => n + 1);
          }}
        >
          Add it to my phone
        </button>
      </div>
    );
  if (iOS)
    return (
      <div className="wt-inst">
        <b>Put it on your home screen</b>
        <p className="wt-p">Two taps and the address bar is gone for good.</p>
        <ol className="wt-ol">
          <li>
            <span className="wt-n">1</span>
            <Ic.share />
            <span>Tap Share, at the bottom of Safari</span>
          </li>
          <li>
            <span className="wt-n">2</span>
            <Ic.plusSq />
            <span>Choose &quot;Add to Home Screen&quot;</span>
          </li>
          <li>
            <span className="wt-n">3</span>
            <span style={{ width: 18 }} />
            <span>Open it from your home screen, not Safari</span>
          </li>
        </ol>
      </div>
    );
  return (
    <div className="wt-inst">
      <b>Put it on your home screen</b>
      <p className="wt-p">In your browser menu choose Install, or Add to Home screen. It gets its own icon and no address bar.</p>
    </div>
  );
}

export const wtSeen = () => {
  try {
    return localStorage.getItem('bswl_wt') === '1';
  } catch {
    return false;
  }
};

export function Walkthrough() {
  const c = useApp();
  const [i, setI] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => {
    try {
      localStorage.setItem('bswl_wt', '1');
    } catch {}
    c.setWtOpen(false);
    setI(0);
  };
  useOverlay(c.wtOpen, close, () => ref.current);
  if (!c.wtOpen) return <div className="wt-wrap" />;
  const first = (c.m?.me.name || 'there').split(' ')[0];
  const cards: { h: string; p: React.ReactNode[] }[] = [
    {
      h: 'Hello ' + first,
      p: [
        <>
          This app has one job: <b>tell you what to do next</b>, so you are never sitting there wondering where to start.
        </>,
        '4 screens, about a minute. You can skip this, it stays in Progress.',
      ],
    },
    {
      h: 'Today is the whole app',
      p: [
        'Open it and the next thing is already there: a class you missed, a tute that is due, a topic that needs another look.',
        <>
          The clock at the top counts to your exam. <b>Nothing on this screen is a guess</b>, it all comes from what Leon has marked.
        </>,
      ],
    },
    {
      h: 'Miss a class, watch it back',
      p: [
        'If you are marked absent, the recording appears on Today by itself. Nobody has to send it to you.',
        <>
          <b>They do not stay open forever.</b> When you see days left, that is real, so watch it before it closes.
        </>,
      ],
    },
    {
      h: 'Time yourself on a paper',
      p: [
        <>
          In <b>Learn</b>, start the timer before you begin a past paper. The app records how long you took, so you are not guessing afterwards.
        </>,
        'When you finish, put in what you got. That is yours, and it is how the app spots the questions that keep costing you marks.',
      ],
    },
    {
      h: 'Make it yours',
      p: [
        <>
          <b>Progress</b> has colours and a light or dark switch. Pick whatever you will actually look at every morning.
        </>,
        'And put it on your home screen, so it opens like a proper app with no address bar. Here is how.',
      ],
    },
  ];
  const card = cards[i];
  const last = i === cards.length - 1;
  return (
    <div className="wt-wrap on" ref={ref} role="dialog" aria-modal="true" aria-label="How this app works">
      <div className="wt-card">
        <button className="wt-skip" onClick={() => history.back()}>
          Skip
        </button>
        <div className="wt-body">
          <div className="wt-step">
            {i + 1} of {cards.length}
          </div>
          <h2 className="wt-h">{card.h}</h2>
          {card.p.map((t, k) => (
            <p className="wt-p" key={k}>
              {t}
            </p>
          ))}
          {last && <InstallBlock />}
        </div>
        <div className="wt-foot">
          <button className="btn btn-secondary" style={{ visibility: i ? 'visible' : 'hidden' }} onClick={() => setI(Math.max(0, i - 1))}>
            Back
          </button>
          <div className="wt-dots" aria-hidden="true">
            {cards.map((_, k) => (
              <span key={k} className={`wt-dot${k === i ? ' on' : ''}`} />
            ))}
          </div>
          <button className="btn btn-primary" onClick={() => (last ? history.back() : setI(i + 1))}>
            {last ? 'Start using it' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
