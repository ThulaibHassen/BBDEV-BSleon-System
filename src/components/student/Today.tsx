'use client';

import { useEffect, useState } from 'react';
import { put } from '@/lib/client/api';
import { waLink } from '@/lib/shared/constants';
import { daysBetween, todayISO } from '@/lib/shared/dates';
import { useApp } from './ctx';
import { Ic } from './icons';
import { Chev, Row } from './ui';
import { McqBrief } from './Practice';
import { TuteSheet } from './tasks';
import { GuideSheet } from './Pages';
import {
  IB_TYPES,
  KIND_LABEL,
  PRIO,
  attRate,
  checkinDue,
  coveredCount,
  examAt,
  examBand,
  examDateOf,
  examLeft,
  fmtD,
  fmtFull,
  lastClass,
  monthName,
  nextClass,
  recommend,
  shownCount,
  tName,
  unitClass,
  unitName,
  type Model,
  type RecItem,
} from './model';
import { MsgSheet } from './Inbox';
import { QuizJoin } from './Quiz';

/* ══ TODAY. Open it and the next thing is already there. ══ */

const KIND_ICON: Record<string, (p: { size?: number }) => React.ReactElement> = {
  recording: Ic.play,
  catchup: Ic.book,
  recheck: Ic.bolt,
  tute: Ic.doc,
  papers: Ic.doc,
};

/* THE EXAM CLOCK. Four bands, because one format cannot be honest across
   sixteen months: days only, then days and hours inside two weeks, hours and
   minutes on the last day, a sentence on the day itself and after. It is
   recomputed from an absolute target every tick, never decremented, and it
   stops while the tab is hidden. Seconds are never shown. */
function ExamClock({ m }: { m: Model }) {
  const [, setTick] = useState(0);
  const band = examBand(m);
  useEffect(() => {
    let t: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      stop();
      t = setInterval(() => setTick((n) => n + 1), examBand(m) === 'hours' ? 20000 : 60000);
    };
    const stop = () => {
      if (t) clearInterval(t);
      t = null;
    };
    const vis = () => {
      if (document.hidden) stop();
      else {
        setTick((n) => n + 1);
        start();
      }
    };
    start();
    document.addEventListener('visibilitychange', vis);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', vis);
    };
  }, [m, band]);
  const t = examLeft(examAt(m));
  let body: React.ReactNode;
  let said: string;
  if (band === 'past') {
    body = <p className="ec-say">That one is behind you now.</p>;
    said = 'The exam has passed';
  } else if (band === 'today') {
    body = <p className="ec-say">Today is the day. You have done the work.</p>;
    said = 'The exam is today';
  } else if (band === 'hours') {
    body = (
      <div className="ec-row">
        <Tile v={t.h} l={t.h === 1 ? 'hour' : 'hours'} />
        <Tile v={t.m} l={t.m === 1 ? 'minute' : 'minutes'} />
      </div>
    );
    said = `${t.h} hours and ${t.m} minutes to go`;
  } else if (band === 'close') {
    body = (
      <div className="ec-row">
        <Tile v={t.d} l={t.d === 1 ? 'day' : 'days'} />
        <Tile v={t.h} l={t.h === 1 ? 'hour' : 'hours'} />
      </div>
    );
    said = `${t.d} days and ${t.h} hours to go`;
  } else {
    body = (
      <>
        <div className="ec-row">
          <div className="ec-t ec-solo">
            <div className="ec-n">{t.d}</div>
            <div className="ec-l">days to go</div>
          </div>
        </div>
        <p className="ec-when">{fmtFull(examDateOf(m))}</p>
      </>
    );
    said = `${t.d} days to go`;
  }
  return (
    <article className="card examclock" role="timer" aria-live="off" data-band={band}>
      <div className="ec-lbl">A/L Business Studies</div>
      {body}
      <p className="sr" aria-live="polite">
        {said}
      </p>
    </article>
  );
}
const Tile = ({ v, l }: { v: number; l: string }) => (
  <div className="ec-t">
    <div className="ec-n">{v}</div>
    <div className="ec-l">{l}</div>
  </div>
);

