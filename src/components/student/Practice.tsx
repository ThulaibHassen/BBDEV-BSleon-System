'use client';

import { useEffect } from 'react';
import { useApp } from './ctx';
import { Chev, Empty } from './ui';
import { closingText, mmss, type McqItem } from './model';

/* ══ PRACTICE. Everything you sit rather than read: three tiles across the
   top, and the selected one inverts so the list below always has an owner. ══ */

export function McqBrief({ id }: { id: number }) {
  const c = useApp();
  const p = (c.mcq || []).find((x) => x.id === id);
  if (!p) return null;
  return (
    <>
      <h3 id="sheetTitle">{p.title}</h3>
      <p className="lede">
        {p.questions} question{p.questions === 1 ? '' : 's'} · {p.minutes} minutes
        {p.in_progress ? ' · your clock is already running' : ''}
      </p>
      {p.instructions && (
        <p className="lede" style={{ marginTop: 'var(--s3)', whiteSpace: 'pre-line' }}>
          {p.instructions}
        </p>
      )}
      <ul className="mq-brief">
        <li>The clock starts the moment you tap start, and keeps running if you close the app.</li>
        <li>Your answers save as you go.</li>
        <li>One attempt. Ask Leon if something goes wrong.</li>
        {p.mode === 'pdf' && <li>The paper opens as a PDF. Mark your answers on the sheet underneath it.</li>}
      </ul>
      <button
        className="btn btn-primary"
        style={{ width: '100%' }}
        onClick={() => {
          c.closeSheet();
          c.setMcqRun(id);
        }}
      >
        {p.in_progress ? 'Carry on' : p.kind === 'drill' ? 'Start the drill' : 'Start the paper'}
      </button>
      <button className="btn" style={{ width: '100%', marginTop: 'var(--s2)' }} onClick={c.closeSheet}>
        Not now
      </button>
    </>
  );
}

function EssaySheet({ id }: { id: number }) {
  const c = useApp();
  const t = (c.essays || []).find((x) => x.id === id);
  if (!t) return null;
  return (
    <>
      <h3 id="sheetTitle">{t.title}</h3>
      <p className="lede">
        {t.unit ? `Unit ${t.unit} · ` : ''}
        {t.marks || 15} marks
      </p>
      {t.question && <div className="es-q">{t.question}</div>}
      <ol className="es-parts">
        {(t.parts || []).map((p, i) => (
          <li key={i}>
            <span className="n">{i + 1}</span>
            <span className="h">{p.h || ''}</span>
            <span className="m">{p.m != null ? `${p.m} mark${+p.m === 1 ? '' : 's'}` : ''}</span>
            {p.t && <span className="t">{p.t}</span>}
          </li>
        ))}
      </ol>
      {t.notes && <div className="es-notes">{t.notes}</div>}
      <button className="btn" style={{ width: '100%' }} onClick={c.closeSheet}>
        Close
      </button>
    </>
  );
}

