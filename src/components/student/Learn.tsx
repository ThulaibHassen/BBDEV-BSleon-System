'use client';

import { useEffect, useRef, useState } from 'react';
import { post } from '@/lib/client/api';
import { useApp, type LearnSeg } from './ctx';
import { Ic } from './icons';
import { Chev, Empty, Row } from './ui';
import { ConfIcon, ConfSheet, TopicSheet, TuteSheet } from './tasks';
import {
  EV_TEXT,
  SYLLABUS,
  TUTE_LABEL,
  comparable,
  covered,
  dowName,
  evOf,
  evStale,
  flatTopics,
  fmtD,
  paperInsights,
  tUnit,
  tracker,
  untilText,
  type LibDoc,
  type Model,
} from './model';

/* ══ LEARN: Syllabus, Tutes, Papers (the PDF library and your own attempt
   log), Recordings. Tapping Learn in the dock always lands on Syllabus. ══ */

const SEGS: [LearnSeg, string][] = [
  ['syllabus', 'Syllabus'],
  ['tutes', 'Tutes'],
  ['papers', 'Papers'],
  ['recordings', 'Recordings'],
];

const FILTERS: [string, string][] = [
  ['next', 'Do next'],
  ['attention', 'Needs attention'],
  ['untested', 'Not checked'],
  ['shown', 'Shown'],
  ['all', 'All topics'],
];

function topicMatches(m: Model, cov: Record<string, string>, t: string, f: string) {
  const c = cov[t];
  if (f === 'all') return true;
  if (f === 'next') return !!c && evOf(m, t) !== 'demonstrated';
  if (f === 'attention') return !!c && (m.conf[t] === 'lost' || m.conf[t] === 'shaky' || evOf(m, t) === 'developing' || evStale(m, t));
  if (f === 'untested') return !!c && evOf(m, t) === 'untested';
  if (f === 'shown') return evOf(m, t) === 'demonstrated';
  return true;
}

/* ── UNIT WEIGHTAGE: Leon's read of where the marks fall, labelled as his.
   The chip on a unit marks a signal only: high is filled, low is plain
   text, medium (ordinary) is silent. ── */
function WeightChip({ m, u }: { m: Model; u: string }) {
  const r = m.weights.find((w) => String(w.unit) === u);
  if (!r) return null;
  if (r.band === 'high') return <span className="wchip on">High yield</span>;
  if (r.band === 'low') return <span className="wchip low">Lower</span>;
  return null;
}

function WeightsCard({ m }: { m: Model }) {
  const list = m.weights.filter((r) => r.share != null || r.band === 'high' || r.band === 'low');
  if (!list.length) return null;
  const top = list.filter((r) => r.band === 'high');
  const max = list.reduce((a, r) => Math.max(a, r.share || 0), 0) || 1;
  return (
    <article className="card wmap">
      <div className="wmap-h">
        <h2>Where the marks are</h2>
        <span className="meta">Leon’s estimate</span>
      </div>
      <p className="lede">
        {top.length
          ? `He rates ${top.length === 1 ? 'one unit' : top.length + ' units'} high yield. Revise ${top.length === 1 ? 'it' : 'those'} first when time is short.`
          : 'Use it to decide what to revise first when time is short.'}
      </p>
      <div className="wmap-list">
        {list.map((r) => {
          const u = SYLLABUS.find((x) => x.u === String(r.unit));
          return (
            <div key={r.unit}>
              <div className={`wmap-row${r.band === 'high' ? ' hi' : ''}`}>
                <div className="wmap-u">
                  <span className="n">{r.unit}</span>
                  <span className="t">{u ? u.name : 'Unit ' + r.unit}</span>
                </div>
                <div className="wmap-bar">
                  <i style={{ width: Math.round(((r.share || 0) / max) * 100) + '%' }} />
                </div>
                <div className="wmap-v">{r.share != null ? r.share + '%' : '—'}</div>
              </div>
              {r.note && <div className="wmap-note">{r.note}</div>}
            </div>
          );
        })}
      </div>
      <p className="meta" style={{ marginTop: 'var(--s3)' }}>
        Percentages are how Leon expects the paper to fall, not an official split. They are a guide to revision order, not a reason to skip a unit.
      </p>
    </article>
  );
}

/* #14 — where the class is: units finished, the one in progress, and the
   next one, all from what Leon logged for this batch. */