/* THE RING: topics shown in a check, out of topics covered (attendance until
   anything is covered). Drawn empty, then filled on the next frame. */
function Ring({ pct, label }: { pct: number; label: string }) {
  const C = 238.76;
  const off = C * (1 - Math.max(0, Math.min(100, pct)) / 100);
  const [o, setO] = useState(C);
  useEffect(() => {
    const r = requestAnimationFrame(() => setO(off));
    return () => cancelAnimationFrame(r);
  }, [off]);
  return (
    <div className="ring">
      <svg width="86" height="86" viewBox="0 0 86 86" aria-hidden="true">
        <circle className="bg" cx="43" cy="43" r="38" fill="none" strokeWidth="7" />
        <circle className="fg" cx="43" cy="43" r="38" fill="none" strokeWidth="7" strokeDasharray={C.toFixed(2)} style={{ strokeDashoffset: o }} />
      </svg>
      <div className="mid">
        <div className="v">
          {pct}
          <i>%</i>
        </div>
        <div className="k">{label}</div>
      </div>
    </div>
  );
}

function Hero({ m }: { m: Model }) {
  const cov = coveredCount(m);
  const shown = shownCount(m);
  const [pct, label] = cov ? [Math.round((shown / cov) * 100), 'shown'] : [Math.round(attRate(m) * 100), 'attended'];
  return (
    <section className="hero">
      <ExamClock m={m} />
      <Ring pct={pct} label={label} />
    </section>
  );
}

function Primary({ m, top }: { m: Model; top?: RecItem }) {
  const c = useApp();
  const resume = m.progressTask;
  if (resume) {
    const KI = KIND_ICON[resume.kind] || Ic.book;
    return (
      <div className="primary">
        <div className="kind">
          <KI size={14} />
          In progress
        </div>
        <h2>{tName(resume.topic)}</h2>
        <p className="why">You stopped part way through</p>
        <button className="btn" onClick={() => c.startTask({ kind: resume.kind as RecItem['kind'], topic: resume.topic })}>
          Resume
        </button>
      </div>
    );
  }
  if (!top)
    return (
      <div className="card">
        <h2>Nothing urgent</h2>
        <p className="lede" style={{ marginTop: 'var(--s2)' }}>
          You are level with the class. A short review keeps it that way.
        </p>
        <button className="btn btn-primary" style={{ marginTop: 'var(--s4)' }} onClick={() => c.show('learn', 'syllabus')}>
          Review a topic
        </button>
      </div>
    );
  const KI = KIND_ICON[top.kind];
  return (
    <div className="primary">
      <div className="kind">
        <KI size={14} />
        {KIND_LABEL[top.kind]}
        <span className="dot" />
        {top.mins} min
      </div>
      <h2>{top.title.replace(/^Catch up: /, '').replace(/^Watch: /, '')}</h2>
      <p className="why">
        {top.days != null ? (
          <>
            You missed this class,{' '}
            <span className="urgent">
              {top.days} day{top.days === 1 ? '' : 's'} left
            </span>{' '}
            to watch it
          </>
        ) : (
          top.why
        )}
      </p>
      <button className="btn" onClick={() => c.startTask(top)}>
        {top.kind === 'recording' ? 'Watch the class' : top.kind === 'tute' ? 'Open tute' : top.kind === 'papers' ? 'Open papers' : 'Start'}
      </button>
    </div>
  );
}

/* #7 — one tap to the next test and to the tute Leon set. */
function Shortcuts() {
  const c = useApp();
  const m = c.m!;
  const open = (c.mcq || []).filter((p) => !p.finished_at);
  const test = open.find((p) => p.in_progress) || open[0];
  const tute = m.tuteAssign[0];
  if (!test && !tute) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: test && tute ? '1fr 1fr' : '1fr', gap: 'var(--s2)' }}>
      {test && (
        <button className="todaymsg" style={{ width: '100%' }} onClick={() => c.openSheet(<McqBrief id={test.id} />)}>
          <span className="grow" style={{ flex: 1, minWidth: 0 }}>
            <span className="tt">{test.in_progress ? 'Carry on the test' : 'Start test'}</span>
            <span className="tw">
              {test.title} · {test.minutes} min
            </span>
          </span>
          <Chev />
        </button>
      )}
      {tute && (
        <button
          className="todaymsg"
          style={{ width: '100%' }}
          disabled={!!tute.documentId && c.libBusy === tute.documentId}
          onClick={() => (tute.documentId ? c.openDoc(tute.documentId) : c.openSheet(<TuteSheet u={tute.unit} />))}
        >
          <span className="grow" style={{ flex: 1, minWidth: 0 }}>
            <span className="tt">Open tute</span>
            <span className="tw">{tute.documentId && c.libBusy === tute.documentId ? 'Opening…' : `Unit ${tute.unit} · ${unitName(tute.unit)}`}</span>
          </span>
          <Chev />
        </button>
      )}
    </div>
  );
}