function McqList() {
  const c = useApp();
  const papers = c.mcq;
  if (!papers) return <div className="skel" style={{ height: 120 }} />;
  if (!papers.length) return <Empty t="No papers open" s="When Leon sets a timed MCQ paper or a speed drill it appears here." />;
  const only = c.pracView;
  const mine = papers.filter((p) => (only === 'drill' ? p.kind === 'drill' : p.kind !== 'drill'));
  const todo = mine.filter((p) => !p.finished_at);
  const done = mine.filter((p) => p.finished_at);
  const groups: [McqItem[], string][] = [
    [todo.filter((p) => p.kind === 'drill'), 'Speed drills'],
    [todo.filter((p) => p.kind !== 'drill'), 'Papers to sit'],
  ];
  if (!todo.length && !done.length)
    return only === 'drill' ? (
      <Empty t="No drills open" s="A speed drill is ten minutes against the clock. Leon sets them." />
    ) : (
      <Empty t="No papers open" s="A full paper, timed, one attempt. Leon sets them." />
    );
  return (
    <>
      {groups.map(([list, h]) =>
        list.length ? (
          <div key={h}>
            <div className="sect-h">
              <h2>{h}</h2>
            </div>
            <div className="list">
              {list.map((p) => {
                const closing = p.open_to ? closingText(p.open_to) : '';
                return (
                  <button key={p.id} className="rowbtn" onClick={() => c.openSheet(<McqBrief id={p.id} />)}>
                    <span className="grow">
                      <span className="tt">{p.title}</span>
                      <span className="tw">
                        {p.questions} question{p.questions === 1 ? '' : 's'} · {p.minutes} min
                        {p.in_progress && (
                          <>
                            {' · '}
                            <b>started</b>
                          </>
                        )}
                        {closing ? ' · ' + closing : ''}
                      </span>
                    </span>
                    <Chev />
                  </button>
                );
              })}
            </div>
          </div>
        ) : null,
      )}
      {done.length > 0 && (
        <>
          <div className="sect-h">
            <h2>Done</h2>
          </div>
          <div className="list">
            {done.map((p) => {
              const pct = p.max_marks ? Math.round(((p.marks || 0) / p.max_marks) * 100) : 0;
              return (
                <button key={p.id} className="rowbtn" onClick={() => c.setMcqRun(-p.id)}>
                  <span className="grow">
                    <span className="tt" style={{ fontWeight: 550 }}>
                      {p.title}
                    </span>
                    <span className="tw">
                      {p.marks}/{p.max_marks} marks · {p.correct}/{p.total} right · {mmss(p.seconds || 0)}
                    </span>
                  </span>
                  <span className="num" style={{ fontWeight: 650 }}>
                    {pct}%
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

function Essays() {
  const c = useApp();
  const list = c.essays;
  if (!list) return <div className="skel" style={{ height: 120 }} />;
  if (!list.length) return <Empty t="No essay templates yet" s="When Leon adds a model layout for a 10–15 mark answer it appears here." />;
  return (
    <>
      <p className="lede">How to build a long answer: what goes in each part, in order, and the marks it earns.</p>
      <div className="list">
        {list.map((t) => {
          const n = (t.parts || []).length;
          return (
            <button key={t.id} className="rowbtn" onClick={() => c.openSheet(<EssaySheet id={t.id} />)}>
              <span className="grow">
                <span className="tt">{t.title}</span>
                <span className="tw">
                  {t.unit ? `Unit ${t.unit} · ` : ''}
                  {t.marks || 15} marks · {n} part{n === 1 ? '' : 's'}
                </span>
              </span>
              <Chev />
            </button>
          );
        })}
      </div>
    </>
  );
}

export function Practice() {
  const c = useApp();
  const { wantEssays, reloadMcq } = c;
  useEffect(() => {
    wantEssays();
    reloadMcq();
    // entering Practice loads essays once and refreshes the paper list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const ps = c.mcq || [];
  const openOf = (k: string) => ps.filter((p) => !p.finished_at && (k === 'drill' ? p.kind === 'drill' : p.kind !== 'drill')).length;
  const bestOf = (k: string) => {
    const d = ps.filter((p) => p.finished_at && p.max_marks && (k === 'drill' ? p.kind === 'drill' : p.kind !== 'drill'));
    return d.length ? Math.max(...d.map((p) => Math.round(((p.marks || 0) / (p.max_marks || 1)) * 100))) : null;
  };
  const tile = (v: 'drill' | 'paper' | 'essays', n: number, label: string, sub: string) => (
    <button className="ph" role="tab" aria-selected={c.pracView === v} onClick={() => c.setPracView(v)}>
      <div className="n">{n}</div>
      <div>
        <div className="l">{label}</div>
        <div className="s">{sub}</div>
      </div>
    </button>
  );
  const db = bestOf('drill');
  const pb = bestOf('paper');
  return (
    <>
      <div className="ph-grid" role="tablist" aria-label="Practice sections">
        {tile('drill', openOf('drill'), 'Drills', db != null ? `best ${db}%` : '10 min each')}
        {tile('paper', openOf('paper'), 'Papers', pb != null ? `best ${pb}%` : 'timed, once')}
        {tile('essays', (c.essays || []).length, 'Essays', 'model layouts')}
      </div>
      <div style={{ marginTop: 'var(--s5)' }}>
        <div className="stack">{c.pracView === 'essays' ? <Essays /> : <McqList />}</div>
      </div>
    </>
  );
}