function Tracker({ m }: { m: Model }) {
  if (!m.classLog.length) return null;
  const t = tracker(m);
  return (
    <div className="list tracker">
      <Row
        t="Done"
        w={t.done.length ? t.done.map((u) => `Unit ${u.u}`).join(', ') : 'No unit finished yet'}
        right={<span className="pill">{t.done.length} of {SYLLABUS.length}</span>}
      />
      <Row
        t="Ongoing"
        w={t.ongoing.length ? t.ongoing.map((u) => `Unit ${u.u} · ${u.name} · ${u.n} of ${u.total} topics`).join('; ') : 'Nothing half done'}
        right={t.ongoing.length ? <span className="pill solid">Now</span> : undefined}
      />
      <Row t="Up next" w={t.upNext ? `Unit ${t.upNext.u} · ${t.upNext.name}` : 'The whole syllabus is covered'} />
    </div>
  );
}

function Syllabus({ m }: { m: Model }) {
  const c = useApp();
  const f = c.sylFilter;
  const cov = covered(m);
  let curUnit = '1';
  for (const t of flatTopics()) if (cov[t]) curUnit = tUnit(t);
  const [openU, setOpenU] = useState<Record<string, boolean>>({});
  /* a new filter starts with every unit at its default again */
  const [openFor, setOpenFor] = useState(f);
  if (openFor !== f) {
    setOpenFor(f);
    setOpenU({});
  }
  const units = SYLLABUS.map((u) => {
    const list = u.topics.filter((t) => topicMatches(m, cov, t[0], f));
    if (!list.length) return null;
    const def = f !== 'all' || u.u === curUnit;
    const open = openU[u.u] ?? def;
    const covN = u.topics.filter((t) => cov[t[0]]).length;
    return (
      <div className="list" key={u.u}>
        <button className="unit-h" aria-expanded={open} onClick={() => setOpenU((o) => ({ ...o, [u.u]: !open }))}>
          <span className="un">
            Unit {u.u} · {u.name}
          </span>
          <WeightChip m={m} u={u.u} />
          <span className="uc num">
            {covN}/{u.topics.length}
          </span>
          <span className="caret">
            <Ic.chev />
          </span>
        </button>
        <div className="unit-body" hidden={!open}>
          {list.map(([id, name]) => {
            const cd = cov[id];
            const ev = evOf(m, id);
            const cf = m.conf[id] || '';
            return (
              <div className={`topic${cd ? '' : ' future'}`} key={id}>
                <button className={`conf ${cf}`} aria-label={`How sure you feel about ${name}`} onClick={() => c.openSheet(<ConfSheet t={id} />)}>
                  <ConfIcon k={cf} />
                </button>
                <button className="grow" style={{ minHeight: 44, flex: 1, minWidth: 0 }} onClick={() => c.openSheet(<TopicSheet t={id} />)}>
                  <span className="tn">{name}</span>
                  <span className="tsub">
                    <span className={`stat${cd ? ' on' : ''}`}>{cd ? 'Covered ' + fmtD(cd) : 'Not covered'}</span>
                    <span className={`stat${ev === 'demonstrated' ? ' on' : ''}`}>{EV_TEXT[ev]}</span>
                  </span>
                </button>
                <Chev />
              </div>
            );
          })}
        </div>
      </div>
    );
  }).filter(Boolean);
  return (
    <>
      <Tracker m={m} />
      <div className="chipbar" role="group" aria-label="Filter topics" style={{ marginTop: m.classLog.length ? 'var(--s4)' : 0 }}>
        {FILTERS.map(([k, label]) => {
          const n = flatTopics().filter((t) => topicMatches(m, cov, t, k)).length;
          return (
            <button
              key={k}
              className="chip"
              aria-pressed={f === k}
              onClick={() => {
                c.setSylFilter(k);
                c.say(k + ' filter');
              }}
            >
              {label}
              <span className="num" style={{ opacity: 0.6 }}>
                {n}
              </span>
            </button>
          );
        })}
      </div>
      <div className="stack" style={{ marginTop: 'var(--s3)' }}>
        {(f === 'all' || f === 'next') && <WeightsCard m={m} />}
        {units.length ? units : <Empty t="Nothing here" s="No topics match this filter yet." />}
      </div>
    </>
  );
}

