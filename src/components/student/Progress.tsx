'use client';

import { useEffect, useState } from 'react';
import { useApp } from './ctx';
import { Ic } from './icons';
import { KV, Row } from './ui';
import { PushSheet } from './PushSheet';
import { GuideRows } from './Pages';
import { PUSH_LINE, onPushChange, pushState } from './push';
import { attRate, coveredCount, milestones, paperTrend, rewards, shownCount, type Model } from './model';
import { pushForget } from './push';
import { post } from '@/lib/client/api';

/* ══ PROGRESS, read as a report: one dark panel with the two numbers that
   describe a student, then the detail in plain rows. Monochrome on purpose:
   a student's own standing is not a scoreboard, and nobody is ranked. ══ */

export const THEMES = [
  { k: 'mono', n: 'Black and white', a: '#f7f7f7', b: '#8a8a8a' },
  { k: 'sunset', n: 'Sunset', a: '#ff8a3d', b: '#ffd166' },
  { k: 'neon', n: 'Neon', a: '#ff5fa2', b: '#f3ff5c' },
  { k: 'electric', n: 'Electric', a: '#4da3ff', b: '#ff9f45' },
];

export function applyMode(mode: string) {
  const html = document.documentElement;
  if (mode) html.setAttribute('data-mode', mode);
  else html.removeAttribute('data-mode');
  try {
    localStorage.setItem('bswl_mode', mode || '');
  } catch {}
  /* the strip above the page moves with the mode instead of staying black */
  const light = mode === 'light' || (!mode && window.matchMedia?.('(prefers-color-scheme: light)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#f6f6f7' : '#0d0d0d');
}

/* SPARKLINE. One comparable group at a time (same total, same timed status),
   so a change of difficulty never reads as improvement. Below three points
   there is no trend, so the marks are printed instead. */
function Spark({ vals }: { vals: number[] }) {
  const w = 72,
    h = 26,
    pad = 3;
  const lo = Math.min(...vals),
    hi = Math.max(...vals),
    span = hi - lo || 1;
  const pts = vals.map((v, i) => [pad + i * ((w - pad * 2) / (vals.length - 1)), h - pad - ((v - lo) / span) * (h - pad * 2)]);
  const last = pts[pts.length - 1];
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true" focusable="false">
      <polyline points={pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0].toFixed(1)} cy={last[1].toFixed(1)} r="2.6" fill="currentColor" />
    </svg>
  );
}

function MarksRow({ m }: { m: Model }) {
  const tr = paperTrend(m);
  if (!tr.length) return null;
  const pcts = tr.map((p) => Math.round((p.score / p.max) * 100));
  if (tr.length < 3) return <Row bold t="Your marks" w={pcts.join('%, ') + '%. A trend line appears once you have three papers of the same kind.'} />;
  return (
    <div className="rowbtn" style={{ cursor: 'default' }}>
      <span className="grow">
        <span className="tt" style={{ fontWeight: 550 }}>
          Your marks
        </span>
        <span className="tw">
          {tr[0].max} marks, {tr[0].timed ? 'timed' : 'untimed'} · oldest to newest
        </span>
        <span className="sr-only">Marks, oldest first: {pcts.join(' per cent, ')} per cent.</span>
      </span>
      <span style={{ color: 'var(--accent)', flex: 'none' }}>
        <Spark vals={pcts} />
      </span>
    </div>
  );
}

function RewardsSheet() {
  const { m } = useApp();
  return (
    <>
      <h3 id="sheetTitle">Rewards</h3>
      <p className="lede">Based on attendance marked in class.</p>
      <div className="stack" style={{ marginTop: 'var(--s4)' }}>
        {rewards(m!).map((r) => (
          <div className="card" key={r.t}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--s2)' }}>
              <h3 style={{ flex: 1 }}>{r.t}</h3>
              {r.done ? <span className="pill solid">Earned</span> : r.pending ? <span className="pill">Pending confirmation</span> : <span className="pill">Active</span>}
            </div>
            <p className="lede">{r.sub}</p>
            <div className="track" style={{ margin: 'var(--s3) 0 var(--s2)' }}>
              <i style={{ width: Math.min(100, Math.round((r.have / r.need) * 100)) + '%' }} />
            </div>
            <p className="meta">{r.rule}</p>
          </div>
        ))}
      </div>
    </>
  );
}

