'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, post } from '@/lib/client/api';
import { useApp } from './ctx';
import { Ic } from './icons';
import { useOverlay } from './overlay';
import { ConfirmSheet } from './ui';
import { mmss } from './model';

/* ══ THE MCQ PAPER ════════════════════════════════════════════════════════
   A whole paper against a clock, sat alone, once.

   THE CLOCK IS THE SERVER'S. start() stamps startedAt on the server and
   sends its own "now" with it; the countdown here is a reading of that
   stamp corrected for this phone's clock error, so closing the app does not
   pause it and a wrong phone clock cannot stretch it. At zero the paper goes
   in as it is.

   THE ANSWERS ARE NOT HERE. Questions arrive without the key; marking
   happens on submit, and only its reply carries the right answers.

   Two modes: typed questions one per screen with a palette, or a PDF paper
   (from the library, through a ticket) beside an in-app bubble sheet. */

type Q = { id: number; text: string; imageId: number | null; opts: string[]; optImages: (number | null)[]; marks: number };
type Start = {
  paperId: number;
  title: string;
  kind: string;
  mode: string;
  documentId: number | null;
  minutes: number;
  instructions: string | null;
  startedAt: string;
  serverNow: string;
  answers: Record<string, number>;
  questions: Q[];
};
type Review = {
  title?: string;
  correct: number;
  total: number;
  marks: number;
  maxMarks: number;
  seconds: number;
  late: boolean;
  minutes: number;
  mode: string;
  documentId: number | null;
  review: { id: number; q: string; imageId: number | null; opts: string[]; optImages: (number | null)[]; answer: number; picked: number | null; ok: boolean; why: string | null; marks: number }[];
};

const L = (i: number) => String.fromCharCode(65 + i);

/** An option's words, its picture, or both (staff may set a picture-only option). */
function OptBody({ text, img }: { text: string; img: number | null | undefined }) {
  return (
    <>
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="opt-img" src={`/api/media/${img}`} alt="" loading="lazy" />
      ) : null}
      {text}
    </>
  );
}

/** Seconds left on the server's clock: its start stamp, corrected for this phone's clock error. */
function secondsLeft(s: Start | null, skew: number) {
  if (!s) return 0;
  const began = new Date(s.startedAt).getTime();
  if (isNaN(began)) return s.minutes * 60;
  return Math.max(0, Math.round(s.minutes * 60 - (Date.now() + skew - began) / 1000));
}