function Tutes({ m }: { m: Model }) {
  const c = useApp();
  const cov = covered(m);
  const units = SYLLABUS.filter((u) => u.topics.some((t) => cov[t[0]]) || m.tuteAssign.some((a) => a.unit === u.u));
  if (!units.length) return <Empty t="No tutes yet" s="They appear once your class covers a unit." />;
  return (
    <div className="list">
      {units.map((u) => {
        const s = m.tutes[u.u] || 'assigned';
        const doc = m.tuteAssign.find((a) => a.unit === u.u && a.documentId);
        return (
          <button key={u.u} className="rowbtn" onClick={() => c.openSheet(<TuteSheet u={u.u} />)}>
            <span className="grow">
              <span className="tt" style={{ fontWeight: 550 }}>
                Unit {u.u} · {u.name}
              </span>
              <span className="tw">
                {TUTE_LABEL[s]}
                {doc ? ' · PDF from Leon' : ''}
              </span>
            </span>
            <Chev />
          </button>
        );
      })}
    </div>
  );
}

/* ── THE PAPER TIMER. Timing it in the app makes "timed" a measured fact.
   Absolute timestamps, never a counter, so a locked phone comes back right;
   kept on the phone so switching screens does not lose it. ── */
type SW = { startedAt: number; paused: number; pausedAt: number | null };
const SW_KEY = 'bswl_sw';
const readSW = (): SW | null => {
  try {
    return JSON.parse(localStorage.getItem(SW_KEY) || 'null');
  } catch {
    return null;
  }
};
const writeSW = (s: SW | null) => {
  try {
    if (s) localStorage.setItem(SW_KEY, JSON.stringify(s));
    else localStorage.removeItem(SW_KEY);
  } catch {}
};
const swElapsed = (s: SW) => (s.pausedAt ?? Date.now()) - s.startedAt - s.paused;
const swFmt = (ms: number) => {
  const t = Math.floor(ms / 1000);
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
};

function Timer() {
  const c = useApp();
  // only ever rendered on the phone (Learn waits for the student's data), so it can read storage at once
  const [sw, setSw] = useState<SW | null>(readSW);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!sw || sw.pausedAt) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [sw]);
  const set = (s: SW | null) => {
    writeSW(s);
    setSw(s);
  };
  if (!sw)
    return (
      <article className="card">
        <div className="tt" style={{ fontWeight: 600 }}>
          Time yourself
        </div>
        <div className="tw">Start it before you begin. The app records how long you took, so you are not guessing afterwards.</div>
        <button className="btn btn-primary" style={{ marginTop: 'var(--s3)' }} onClick={() => set({ startedAt: Date.now(), paused: 0, pausedAt: null })}>
          Start the timer
        </button>
      </article>
    );
  const running = !sw.pausedAt;
  return (
    <article className="card" role="timer" aria-live="off">
      <div className="ec-lbl">{running ? 'Timing' : 'Paused'}</div>
      <div className="ec-d num" style={{ fontSize: 38, fontWeight: 750, lineHeight: 1 }}>
        {swFmt(swElapsed(sw))}
      </div>
      <div style={{ display: 'flex', gap: 'var(--s2)', marginTop: 'var(--s3)' }}>
        <button
          className="btn"
          style={{ flex: 1 }}
          onClick={() => set(running ? { ...sw, pausedAt: Date.now() } : { ...sw, paused: sw.paused + (Date.now() - (sw.pausedAt || Date.now())), pausedAt: null })}
        >
          {running ? 'Pause' : 'Resume'}
        </button>
        <button
          className="btn btn-primary"
          style={{ flex: 1 }}
          onClick={() => {
            const mins = Math.max(1, Math.round(swElapsed(sw) / 6e4));
            set(null);
            c.setFlow({ type: 'log', preset: { timed: true, mins } });
          }}
        >
          Done, add my mark
        </button>
      </div>
      <button className="btn" style={{ width: '100%', marginTop: 'var(--s2)' }} onClick={() => set(null)}>
        Throw it away
      </button>
    </article>
  );
}

/* ── THE PDF LIBRARY. Get the paper here, sit it, then log it below: the
   order it happens in. No file is reachable by URL; a tap asks for a
   two-minute ticket. #6 target papers are open for a set window, and the
   time left is the one amber thing on this screen because it expires. ── */