function RoadSheet() {
  const { m } = useApp();
  const SRC: Record<string, string> = { verified: 'Verified by Leon', self: 'Your own record', tutor: 'Confirmed by Leon', outcome: 'Exam result' };
  return (
    <>
      <h3 id="sheetTitle">Road to an A</h3>
      <p className="lede">Where each step comes from.</p>
      <div style={{ marginTop: 'var(--s4)' }}>
        {milestones(m!).map((x, i) => (
          <div className={`mile${x[1] ? ' done' : ''}`} key={i}>
            <span className="mn num">{x[1] ? <Ic.check size={13} /> : i + 1}</span>
            <span>
              <span style={{ display: 'block', fontWeight: 550 }}>{x[0]}</span>
              <span className="meta">{SRC[x[2]]}</span>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function BatchSheet() {
  const { m } = useApp();
  const b = m!.batch;
  const enough = b.n >= (m!.config.minBatch || 10);
  return (
    <>
      <h3 id="sheetTitle">Your batch</h3>
      <p className="lede">Percentages from {b.n} students. No rankings.</p>
      <div className="list" style={{ marginTop: 'var(--s4)' }}>
        <KV k="Finished the current tute" v={enough && b.tuteRate != null ? b.tuteRate + '%' : '-'} />
        <KV k="Median paper score" v={enough && b.median != null ? b.median + ' of 20' : '-'} />
      </div>
      {!enough && (
        <p className="meta" style={{ marginTop: 'var(--s3)' }}>
          Shown once the batch is big enough that nobody can be picked out.
        </p>
      )}
    </>
  );
}

export function Progress() {
  const c = useApp();
  const m = c.m!;
  const [, bump] = useState(0);
  useEffect(() => onPushChange(() => bump((n) => n + 1)), []);
  // Progress renders only once the student's data is here, i.e. never on the server
  const [theme, setThemeS] = useState(() => document.documentElement.getAttribute('data-theme') || 'mono');
  const [mode, setModeS] = useState(() => document.documentElement.getAttribute('data-mode') || '');

  const att = Math.round(attRate(m) * 100);
  const cov = coveredCount(m);
  const shown = shownCount(m);
  const ms = milestones(m);
  const doneN = ms.filter((x) => x[1]).length;
  const cur = ms.filter((x) => x[1]).pop();
  const nxt = ms.filter((x) => !x[1] && x[2] !== 'outcome')[0];
  const rw = rewards(m);
  const nextR = rw.filter((r) => !r.done)[0] || rw[0];
  const best = m.papers.reduce((a, p) => Math.max(a, Math.round((p.score / p.max) * 100)), 0);
  const ps = pushState();

  const setTheme = (k: string) => {
    document.documentElement.setAttribute('data-theme', k);
    try {
      localStorage.setItem('bswl_theme', k);
    } catch {}
    setThemeS(k);
    c.showToast((THEMES.find((t) => t.k === k)?.n || k) + ' it is.');
  };
  const setMode = (md: string) => {
    applyMode(md);
    setModeS(md);
  };
  const signOut = async () => {
    /* a shared phone must not keep getting the last student's reminders */
    await pushForget();
    await post('/api/auth/student/logout').catch(() => {});
    try {
      localStorage.removeItem('bswl_qz');
      /* the worker keeps the last good copy of this student's work for
         offline use; on a shared phone it must leave with them */
      const ks = await caches.keys();
      await Promise.all(ks.filter((k) => k.startsWith('bswl-student')).map((k) => caches.delete(k)));
    } catch {}
    window.location.replace('/student/login');
  };

  return (
    <div className="stack">
      {cov ? (
        <section className="pstat">
          <div className="row">
            <div className="b">
              <div className="n">
                {Math.round((shown / cov) * 100)}
                <i>%</i>
              </div>
              <div className="k">of the {cov} topics covered so far, shown in a check</div>
            </div>
            <div className="b">
              <div className="n">
                {att}
                <i>%</i>
              </div>
              <div className="k">classes attended</div>
            </div>
          </div>
          <div className="track">
            <i style={{ width: Math.round((shown / cov) * 100) + '%' }} />
          </div>
          <p className="k" style={{ marginTop: 'var(--s2)' }}>
            {cov - shown} still to check
          </p>
        </section>
      ) : (
        <div className="card">
          <h2>Nothing checked yet</h2>
          <p className="lede" style={{ marginTop: 'var(--s2)' }}>
            This fills in as Leon covers topics in class and you show them in a check.
          </p>
        </div>
      )}

      <div className="list">
        <Row
          bold
          t="Attendance"
          w="Marked in class by Leon"
          right={
            <span className="num" style={{ fontWeight: 650 }}>
              {att}%
            </span>
          }
        />
        <MarksRow m={m} />
        <Row
          bold
          t="Best paper score"
          w={m.papers.length + ' attempts logged'}
          right={
            <span className="num" style={{ fontWeight: 650 }}>
              {best ? best + '%' : '-'}
            </span>
          }
        />
      </div>

      {m.config.features.rewards && (
        <>
          <div className="sect-h">
            <h2>Next reward</h2>
          </div>
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--s2)' }}>
              <h3 style={{ flex: 1 }}>{nextR.t}</h3>
              {nextR.pending && <span className="pill">Pending confirmation</span>}
            </div>
            <p className="lede" style={{ marginTop: 'var(--s2)' }}>
              {nextR.sub}
            </p>
            <div className="track" style={{ marginTop: 'var(--s4)' }}>
              <i style={{ width: Math.min(100, Math.round((nextR.have / nextR.need) * 100)) + '%' }} />
            </div>
            <p className="meta" style={{ marginTop: 'var(--s2)' }}>
              {nextR.pct ? `${nextR.have}% of ${nextR.need}%` : `${nextR.have} of ${nextR.need} ${nextR.unit}`}
            </p>
            <button className="btn btn-secondary btn-sm" style={{ marginTop: 'var(--s4)', width: '100%' }} onClick={() => c.openSheet(<RewardsSheet />)}>
              All rewards
            </button>
          </div>
        </>
      )}

      <div className="sect-h">
        <h2>Road to an A</h2>
        <span className="meta num">{doneN} of 14</span>
      </div>
      <div className="card">
        <div className="mile done">
          <span className="mn">
            <Ic.check size={13} />
          </span>
          <span>
            <span style={{ display: 'block', fontWeight: 550 }}>{cur ? cur[0] : 'Getting started'}</span>
            <span className="meta">Done</span>
          </span>
        </div>
        {nxt && (
          <div className="mile">
            <span className="mn num">{doneN + 1}</span>
            <span>
              <span style={{ display: 'block', fontWeight: 550 }}>{nxt[0]}</span>
              <span className="meta">Next up</span>
            </span>
          </div>
        )}
        <button className="btn btn-secondary btn-sm" style={{ marginTop: 'var(--s3)', width: '100%' }} onClick={() => c.openSheet(<RoadSheet />)}>
          See all 14
        </button>
      </div>

      {m.config.features.competition && (
        <>
          <div className="sect-h">
            <h2>This term’s race</h2>
          </div>
          <div className="card">
            <div className="lede" style={{ marginBottom: 'var(--s3)' }}>
              Location against location on turnout, and the honours list for attendance. Marked in class, so it cannot be gamed, and nobody is ever ranked from the bottom.
            </div>
            {m.race.length ? (
              m.race.map((r) => (
                <div className="row race-row" key={r.loc}>
                  <span style={{ width: 86, flex: 'none', fontSize: 13, fontWeight: 600 }}>{r.loc}</span>
                  <div className="track grow">
                    <i style={{ width: r.pct + '%' }} />
                  </div>
                  <span className="meta num" style={{ flex: 'none', width: 36, textAlign: 'right' }}>
                    {r.pct}%
                  </span>
                </div>
              ))
            ) : (
              <p className="meta">The race starts once the first class of the term has been marked.</p>
            )}
            <div style={{ borderTop: '1px solid var(--line)', marginTop: 'var(--s3)', paddingTop: 'var(--s3)' }}>
              <div className="meta" style={{ marginBottom: 'var(--s2)' }}>
                Honours · perfect and near-perfect attendance
              </div>
              {m.honours.length ? (
                m.honours.map((h) => (
                  <span className="pill" style={{ margin: '0 6px 6px 0' }} key={h.name}>
                    {h.name} · {h.att}%
                  </span>
                ))
              ) : (
                <p className="meta">Nobody is on the list yet. It fills as the term is marked.</p>
              )}
            </div>
          </div>
        </>
      )}

      <div className="sect-h">
        <h2>Make it yours</h2>
      </div>
      <article className="card">
        <p className="lede" style={{ marginBottom: 'var(--s3)' }}>
          Pick a colour. It is yours, on this phone, and you can change it any time.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 'var(--s3)' }}>
          {THEMES.map((t) => (
            <button key={t.k} className="sw" aria-pressed={theme === t.k} aria-label={t.n} title={t.n} onClick={() => setTheme(t.k)} style={{ background: t.a }}>
              <i style={{ background: t.b }} />
            </button>
          ))}
        </div>
        <p className="lede" style={{ margin: 'var(--s3) 0 var(--s2)' }}>
          And how bright.
        </p>
        <div className="seg" role="tablist" aria-label="Appearance">
          {[
            ['', 'Auto'],
            ['light', 'Light'],
            ['dark', 'Dark'],
          ].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)}>
              {l}
            </button>
          ))}
        </div>
        <p className="meta" style={{ marginTop: 'var(--s2)' }}>
          Auto follows your phone.
        </p>
      </article>
      <article className="card">
        <div className="tt" style={{ fontWeight: 600 }}>
          How this app works
        </div>
        <div className="tw">A minute, five cards, and how to put it on your home screen.</div>
        <button className="btn btn-secondary" style={{ marginTop: 'var(--s3)', width: '100%' }} onClick={() => c.setWtOpen(true)}>
          Show me again
        </button>
      </article>
      <article className="card">
        <div className="tt" style={{ fontWeight: 600 }}>
          Reminders
        </div>
        <div className="tw">{PUSH_LINE[ps]}</div>
        <button className="btn btn-secondary" style={{ marginTop: 'var(--s3)', width: '100%' }} onClick={() => c.openSheet(<PushSheet />)}>
          {ps === 'on' ? 'Manage reminders' : 'Set up reminders'}
        </button>
      </article>

      <div className="sect-h">
        <h2>From Leon</h2>
      </div>
      <div className="list">
        <GuideRows />
      </div>

      <div className="sect-h">
        <h2>You</h2>
      </div>
      <div className="list">
        <Row bold t={m.me.name} w={`${m.me.batch} batch · ${m.me.locLabel} · ${m.me.program}`} />
        <Row t="Leon’s read" w="Set in class, not by this app" right={<span style={{ fontSize: 'var(--t-sm)' }}>{m.me.level === 'good' ? 'Strong' : m.me.level === 'bad' ? 'Needs work' : 'Okay'}</span>} />
        {m.config.features.batchStats && <Row t="Your batch" w={`How the ${m.me.batch} group is going`} onClick={() => c.openSheet(<BatchSheet />)} />}
        <Row t="Sign out" w={m.me.name} onClick={signOut} />
      </div>
      <div style={{ height: 'var(--s5)' }} />
    </div>
  );
}
