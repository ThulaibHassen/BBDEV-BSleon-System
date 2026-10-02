'use client';

import { useState } from 'react';
import { useApp } from './ctx';
import { KV, Row } from './ui';
import { examDateOf, fmtFull, unitName } from './model';
import { daysBetween, todayISO } from '@/lib/shared/dates';

/* The text pages Leon fills in from the staff app (app config):
   #3 class times and the exam date, #8 glossary, #11 the new-student guide,
   #12 what to expect this month and this year. Plain words, no styling of
   their own, so they read like the rest of the app. */

export function ClassTimesSheet() {
  const { m } = useApp();
  if (!m) return null;
  const ex = examDateOf(m);
  const d = daysBetween(todayISO(), ex);
  return (
    <>
      <h3 id="sheetTitle">Class times and the exam</h3>
      <p className="lede">{m.me.locLabel}</p>
      <div className="list" style={{ marginTop: 'var(--s4)' }}>
        {m.config.classes.length ? (
          m.config.classes.map((c, i) => <KV key={i} k={c.day} v={[c.time, c.note].filter(Boolean).join(' · ') || 'Class'} />)
        ) : (
          <KV k="Classes" v="Leon has not set the times yet" />
        )}
      </div>
      <div className="list" style={{ marginTop: 'var(--s4)' }}>
        <KV k="A/L Business Studies" v={fmtFull(ex)} />
        <KV k="Days to go" v={d > 0 ? String(d) : 'Exam time'} />
      </div>
    </>
  );
}

export function GuideSheet() {
  const { m } = useApp();
  return (
    <>
      <h3 id="sheetTitle">New student guide</h3>
      <p className="lede">From Leon, for your first weeks.</p>
      <p className="lede" style={{ marginTop: 'var(--s4)', whiteSpace: 'pre-line', color: 'var(--text)', fontSize: 'var(--t-base)', lineHeight: 'var(--lh)' }}>
        {m?.config.pages.guide}
      </p>
    </>
  );
}

export function ExpectSheet() {
  const { m } = useApp();
  const e = m?.config.pages.expect;
  return (
    <>
      <h3 id="sheetTitle">What to expect</h3>
      <p className="lede">What the class is working towards.</p>
      {e?.month && (
        <>
          <div className="sect-h">
            <h2>This month</h2>
          </div>
          <p style={{ whiteSpace: 'pre-line', lineHeight: 'var(--lh)' }}>{e.month}</p>
        </>
      )}
      {e?.year && (
        <>
          <div className="sect-h">
            <h2>This year</h2>
          </div>
          <p style={{ whiteSpace: 'pre-line', lineHeight: 'var(--lh)' }}>{e.year}</p>
        </>
      )}
    </>
  );
}

export function GlossarySheet() {
  const { m } = useApp();
  const [q, setQ] = useState('');
  const all = m?.config.pages.glossary ?? [];
  const s = q.trim().toLowerCase();
  const list = all
    .filter((g) => !s || g.term.toLowerCase().includes(s) || g.def.toLowerCase().includes(s))
    .sort((a, b) => a.term.localeCompare(b.term));
  return (
    <>
      <h3 id="sheetTitle">Glossary</h3>
      <p className="lede">The exact words the marking scheme rewards.</p>
      <input style={{ marginTop: 'var(--s4)' }} placeholder="Find a term" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a term" />
      <div style={{ marginTop: 'var(--s3)' }}>
        {list.length ? (
          list.map((g, i) => (
            <div className="keyterm" key={i}>
              <b>{g.term}</b>
              <span>
                {g.def}
                {g.unit ? <span className="meta" style={{ display: 'block', marginTop: 2 }}>{`Unit ${g.unit} · ${unitName(g.unit)}`}</span> : null}
              </span>
            </div>
          ))
        ) : (
          <p className="meta" style={{ marginTop: 'var(--s3)' }}>
            Nothing matches that.
          </p>
        )}
      </div>
    </>
  );
}

/** The rows that open those pages; only the ones Leon has written appear. */
export function GuideRows() {
  const c = useApp();
  const p = c.m?.config.pages;
  return (
    <>
      <Row t="Class times and the exam" w="When and where, and the date it all counts" onClick={() => c.openSheet(<ClassTimesSheet />)} />
      {!!p?.glossary?.length && <Row t="Glossary" w={`${p.glossary.length} terms Leon wants you to use`} onClick={() => c.openSheet(<GlossarySheet />)} />}
      {!!p?.guide?.trim() && <Row t="New student guide" w="How the class works, from Leon" onClick={() => c.openSheet(<GuideSheet />)} />}
      {!!(p?.expect?.month?.trim() || p?.expect?.year?.trim()) && <Row t="What to expect" w="This month and this year" onClick={() => c.openSheet(<ExpectSheet />)} />}
    </>
  );
}