function Library({ m }: { m: Model }) {
  const c = useApp();
  const docs = c.lib;
  const [year, setYear] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);
  if (!docs) return <div className="skel" style={{ height: 96 }} />;
  const targets = docs.filter((d) => d.kind === 'target' && (!d.availableUntil || new Date(d.availableUntil).getTime() > now));
  const past = docs.filter((d) => (d.kind === 'paper' || d.kind === 'scheme') && d.year != null);
  const other = docs.filter((d) => d.kind === 'guide' || d.kind === 'other' || ((d.kind === 'paper' || d.kind === 'scheme') && d.year == null));
  const ys = [...new Set(past.map((d) => d.year!))].sort((a, b) => b - a);
  const y = year != null && ys.includes(year) ? year : ys[0];
  const mine = past
    .filter((d) => d.year === y)
    .sort((a, b) => (a.part ?? '').localeCompare(b.part ?? '', undefined, { numeric: true, sensitivity: 'base' }) || (a.kind === b.kind ? 0 : a.kind === 'paper' ? -1 : 1) || a.lang.localeCompare(b.lang));

  const docRow = (d: LibDoc, name: string, notes: string[], w?: React.ReactNode) => {
    const busy = c.libBusy === d.id;
    return (
      <button key={d.id} className="rowbtn" onClick={() => c.openDoc(d.id)} disabled={busy}>
        <span className="grow">
          <span className="tt" style={{ fontWeight: 550 }}>
            {name}
          </span>
          <span className="tw">{busy ? 'Opening…' : (w ?? (notes.join(' · ') || 'PDF'))}</span>
        </span>
        <Chev />
      </button>
    );
  };
  const notesOf = (d: LibDoc) => {
    const n: string[] = [];
    const lang = d.lang.toLowerCase();
    if (lang === 'si') n.push('Sinhala');
    else if (lang === 'ta') n.push('Tamil');
    if (d.source.toLowerCase() === 'leon') n.push('Leon’s typed version');
    if (d.pages) n.push(d.pages + ' pages');
    return n;
  };

  return (
    <>
      {targets.length > 0 && (
        <>
          <div className="sect-h">
            <h2>Target papers</h2>
            <span className="meta">Open for a short window</span>
          </div>
          <div className="list">
            {targets.map((d) =>
              docRow(
                d,
                d.title,
                [],
                d.availableUntil ? (
                  <>
                    <span className="urgent">{untilText(d.availableUntil, now)}</span>
                    {d.pages ? ` · ${d.pages} pages` : ''}
                  </>
                ) : (
                  'No time limit on this one.'
                ),
              ),
            )}
          </div>
        </>
      )}
      <div className="sect-h">
        <h2>Past papers</h2>
        {past.length > 0 && <span className="meta num">{past.length} on file</span>}
      </div>
      {past.length ? (
        <>
          <div className="chipbar" role="group" aria-label="Choose a year">
            {ys.map((yy) => (
              <button key={yy} className="chip" aria-pressed={yy === y} onClick={() => setYear(yy)}>
                {yy}
              </button>
            ))}
          </div>
          <div className="list" style={{ marginTop: 'var(--s3)' }}>
            {mine.map((d) => docRow(d, `${d.part ? `Part ${d.part} · ` : ''}${d.kind === 'scheme' ? 'marking scheme' : 'question paper'}`, notesOf(d)))}
          </div>
        </>
      ) : (
        <div className="list">
          <Row t="Nothing here yet" w="Leon adds papers as he releases them." />
        </div>
      )}
      {other.length > 0 && (
        <>
          <div className="sect-h">
            <h2>Notes and guides</h2>
          </div>
          <div className="list">{other.map((d) => docRow(d, d.title, notesOf(d)))}</div>
        </>
      )}
      <div className="sect-h">
        <h2>Your attempts</h2>
      </div>
      <Attempts m={m} />
    </>
  );
}

function Attempts({ m }: { m: Model }) {
  const c = useApp();
  if (!m.papers.length)
    return (
      <>
        <Empty t="No attempts yet" s="Log one and patterns start showing." />
        <button className="btn btn-primary" style={{ marginTop: 'var(--s4)' }} onClick={() => c.setFlow({ type: 'log' })}>
          Log an attempt
        </button>
        <div style={{ marginTop: 'var(--s3)' }}>
          <Timer />
        </div>
      </>
    );
  const ins = paperInsights(m);
  return (
    <div className="stack">
      <Timer />
      {ins.length > 0 && (
        <div className="list">
          {ins.map((x, i) => (
            <Row key={i} t={x.t} w={x.s} bold />
          ))}
        </div>
      )}
      <button className="btn btn-primary" onClick={() => c.setFlow({ type: 'log' })}>
        Log an attempt
      </button>
      <div className="sect-h">
        <h2>Recent</h2>
      </div>
      <div className="list">
        {m.papers
          .slice(-6)
          .reverse()
          .map((p) => {
            const comp = comparable(m, p);
            return (
              <Row
                key={p.id}
                bold
                t={`${p.paper} ${p.q}`}
                w={`${p.timed ? 'Timed' : 'Untimed'} · ${p.marker === 'self' ? 'Self-marked' : 'Marked by Leon'}${p.err ? ' · ' + p.err : ''}${comp.length > 1 ? ' · ' + comp.length + ' comparable' : ''}`}
                right={
                  <span className="num" style={{ fontWeight: 650 }}>
                    {p.score}/{p.max}
                  </span>
                }
              />
            );
          })}
      </div>
    </div>
  );
}

