'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '@/lib/client/api';
import { AppProvider, useApp, type LearnSeg, type Screen } from './ctx';
import { Ic } from './icons';
import { SheetHost, ToastHost } from './ui';
import { Today } from './Today';
import { Learn } from './Learn';
import { Practice } from './Practice';
import { Progress, applyMode } from './Progress';
import { Inbox } from './Inbox';
import { FlowHost } from './Flow';
import { McqRun } from './McqRun';
import { QuizGame, readQz } from './Quiz';
import { Splash, Walkthrough, wtSeen } from './Onboarding';
import { markPushAsked, pushAskable, pushAsked, pushRelink } from './push';
import { PushSheet } from './PushSheet';
import { dowName, fmtD } from './model';
import { todayISO } from '@/lib/shared/dates';

/* ══ THE STUDENT APP. One screen, four places on a floating dock, and every
   layer (sheet, Updates, task flow, paper, quiz) on top of it. ══ */

const TABS: { k: Screen; label: string; icon: () => React.ReactElement }[] = [
  { k: 'next', label: 'Today', icon: Ic.tToday },
  { k: 'learn', label: 'Learn', icon: Ic.tLearn },
  { k: 'practice', label: 'Practice', icon: Ic.tPractice },
  { k: 'progress', label: 'Progress', icon: Ic.tProgress },
];

/* THE PILL IS MEASURED, NOT GUESSED: the active tab grows, the pill slides
   over it, re-measured on resize and once the fonts have settled. */