export function McqRun() {
  const c = useApp();
  const runId = c.mcqRun;
  const open = runId != null;
  const ref = useRef<HTMLDivElement>(null);
  const [st, setSt] = useState<Start | null>(null);
  const [rv, setRv] = useState<Review | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [i, setI] = useState(0);
  const [flags, setFlags] = useState<Record<number, boolean>>({});
  const [palette, setPalette] = useState(false);
  const [sending, setSending] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [, tick] = useState(0);
  const [skew, setSkew] = useState(0);
  const skewRef = useRef(0);
  const dirty = useRef(false);
  const ansRef = useRef(answers);
  const stRef = useRef(st);
  const rvRef = useRef(rv);
  useEffect(() => {
    ansRef.current = answers;
    stRef.current = st;
    rvRef.current = rv;
    skewRef.current = skew;
  });
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* ONE SUBMIT AT A TIME: a tap on Submit just before zero, then the clock
     reaching zero while it is in flight, must not send the paper twice; the
     second reply ("Already submitted") would close the review the first opened */
  const inFlight = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setSt(null);
    setRv(null);
    setAnswers({});
    setI(0);
    setFlags({});
    setPalette(false);
    setPdfUrl(null);
    dirty.current = false;
    c.setMcqRun(null);
    c.reloadMcq();
  }, [c]);

  const save = useCallback(async (keepalive = false) => {
    const s = stRef.current;
    if (!s || !dirty.current || rvRef.current) return;
    dirty.current = false;
    try {
      if (keepalive)
        await fetch(`/api/student/mcq/${s.paperId}/save`, {
          method: 'POST',
          keepalive: true,
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers: ansRef.current }),
        });
      else await post(`/api/student/mcq/${s.paperId}/save`, { answers: ansRef.current });
    } catch {
      dirty.current = true; // try again on the next tick
    }
  }, []);

  const left = useCallback(() => secondsLeft(stRef.current, skewRef.current), []);

  const submit = useCallback(
    async (auto: boolean) => {
      const s = stRef.current;
      if (!s || rvRef.current || inFlight.current) return;
      inFlight.current = true;
      setSending(true);
      if (debounce.current) clearTimeout(debounce.current);
      try {
        const r = await post<Review>(`/api/student/mcq/${s.paperId}/submit`, { answers: ansRef.current });
        dirty.current = false;
        const done = { ...r, title: s.title };
        rvRef.current = done; // before the next clock tick, not after the next render
        setRv(done);
        setPalette(false);
        if (auto) c.say('Time is up. The paper went in as it was.');
        c.reloadMcq();
        bodyRef.current?.scrollTo(0, 0);
      } catch (e) {
        c.showToast(e instanceof Error ? e.message : 'Could not send the paper');
        /* it may already be in, from the tab that timed out first */
        if (e instanceof ApiError && e.code === 'done') close();
      } finally {
        inFlight.current = false;
        setSending(false);
      }
    },
    [c, close],
  );

  const away = useCallback(() => {
    if (!rvRef.current && stRef.current) save(true);
    close();
  }, [save, close]);
  useOverlay(open, away, () => ref.current);

  /* open: start (or re-open) the attempt, or load the review of a finished one */
  useEffect(() => {
    if (runId == null) return;
    let dead = false;
    (async () => {
      try {
        if (runId < 0) {
          const r = await api<Review>(`/api/student/mcq/${-runId}/review`);
          if (dead) return;
          const p = (c.mcq || []).find((x) => x.id === -runId);
          setRv({ ...r, title: r.title || p?.title });
          return;
        }
        const s = await post<Start>(`/api/student/mcq/${runId}/start`);
        if (dead) return;
        if (!s.questions?.length) {
          c.showToast('That paper has no questions yet');
          return c.setMcqRun(null);
        }
        const sk = new Date(s.serverNow).getTime() - Date.now();
        skewRef.current = sk;
        stRef.current = s;
        setSkew(sk);
        setAnswers(s.answers || {});
        setSt(s);
        if (s.mode === 'pdf' && s.documentId) {
          post<{ url: string }>(`/api/student/library/${s.documentId}/ticket`)
            .then((t) => !dead && setPdfUrl(t.url))
            .catch(() => !dead && setPdfUrl(''));
        }
      } catch (e) {
        c.showToast(e instanceof Error ? e.message : 'Could not reach the paper');
        c.setMcqRun(null);
      }
    })();
    return () => {
      dead = true;
    };
    // load once per paper
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  /* the clock (1 s) and the autosave (10 s); a sleeping phone saves on the way out */
  useEffect(() => {
    if (!st || rv) return;
    const t = setInterval(() => {
      tick((n) => n + 1);
      if (left() <= 0) {
        clearInterval(t);
        submit(true);
      }
    }, 1000);
    const s = setInterval(() => save(), 10000);
    const vis = () => document.hidden && save(true);
    const hide = () => save(true);
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('pagehide', hide);
    return () => {
      clearInterval(t);
      clearInterval(s);
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('pagehide', hide);
    };
  }, [st, rv, left, save, submit]);

  if (!open) return <div className="mq" />;

  const pick = (q: Q, j: number) => {
    setAnswers((a) => {
      const n = { ...a };
      /* tapping the same option again clears it: a blank is a real choice */
      if (n[String(q.id)] === j) delete n[String(q.id)];
      else n[String(q.id)] = j;
      return n;
    });
    dirty.current = true;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => save(), 1200);
  };
  const confirmSubmit = () => {
    if (!st) return;
    const blank = st.questions.length - st.questions.filter((x) => answers[String(x.id)] != null).length;
    if (!blank) return submit(false);
    c.openSheet(
      <ConfirmSheet
        title="Submit anyway?"
        body={`${blank} question${blank === 1 ? ' is' : 's are'} still blank.`}
        yes="Submit anyway"
        no="Keep answering"
        onYes={() => submit(false)}
      />,
    );
  };
  /* both layers (this sheet and the paper) close in the same tick, which the
     overlay stack settles as one step back through the history */
  const leave = () => {
    if (rv || !st) return history.back();
    c.openSheet(
      <ConfirmSheet title="Leave the paper?" body="The clock keeps running while you are away." yes="Leave" no="Stay" onYes={away} />,
    );
  };

  const s = secondsLeft(st, skew);
  const total = st ? st.minutes * 60 : 1;
  let body: React.ReactNode = null;
  let foot: React.ReactNode = null;

  if (rv) {
    const pct = rv.maxMarks ? Math.round((rv.marks / rv.maxMarks) * 100) : 0;
    body = (
      <>
        <div className="mq-score">
          <div className="big">
            {rv.marks}
            <span>/{rv.maxMarks}</span>
          </div>
          <div className="sub">
            {rv.correct} of {rv.total} right · {pct}% · {mmss(rv.seconds)}
            {rv.late ? ` · over the ${rv.minutes} minutes` : ''}
          </div>
        </div>
        <div className="sect-h">
          <h2>Every question</h2>
        </div>
        {rv.review.map((q, k) => {
          const mine = q.picked == null ? null : <OptBody text={q.opts[q.picked]} img={q.optImages?.[q.picked]} />;
          return (
            <div className="mq-rv" key={q.id}>
              <div className="h">
                <span className="n">{k + 1}</span>
                <span className="mk">
                  {q.ok ? (
                    <>
                      <Ic.check /> right
                    </>
                  ) : q.picked == null ? (
                    'not answered'
                  ) : (
                    <>
                      <Ic.cross /> wrong
                    </>
                  )}
                </span>
              </div>
              {q.q && <div className="qt">{q.q}</div>}
              {q.imageId && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="mq-img" src={`/api/media/${q.imageId}`} alt="" loading="lazy" />
              )}
              <div className="ans">
                <b>Answer</b> {rv.mode === 'pdf' ? L(q.answer) : <OptBody text={q.opts[q.answer] || ''} img={q.optImages?.[q.answer]} />}
              </div>
              {!q.ok && (
                <div className="ans">
                  <b>You put</b> {mine == null ? 'nothing' : rv.mode === 'pdf' ? L(q.picked!) : mine}
                </div>
              )}
              {q.why && <div className="why">{q.why}</div>}
            </div>
          );
        })}
      </>
    );
    foot = (
      <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => history.back()}>
        Done
      </button>
    );
  } else if (st && st.mode === 'pdf') {
    const answered = st.questions.filter((x) => answers[String(x.id)] != null).length;
    body = (
      <div className="mq-pdfwrap">
        <div className="mq-pdf">
          {pdfUrl ? (
            <iframe src={pdfUrl} title={st.title} />
          ) : (
            <div className="banner">{pdfUrl === '' ? 'The paper could not be opened here.' : 'Opening the paper…'}</div>
          )}
          {st.documentId && (
            <button className="btn btn-secondary btn-sm" style={{ width: '100%', marginTop: 'var(--s2)' }} onClick={() => c.openDoc(st.documentId!)}>
              Open the paper in a new tab
            </button>
          )}
        </div>
        <div className="mq-sheet" role="group" aria-label="Answer sheet">
          <p className="meta" style={{ marginBottom: 'var(--s2)' }}>
            Answer sheet · tap a letter, tap it again to clear
          </p>
          {st.questions.map((q, k) => (
            <div className="mq-bub" key={q.id}>
              <span className="qn num">{k + 1}</span>
              {q.opts.map((_, j) => (
                <button
                  key={j}
                  className={answers[String(q.id)] === j ? 'on' : ''}
                  aria-pressed={answers[String(q.id)] === j}
                  aria-label={`Question ${k + 1}, ${L(j)}`}
                  onClick={() => pick(q, j)}
                >
                  {L(j)}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
    foot = sending ? (
      <button className="btn btn-primary" style={{ flex: 1 }} disabled>
        Marking…
      </button>
    ) : (
      <>
        <button className="btn" disabled>
          {answered}/{st.questions.length}
        </button>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={confirmSubmit}>
          Submit
        </button>
      </>
    );
  } else if (st) {
    const qs = st.questions;
    const q = qs[i];
    const picked = answers[String(q.id)];
    const answered = qs.filter((x) => answers[String(x.id)] != null).length;
    if (palette) {
      body = (
        <>
          <div className="mq-pal">
            {qs.map((x, k) => (
              <button
                key={x.id}
                className={`${answers[String(x.id)] != null ? 'done ' : ''}${flags[x.id] ? 'flag ' : ''}${k === i ? 'now' : ''}`}
                onClick={() => {
                  setI(k);
                  setPalette(false);
                  bodyRef.current?.scrollTo(0, 0);
                }}
              >
                {k + 1}
              </button>
            ))}
          </div>
          <div className="mq-key">
            <span>
              <i className="done" />
              answered
            </span>
            <span>
              <i className="flag" />
              flagged
            </span>
            <span>
              <i />
              blank
            </span>
          </div>
        </>
      );
      foot = (
        <>
          <button className="btn" style={{ flex: 1 }} onClick={() => setPalette(false)}>
            Back to the paper
          </button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={confirmSubmit} disabled={sending}>
            Submit
          </button>
        </>
      );
    } else {
      body = (
        <>
          <div className="mq-meta">
            <span>
              Question {i + 1} of {qs.length}
            </span>
            <span>
              {q.marks} mark{q.marks === 1 ? '' : 's'}
            </span>
            <button className={`mq-flagbtn${flags[q.id] ? ' on' : ''}`} onClick={() => setFlags((f) => ({ ...f, [q.id]: !f[q.id] }))}>
              {flags[q.id] ? 'Flagged' : 'Flag'}
            </button>
          </div>
          {q.text && <div className="mq-q">{q.text}</div>}
          {q.imageId && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="mq-img" src={`/api/media/${q.imageId}`} alt="Picture for this question" loading="lazy" />
          )}
          <div className="mq-opts">
            {q.opts.map((o, j) => (
              <button key={j} className={`mq-opt${picked === j ? ' picked' : ''}`} onClick={() => pick(q, j)}>
                <span className="lt">{L(j)}</span>
                <span className="ot">
                  <OptBody text={o} img={q.optImages?.[j]} />
                </span>
              </button>
            ))}
          </div>
        </>
      );
      const step = (d: number) => {
        const n = i + d;
        if (n < 0 || n >= qs.length) return;
        setI(n);
        bodyRef.current?.scrollTo(0, 0);
      };
      foot = sending ? (
        <button className="btn btn-primary" style={{ flex: 1 }} disabled>
          Marking…
        </button>
      ) : (
        <>
          <button className="btn" onClick={() => step(-1)} disabled={i === 0}>
            Back
          </button>
          <button className="btn" onClick={() => setPalette(true)}>
            {answered}/{qs.length}
          </button>
          {i === qs.length - 1 ? (
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={confirmSubmit}>
              Submit
            </button>
          ) : (
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => step(1)}>
              Next
            </button>
          )}
        </>
      );
    }
  } else body = <div className="skel" style={{ height: 160, marginTop: 'var(--s4)' }} />;

  return (
    <div className="mq on" ref={ref} role="dialog" aria-modal="true" aria-label="MCQ paper">
      <div className="mq-top">
        <span className="m">{rv ? rv.title || 'Result' : st?.title || ''}</span>
        {!rv && st && (
          <span className={`mq-clock${s <= 60 ? ' urgent' : ''}`} aria-live="off">
            {mmss(s)}
          </span>
        )}
        <button className="qg-x" onClick={leave}>
          {rv ? 'Close' : 'Leave'}
        </button>
      </div>
      <div className="mq-bar">
        <i style={{ width: rv ? '100%' : Math.round((s / total) * 100) + '%' }} />
      </div>
      <div className="mq-body" ref={bodyRef}>
        {body}
      </div>
      <div className="mq-foot">{foot}</div>
    </div>
  );
}