function Recordings({ m }: { m: Model }) {
  const c = useApp();
  const mine = m.recordings;
  const closed = m.recClosed;
  const opened = (id: number, title: string) => {
    c.say('Opening ' + title);
    post(`/api/student/recordings/${id}/view`).catch(() => {});
  };
  return (
    <div className="stack">
      {mine.length ? (
        mine.map((r) => {
          const dl = r.daysLeft;
          return (
            <article key={r.id} className={`card${dl !== null && dl <= 3 ? ' closing' : ''}`}>
              <div className="tt" style={{ fontWeight: 600 }}>
                {r.title}
              </div>
              <div className="tw">
                {dowName(r.date)} {fmtD(r.date)}
                {r.mins ? ` · ${r.mins} min` : ''}
                {r.missed ? ' · you missed this class' : ''}
              </div>
              <p className="lede" style={{ marginTop: 'var(--s2)' }}>
                {dl === null ? (
                  'No time limit on this one.'
                ) : dl === 1 ? (
                  <>
                    <span className="urgent">Last day</span> to watch it.
                  </>
                ) : (
                  <>
                    <span className="urgent">{dl} days left</span> to watch it.
                  </>
                )}
              </p>
              <a className="btn btn-primary" style={{ marginTop: 'var(--s3)' }} href={r.url} target="_blank" rel="noopener" onClick={() => opened(r.id, r.title)}>
                Watch the class
              </a>
              <button
                className="btn btn-secondary"
                style={{ marginTop: 'var(--s2)' }}
                onClick={() => {
                  try {
                    navigator.clipboard.writeText(r.url);
                  } catch {}
                  c.showToast('Link copied. Save it while you are on wifi.');
                }}
              >
                Copy the link to save it
              </button>
            </article>
          );
        })
      ) : (
        <Empty t="Nothing to catch up on" s="Recordings appear here when you miss a class, or when Leon opens one to the whole batch." />
      )}
      {closed > 0 && (
        <p className="lede" style={{ marginTop: 'var(--s3)' }}>
          {closed} older recording{closed > 1 ? 's have' : ' has'} closed. Ask Leon if you still need {closed > 1 ? 'them' : 'it'}.
        </p>
      )}
      <p className="lede" style={{ marginTop: 'var(--s3)' }}>
        These links are yours to watch. Please do not pass them on.
      </p>
    </div>
  );
}

export function Learn() {
  const c = useApp();
  const m = c.m!;
  const segRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    /* the selected segment scrolls into view */
    const bar = segRef.current;
    const b = bar?.querySelector<HTMLElement>('button[aria-selected="true"]');
    if (!bar || !b) return;
    const br = b.getBoundingClientRect();
    const pr = bar.getBoundingClientRect();
    if (br.left < pr.left || br.right > pr.right) bar.scrollLeft += br.left - pr.left - (pr.width - br.width) / 2;
  }, [c.learnSeg]);
  return (
    <>
      <div className="seg" role="tablist" aria-label="Learn sections" ref={segRef}>
        {SEGS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={c.learnSeg === k} onClick={() => c.setLearnSeg(k)}>
            {label}
          </button>
        ))}
      </div>
      <div style={{ marginTop: 'var(--s4)' }}>
        {c.learnSeg === 'syllabus' && <Syllabus m={m} />}
        {c.learnSeg === 'tutes' && (
          <div className="stack">
            <Tutes m={m} />
          </div>
        )}
        {c.learnSeg === 'papers' && (
          <div className="stack">
            <Library m={m} />
          </div>
        )}
        {c.learnSeg === 'recordings' && <Recordings m={m} />}
      </div>
    </>
  );
}