function Dock() {
  const c = useApp();
  const nav = useRef<HTMLElement>(null);
  const pill = useRef<HTMLElement>(null);
  const measure = useCallback(() => {
    const on = nav.current?.querySelector<HTMLElement>('button[aria-selected="true"]');
    if (!pill.current) return;
    if (!on) {
      pill.current.style.width = '0';
      return;
    }
    pill.current.style.width = on.offsetWidth + 'px';
    pill.current.style.transform = `translateX(${on.offsetLeft}px)`;
  }, []);
  useLayoutEffect(measure, [c.screen, measure]);
  useEffect(() => {
    window.addEventListener('resize', measure);
    document.fonts?.ready.then(measure);
    const t = setTimeout(measure, 320);
    return () => {
      window.removeEventListener('resize', measure);
      clearTimeout(t);
    };
  }, [measure]);
  return (
    <nav className="tabs" role="tablist" aria-label="Main" ref={nav}>
      <i className="pill" ref={pill} aria-hidden="true" />
      {TABS.map((t) => (
        <button
          key={t.k}
          role="tab"
          id={`tab-${t.k}`}
          aria-selected={c.screen === t.k}
          aria-controls={`sc-${t.k}`}
          onClick={() => {
            if (t.k === 'learn') c.setLearnSeg('syllabus');
            c.show(t.k);
          }}
        >
          <t.icon />
          <span className="lbl">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

function Header() {
  const c = useApp();
  const n = c.m ? c.m.inbox.filter((x) => !x.read).length : 0;
  const titles: Record<Screen, string> = { next: dowName(todayISO()), learn: 'Learn', practice: 'Practice', progress: 'Progress' };
  return (
    <header className="hdr">
      <Ic.bulb className="mark" />
      <div className="grow" style={{ flex: 1 }}>
        <h1>{titles[c.screen]}</h1>
        <div className="sub">{c.screen === 'next' && c.m ? `${fmtD(todayISO())} · ${c.m.me.batch} batch` : ''}</div>
      </div>
      <button className="bell" aria-label="Updates" onClick={() => c.setInboxOpen(true)}>
        <Ic.bell />
        {/* rendered only when there is something: the .bb display rule beats [hidden] */}
        {n > 0 && <span className="bb">{n > 9 ? '9+' : n}</span>}
      </button>
    </header>
  );
}

function Screens() {
  const c = useApp();
  /* the screen just switched to plays its rise once */
  const [enter, setEnter] = useState<Screen | null>(c.screen);
  const [shown, setShown] = useState(c.screen);
  if (shown !== c.screen) {
    setShown(c.screen);
    setEnter(c.screen);
  }
  useEffect(() => {
    if (!enter) return;
    const t = setTimeout(() => setEnter(null), 460);
    return () => clearTimeout(t);
  }, [enter, shown]);
  if (!c.m) {
    return (
      <main className="shell">
        {c.loadError ? (
          <div className="card" style={{ marginTop: 'var(--s4)' }}>
            <h2>Could not load your work</h2>
            <p className="lede" style={{ marginTop: 'var(--s2)' }}>
              {c.loadError}
            </p>
            <button className="btn btn-primary" style={{ marginTop: 'var(--s4)' }} onClick={c.reload}>
              Try again
            </button>
          </div>
        ) : (
          <div className="stack" aria-busy="true">
            <div className="skel" style={{ height: 150, borderRadius: 'var(--r-xl)' }} />
            <div className="skel" style={{ height: 64 }} />
            <div className="skel" style={{ height: 190, borderRadius: 'var(--r-xl)' }} />
            <div className="skel" style={{ height: 120 }} />
          </div>
        )}
      </main>
    );
  }
  const sc = (k: Screen, node: React.ReactNode) => (
    <section className={`screen${c.screen === k ? ' on' : ''}${enter === k ? ' enter' : ''}`} id={`sc-${k}`} role="tabpanel" aria-labelledby={`tab-${k}`}>
      {c.screen === k && node}
    </section>
  );
  return (
    <main className="shell" id="main">
      {sc('next', <Today />)}
      {sc('learn', <Learn />)}
      {sc('practice', <Practice />)}
      {sc('progress', <Progress />)}
    </main>
  );
}

function Offline() {
  const [off, setOff] = useState(false);
  useEffect(() => {
    const f = () => setOff(!navigator.onLine);
    f();
    window.addEventListener('online', f);
    window.addEventListener('offline', f);
    return () => {
      window.removeEventListener('online', f);
      window.removeEventListener('offline', f);
    };
  }, []);
  return (
    <div className="offline-bar" role="status" style={{ display: off ? 'block' : 'none' }}>
      Offline. Your work is saved on this device.
    </div>
  );
}

/* Boot-time wiring: deep links from a tapped notification (?go=), the old
   hash routes, the splash, walkthrough and the one reminders ask after an
   explicit sign-in, the live quiz to resume, and re-attaching this phone's
   reminders. */
function Boot() {
  const c = useApp();
  const ready = !!c.m;
  const sid = c.m?.me.id;
  const [splash, setSplash] = useState(false);
  const [wtSoon, setWtSoon] = useState(false);
  const [askPush, setAskPush] = useState(false);
  const did = useRef(false);

  const goFromLink = useCallback(() => {
    let g = '';
    try {
      g = new URLSearchParams(location.search).get('go') || '';
    } catch {}
    if (!g) return;
    if (['recordings', 'tutes', 'papers', 'syllabus'].includes(g)) c.show('learn', g as LearnSeg);
    else if (g === 'progress') c.show('progress');
    else if (g === 'inbox') {
      /* a message's push: open Updates over Today */
      c.show('next');
      c.setInboxOpen(true);
    } else c.show('next');
    try {
      history.replaceState(history.state, '', location.pathname + location.hash);
    } catch {}
  }, [c]);

  useEffect(() => {
    if (!ready || did.current) return;
    did.current = true;
    const h = location.hash;
    if (h === '#learn') c.show('learn', 'syllabus');
    else if (h === '#papers') c.show('learn', 'papers');
    else if (h === '#mcq') {
      c.setPracView('drill');
      c.show('practice');
    } else if (h === '#essays') {
      c.setPracView('essays');
      c.show('practice');
    } else if (h === '#practice') c.show('practice');
    else if (h === '#progress') c.show('progress');
    goFromLink();
    let fresh = false;
    try {
      fresh = sessionStorage.getItem('bswl_fresh') === '1';
      sessionStorage.removeItem('bswl_fresh');
    } catch {}
    if (fresh) {
      /* bswl_fresh is consumed as it is read, so this cannot move into render
         (StrictMode renders twice); the boot runs once, behind did.current */
      setSplash(true);
      c.say('Signed in as ' + c.m!.me.name);
      if (!wtSeen()) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setWtSoon(true);
        setTimeout(() => {
          c.setWtOpen(true);
          setWtSoon(false);
        }, 900);
      }
      /* reminders are offered once per student on this phone, and only
         where a tap could turn them on; a session restored on reopen never
         lands here (no bswl_fresh), so it never asks */
      const id = c.m!.me.id;
      if (!pushAsked(id)) {
        if (pushAskable()) setAskPush(true);
        else markPushAsked(id);
      }
    } else c.say('Welcome back, ' + c.m!.me.name);
    pushRelink();
    const q = readQz();
    if (q?.id)
      api<{ state: string }>(`/api/student/quiz/${q.id}/state`)
        .then((s) => {
          if (s.state !== 'ended') c.setQuiz({ id: q.id, pin: q.pin, title: q.title });
          else localStorage.removeItem('bswl_qz');
        })
        .catch(() => {
          try {
            localStorage.removeItem('bswl_qz');
          } catch {}
        });
  }, [ready, c, goFromLink]);

  /* THE ASK WAITS ITS TURN: after the splash and the walkthrough, and never
     on top of another layer. It counts as asked the moment it shows, so
     "Not now", Back or a tap outside all end it for good. */
  const busy = splash || wtSoon || c.wtOpen || !!c.sheet || !!c.flow || c.inboxOpen || c.mcqRun != null || !!c.quiz;
  const { openSheet } = c;
  useEffect(() => {
    if (!askPush || busy || sid == null) return;
    const t = setTimeout(() => {
      setAskPush(false);
      markPushAsked(sid);
      openSheet(<PushSheet first />);
    }, 500);
    return () => clearTimeout(t);
  }, [askPush, busy, sid, openSheet]);

  /* the worker tells an already-open app where to go */
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const f = (e: MessageEvent) => {
      const d = e.data || {};
      if (d.type !== 'bswl-go') return;
      try {
        history.replaceState(history.state, '', location.pathname + '?go=' + encodeURIComponent(d.go || 'next'));
      } catch {}
      goFromLink();
    };
    navigator.serviceWorker.addEventListener('message', f);
    return () => navigator.serviceWorker.removeEventListener('message', f);
  }, [goFromLink]);

  /* Auto keeps following the phone while the app is open */
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const f = () => {
      if (!document.documentElement.getAttribute('data-mode')) applyMode('');
    };
    mq.addEventListener?.('change', f);
    return () => mq.removeEventListener?.('change', f);
  }, []);

  return splash ? <Splash onDone={() => setSplash(false)} /> : null;
}

export default function StudentApp() {
  return (
    <AppProvider>
      <div className="statusfill" aria-hidden="true" />
      <Offline />
      <Header />
      <Screens />
      <Dock />
      <Inbox />
      <FlowHost />
      <QuizGameHost />
      <McqRun />
      <SheetHost />
      <ToastHost />
      <Walkthrough />
      <Boot />
    </AppProvider>
  );
}

function QuizGameHost() {
  const c = useApp();
  return c.quiz ? <QuizGame key={c.quiz.id} /> : null;
}
