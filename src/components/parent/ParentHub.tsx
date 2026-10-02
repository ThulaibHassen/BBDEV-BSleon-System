'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { fetcher, post } from '@/lib/client/api';
import { MODE_EVENT, usePMode, type PMode } from './mode';
import { freshSignIn, markPushAsked, pushAskable, pushAsked, usePush } from './push';
import { ReminderAsk } from './ReminderAsk';
import { Bulb, TabIcon } from './icons';
import { Attendance, ClassTab, Fees, Settings, type HubData } from './screens';

/* The parent hub: a header that carries the child, four tabs of a parent's
   questions, the student app's floating dock. One screen visible at a time. */

type Sc = 'fees' | 'att' | 'class' | 'settings';
const SCREENS: Sc[] = ['fees', 'att', 'class', 'settings'];
const TITLES: Record<Sc, string> = { fees: 'Fees', att: 'Attendance', class: 'In class', settings: 'Settings' };
const LABELS: Record<Sc, string> = { fees: 'Fees', att: 'Attendance', class: 'Class', settings: 'Settings' };

export function ParentHub() {
  const mode = usePMode();
  const [sc, setSc] = useState<Sc>('fees');
  const [enter, setEnter] = useState<Sc | null>('fees');
  const [toastMsg, setToastMsg] = useState('');
  const [toastOn, setToastOn] = useState(false);
  const [live, setLive] = useState('');
  const toTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    setToastOn(true);
    clearTimeout(toTimer.current);
    toTimer.current = setTimeout(() => setToastOn(false), 3200);
  }, []);

  const push = usePush(toast);
  const { data, error } = useSWR<HubData>('/api/parent/view', fetcher);

  /* after the first load: re-attach this phone's reminder, announce, and
     after an explicit sign-in offer the reminder once (never on a reopen) */
  const linked = useRef(false);
  const { relink } = push;
  const [ask, setAsk] = useState(false);
  useEffect(() => {
    if (!data || linked.current) return;
    linked.current = true;
    relink();
    setLive('Signed in');
    const pid = freshSignIn();
    if (pid == null || pushAsked(pid)) return;
    markPushAsked(pid);
    if (!pushAskable()) return;
    /* no cleanup on purpose: a revalidation re-running this effect must
       not cancel the one ask, which is already marked as made */
    setTimeout(() => setAsk(true), 700);
  }, [data, relink]);

  /* ── nav: the white pill is MEASURED, not guessed, and flex-grow is not
     transitioned, so the width read back is the settled one ── */
  const nav = useRef<HTMLElement>(null);
  const pill = useRef<HTMLElement>(null);
  const tabPill = useCallback(() => {
    const on = nav.current?.querySelector<HTMLElement>('button[aria-selected="true"]');
    if (!pill.current) return;
    if (!on) {
      pill.current.style.width = '0';
      return;
    }
    pill.current.style.width = `${on.offsetWidth}px`;
    pill.current.style.transform = `translateX(${on.offsetLeft}px)`;
  }, []);
  useLayoutEffect(tabPill, [sc, tabPill]);
  useEffect(() => {
    const onMode = (e: Event) => {
      const m = (e as CustomEvent).detail as PMode;
      tabPill();
      setLive(m === 'light' ? 'Light' : m === 'dark' ? 'Dark' : 'Following your phone');
    };
    window.addEventListener('resize', tabPill);
    window.addEventListener(MODE_EVENT, onMode);
    return () => {
      window.removeEventListener('resize', tabPill);
      window.removeEventListener(MODE_EVENT, onMode);
    };
  }, [tabPill]);

  const show = (k: Sc) => {
    setSc(k);
    setEnter(k);
    window.scrollTo(0, 0);
  };
  useEffect(() => {
    if (!enter) return;
    const t = setTimeout(() => setEnter(null), 460);
    return () => clearTimeout(t);
  }, [enter]);

  const signOut = async () => {
    try {
      await post('/api/auth/parent/logout');
    } catch {
      /* the cookies are cleared either way */
    }
    window.location.replace('/parent/login');
  };

  const sub = data ? (data.parent.label ? `${data.parent.label} · ` : '') + data.child.name : '';

  const body = (k: Sc) => {
    if (!data) {
      if (error && k === 'fees') {
        return (
          <article className="card">
            <h2>Could not load</h2>
            <p className="lede" style={{ marginTop: 'var(--s2)' }}>
              {(error as Error).message}
            </p>
          </article>
        );
      }
      return null;
    }
    if (k === 'fees') return <Fees d={data} push={push} go={show} />;
    if (k === 'att') return <Attendance d={data} />;
    if (k === 'class') return <ClassTab d={data} />;
    return <Settings d={data} mode={mode} push={push} signOut={signOut} />;
  };

  return (
    <>
      <header className="hdr">
        <Bulb />
        <div className="grow" style={{ flex: 1 }}>
          <h1>{TITLES[sc]}</h1>
          <div className="sub">{sub}</div>
        </div>
        <button className="out" onClick={signOut}>
          Sign out
        </button>
      </header>

      <main className="shell">
        {SCREENS.map((k) => (
          <section
            key={k}
            className={`screen${k === sc ? ' on' : ''}${k === enter ? ' enter' : ''}`}
            id={`sc-${k}`}
            role="tabpanel"
            aria-labelledby={`tab-${k}`}
          >
            <div className="stack">{body(k)}</div>
          </section>
        ))}
      </main>

      <nav className="tabs" ref={nav} role="tablist" aria-label="Main">
        <i className="pill" ref={pill} aria-hidden="true" />
        {SCREENS.map((k) => (
          <button key={k} role="tab" id={`tab-${k}`} aria-selected={k === sc} aria-controls={`sc-${k}`} onClick={() => show(k)}>
            <TabIcon k={k} />
            <span className="lbl">{LABELS[k]}</span>
          </button>
        ))}
      </nav>

      {ask && <ReminderAsk onYes={push.turnOn} onClose={() => setAsk(false)} />}

      <div className={`toast${toastOn ? ' on' : ''}`} role="status">
        <span>{toastMsg}</span>
      </div>
      <div className="sr" role="status" aria-live="polite">
        {live}
      </div>
    </>
  );
}