/* Only when there is one. An empty row saying "no papers" teaches a student
   to stop reading the list. */
function McqRow() {
  const c = useApp();
  const open = (c.mcq || []).filter((p) => !p.finished_at);
  if (!open.length) return null;
  const p = open[0];
  const drills = open.filter((x) => x.kind === 'drill').length;
  const what =
    drills === open.length
      ? open.length > 1
        ? open.length + ' speed drills waiting'
        : 'Speed drill waiting'
      : drills
        ? open.length + ' MCQ papers and drills waiting'
        : open.length > 1
          ? open.length + ' MCQ papers waiting'
          : 'MCQ paper waiting';
  return <Row t={what} w={`${p.title} · ${p.minutes} min${p.in_progress ? ' · started' : ''}`} onClick={() => c.show('practice')} />;
}

/* ── the monthly check-in: two taps, never a survey ── */
function CheckinSheet({ month }: { month: string }) {
  const c = useApp();
  const [mood, setMood] = useState<string | null>(null);
  const [blocker, setBlocker] = useState<string | null>(null);
  const done = (b: string) => {
    setBlocker(b);
    c.write(
      (x) => ({ ...x, checkins: [...x.checkins.filter((k) => k.month !== month), { month, mood: mood!, blocker: b }] }),
      () => put('/api/student/checkins', { month, mood, blocker: b }),
    );
    c.say('Check-in recorded');
  };
  if (!mood)
    return (
      <>
        <h3 id="sheetTitle">How did {monthName(month)} feel?</h3>
        <p className="lede">One honest tap. Leon sees this, the batch never does.</p>
        <div style={{ marginTop: 'var(--s4)' }}>
          {[
            ['steady', 'Steady', 'I kept up'],
            ['heavy', 'Heavy', 'I kept up, but it cost me'],
            ['struggling', 'Struggling', 'I fell behind'],
          ].map((o) => (
            <button key={o[0]} className="qopt" role="radio" aria-checked="false" onClick={() => setMood(o[0])}>
              <span className="mk">
                <Ic.check />
              </span>
              <span>
                <b>{o[1]}</b>
                <span className="meta" style={{ display: 'block' }}>
                  {o[2]}
                </span>
              </span>
            </button>
          ))}
        </div>
      </>
    );
  if (!blocker)
    return (
      <>
        <h3 id="sheetTitle">What got in the way most?</h3>
        <p className="lede">Pick the biggest one.</p>
        <div style={{ marginTop: 'var(--s4)' }}>
          {[
            ['none', 'Nothing much'],
            ['time', 'Finding the time'],
            ['topics', 'Some topics did not land'],
            ['motivation', 'Keeping the energy up'],
            ['personal', 'Something outside studies'],
          ].map((o) => (
            <button key={o[0]} className="qopt" role="radio" aria-checked="false" onClick={() => done(o[0])}>
              <span className="mk">
                <Ic.check />
              </span>
              <span>{o[1]}</span>
            </button>
          ))}
        </div>
      </>
    );
  const wa = waLink(c.m?.config.support.wa || '0771396173', `Hi Leon, ${c.m?.me.first} here from the ${c.m?.me.batch} batch. `);
  const R: Record<string, [string, string, () => void]> = {
    topics: [
      'Then the fix is specific, not more hours. Your Needs attention list is exactly those topics.',
      'See the topics',
      () => {
        c.closeSheet();
        c.setSylFilter('attention');
        c.show('learn', 'syllabus');
      },
    ],
    time: ['Short beats long. Most tasks on Today fit inside ten minutes, and ten minutes counts.', 'See today’s ten minutes', () => (c.closeSheet(), c.show('next'))],
    motivation: ['Look at what is already behind you. The road does not reset because a week was flat.', 'See how far you are', () => (c.closeSheet(), c.show('progress'))],
    personal: [
      'Studies can wait a beat when life is loud. If you want to talk, Leon reads these and his door is open.',
      'Message Leon',
      () => {
        c.closeSheet();
        window.open(wa, '_blank', 'noopener');
      },
    ],
    none: ['Noted. Keep the rhythm that got you here.', 'Back to today', () => (c.closeSheet(), c.show('next'))],
  };
  const [help, lbl, act] = R[blocker];
  return (
    <>
      <h3 id="sheetTitle">Noted, quietly.</h3>
      <p className="lede">{help}</p>
      <button className="btn btn-primary" style={{ marginTop: 'var(--s5)' }} onClick={act}>
        {lbl}
      </button>
    </>
  );
}

export function Today() {
  const c = useApp();
  const m = c.m!;

  const recs = recommend(m);
  const top = recs[0];
  const rest = recs.slice(1, 4);
  const lc = lastClass(m);
  const nx = nextClass(m);
  const unread = m.inbox.filter((x) => !x.read).sort((a, b) => (PRIO[a.type] || 7) - (PRIO[b.type] || 7));
  const tm = unread[0];
  const ci = checkinDue(m);
  const isNew = !!m.me.joined && daysBetween(m.me.joined, todayISO()) <= 30 && !!m.config.pages.guide?.trim();

  return (
    <div className="stack">
      <Hero m={m} />
      {tm && (
        <button className="todaymsg" style={{ width: '100%' }} onClick={() => c.openSheet(<MsgSheet id={tm.id} />)}>
          <span className="grow" style={{ flex: 1, minWidth: 0 }}>
            <span className="tt">{tm.title}</span>
            <span className="tw">
              {IB_TYPES[tm.type] || 'General'} · tap to open · <u>view all updates</u>
            </span>
          </span>
          <Chev />
        </button>
      )}
      {ci && (
        <button className="todaymsg" style={{ width: '100%' }} onClick={() => c.openSheet(<CheckinSheet month={ci} />)}>
          <span className="grow" style={{ flex: 1, minWidth: 0 }}>
            <span className="tt">How did {monthName(ci)} feel?</span>
            <span className="tw">Two taps. Leon sees it, the batch never does.</span>
          </span>
          <Chev />
        </button>
      )}
      <Primary m={m} top={top} />
      <Shortcuts />
      {rest.length > 0 && (
        <>
          <div className="sect-h">
            <h2>Then</h2>
          </div>
          <div className="list">
            {rest.map((r, i) => (
              <button key={i} className={`rowbtn taskrow ${unitClass(r.topic)}`} onClick={() => c.startTask(r)}>
                <span className="grow">
                  <span className="tt">{r.title}</span>
                  <span className="tw">
                    {r.why} · {r.mins} min
                  </span>
                </span>
                <Chev />
              </button>
            ))}
          </div>
        </>
      )}
      <div className="sect-h">
        <h2>Class</h2>
      </div>
      <div className="list">
        <Row t="Next" w={nx ? `${nx.c.day} ${fmtD(nx.date)}${nx.c.time ? ' · ' + nx.c.time : ''} · ${m.me.locLabel}` : 'Leon has not set class times yet'} />
        <Row t="Last lesson" w={lc ? lc.topics.map((t) => tName(t)).join(', ') : 'None yet'} />
        <Row t="Join a quiz" w="When Leon puts a code on the class screen" onClick={() => c.openSheet(<QuizJoin />)} />
        <McqRow />
        {isNew && <Row t="New here?" w="What the class expects, in a few lines" onClick={() => c.openSheet(<GuideSheet />)} />}
        <Row t="Ask Leon" w="WhatsApp" href={waLink(m.config.support.wa || '0771396173', `Hi Leon, ${m.me.first} here from the ${m.me.batch} batch. `)} />
      </div>
    </div>
  );
}
