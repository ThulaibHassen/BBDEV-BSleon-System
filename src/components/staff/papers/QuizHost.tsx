'use client';

/* The class screen for a live quiz: full screen, read from the back row.
   The server holds the state (lobby → question → reveal → … → ended); this
   screen polls it every 2 s and also listens on SSE for an instant nudge.
   No full ranking is ever shown to the class: only the top 3 and the podium. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, post } from '@/lib/client/api';
import { useToast, Ok } from '@/components/staff/ui';
import { useDialog } from '@/components/staff/Dialog';
import { Avatar, letter } from './common';

type St = {
  gameId: number;
  pin: string;
  title: string;
  state: 'lobby' | 'question' | 'reveal' | 'ended';
  qIndex: number;
  total: number;
  startedAt: string | null;
  serverNow: string;
  question: { id: number; q: string; imageId: number | null; opts: string[]; optImages: (number | null)[]; seconds: number; pointsX: number; answer: number | null; why: string | null } | null;
  answered: number;
  players: number;
  top: { nickname: string; avatar: string; score: number }[];
};
/* a question or option may carry a picture (an option may be a picture alone) */
function QBody({ q }: { q: { q: string; imageId: number | null } }) {
  return (
    <>
      {q.q && <div className="qh-q">{q.q}</div>}
      {q.imageId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="qh-img" src={`/api/media/${q.imageId}`} alt="" loading="lazy" />
      ) : null}
    </>
  );
}
function OptBody({ text, img }: { text: string; img: number | null | undefined }) {
  return (
    <span className="qh-ot">
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/media/${img}`} alt="" loading="lazy" />
      ) : null}
      {text}
    </span>
  );
}

type Results = {
  players: { student_id: number; nickname: string; score: number; correct: number; answered: number }[];
  questions: { ord: number; q: string; got_it: number; tried: number }[];
};

export function QuizHost({ gameId }: { gameId: number }) {
  const router = useRouter();
  const { toast, toastError } = useToast();
  const ask = useDialog();
  const [st, setSt] = useState<St | null>(null);
  const [players, setPlayers] = useState<{ nickname: string; avatar: string }[]>([]);
  const [lost, setLost] = useState<string | null>(null);
  const [res, setRes] = useState<Results | null>(null);
  const [, setTick] = useState(0);
  const fails = useRef(0);
  const revealing = useRef(false);
  const [skew, setSkew] = useState(0); // server clock minus ours, so the countdown matches the phones
  const base = `/api/staff/quiz/games/${gameId}`;

  const apply = useCallback((s: St) => {
    setSkew(new Date(s.serverNow).getTime() - Date.now());
    setSt(s);
  }, []);

  const act = useCallback(
    async (action: 'next' | 'reveal' | 'end', at?: number) => {
      if (action === 'reveal') {
        if (revealing.current) return;
        revealing.current = true;
      }
      try {
        // `at`: the question this screen shows, so a stale or repeated click changes nothing
        apply(await post<St>(base, { action, at }));
      } catch (e) {
        toastError(e);
      } finally {
        if (action === 'reveal') revealing.current = false;
      }
    },
    [apply, base, toastError],
  );

  const refresh = useCallback(async () => {
    try {
      const s = await api<St>(base);
      fails.current = 0;
      setLost(null);
      apply(s);
      if (s.state === 'lobby') setPlayers(await api(`${base}/players`));
      // everyone has answered: no point watching an empty timer
      if (s.state === 'question' && s.players && s.answered >= s.players) void act('reveal', s.qIndex);
    } catch (e) {
      // SAY SO: a silent failure looks like a game nobody is joining
      fails.current++;
      if (fails.current === 3 || fails.current % 15 === 0) setLost((e as Error).message);
    }
  }, [base, apply, act]);

  const ended = st?.state === 'ended';

  // poll every 2 s until the game ends, and listen for nudges
  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    if (ended) return () => clearTimeout(first);
    const poll = setInterval(refresh, 2000);
    const es = new EventSource(`/api/quiz/${gameId}/events`);
    es.onmessage = () => void refresh();
    return () => {
      clearTimeout(first);
      clearInterval(poll);
      es.close();
    };
  }, [refresh, gameId, ended]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const left = () => {
    if (!st?.question || !st.startedAt) return 0;
    const end = new Date(st.startedAt).getTime() + st.question.seconds * 1000;
    return Math.max(0, Math.ceil((end - (Date.now() + skew)) / 1000));
  };

  // 1 s countdown tick; auto-reveal when the time is up
  useEffect(() => {
    if (st?.state !== 'question') return;
    const t = setInterval(() => {
      setTick((n) => n + 1);
      if (left() <= 0) {
        clearInterval(t);
        void act('reveal', st.qIndex);
      }
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st?.state, st?.qIndex, st?.startedAt]);

  const quit = async () => {
    if (st && st.state !== 'ended') {
      if (!(await ask.confirm({ title: 'End the game now?', body: 'Scores are kept.', okLabel: 'End game', danger: true }))) return;
      try {
        await post(base, { action: 'end' });
        toast(<Ok>Game ended — scores kept</Ok>);
      } catch (e) {
        toastError(e);
      }
    }
    router.push('/staff/quizzes?tab=live');
  };

  const results = async () => {
    try {
      setRes(await api<Results>(`${base}/results`));
    } catch (e) {
      toastError(e);
    }
  };

  const chips = (top: St['top']) =>
    top.length ? (
      <div className="qh-row">
        {top.map((t, i) => (
          <span className="qh-chip" key={i}>
            <Avatar k={t.avatar} /> {i + 1}. {t.nickname} · {t.score}
          </span>
        ))}
      </div>
    ) : null;

  let mid: React.ReactNode = null;
  let foot: React.ReactNode = null;

  if (!st) {
    mid = <div className="qh-lead">Opening the game…</div>;
  } else if (res) {
    mid = (
      <>
        <div className="qh-q" style={{ fontSize: 28 }}>
          Full results
        </div>
        <div className="qh-lead" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          <div>
            <b>Everyone</b>
            {res.players.map((p, i) => (
              <div key={p.student_id}>
                {i + 1}. {p.nickname} — {p.score} ({p.correct}/{p.answered})
              </div>
            ))}
          </div>
          <div>
            <b>Question by question</b>
            {res.questions.map((q) => (
              <div key={q.ord}>
                {q.ord}. {q.q.slice(0, 60) || 'Picture question'} — {q.got_it}/{q.tried} right
              </div>
            ))}
          </div>
        </div>
      </>
    );
    foot = (
      <>
        <button className="qh-btn ghost" onClick={quit}>
          Close
        </button>
        <span className="qh-lead" style={{ fontSize: 14 }}>
          This page is for you, not the class screen.
        </span>
      </>
    );
  } else if (st.state === 'lobby') {
    mid = (
      <>
        <div>
          <div className="qh-lead">
            Open the student app, tap <b>Join a quiz</b>, and enter
          </div>
          <div className="qh-pin">{st.pin}</div>
        </div>
        <div className="qh-row">
          <span className="qh-count">{st.players || 0}</span>
          <span>joined · {st.total} questions</span>
        </div>
        <div className="qh-players">
          {players.map((p, i) => (
            <span className="qh-chip" key={i}>
              <Avatar k={p.avatar} /> {p.nickname}
            </span>
          ))}
        </div>
      </>
    );
    foot = (
      <>
        <button className="qh-btn" onClick={() => act('next', st.qIndex)}>
          Start the game
        </button>
        <span className="qh-lead" style={{ fontSize: 14 }}>
          Nobody sees a question until you press start.
        </span>
      </>
    );
  } else if (st.state === 'question' && st.question) {
    const q = st.question;
    const l = left();
    mid = (
      <>
        <div className="qh-row">
          <span>
            Question {st.qIndex + 1} of {st.total}
          </span>
          {q.pointsX > 1 && <span className="qh-chip">Double points</span>}
          <span className="sp" style={{ flex: 1 }} />
          <span className="qh-count">{l}</span>
        </div>
        <div className="qh-bar">
          <i style={{ width: `${Math.round((l / q.seconds) * 100)}%` }} />
        </div>
        <QBody q={q} />
        <div className="qh-opts">
          {q.opts.map((o, i) => (
            <div className="qh-opt" key={i}>
              <span className="lt">{letter(i)}</span>
              <OptBody text={o} img={q.optImages?.[i]} />
            </div>
          ))}
        </div>
        <div className="qh-row">
          <span className="qh-count">{st.answered || 0}</span>
          <span>of {st.players || 0} answered</span>
        </div>
      </>
    );
    foot = (
      <button className="qh-btn ghost" onClick={() => act('reveal', st.qIndex)}>
        Show the answer
      </button>
    );
  } else if (st.state === 'reveal' && st.question) {
    const q = st.question;
    mid = (
      <>
        <div className="qh-row">
          <span>
            Question {st.qIndex + 1} of {st.total}
          </span>
          <span className="sp" style={{ flex: 1 }} />
          <span>
            {st.answered || 0} of {st.players || 0} answered
          </span>
        </div>
        <QBody q={q} />
        <div className="qh-opts">
          {q.opts.map((o, i) => (
            <div className={`qh-opt${i === q.answer ? ' right' : ' dim'}`} key={i}>
              <span className="lt">{letter(i)}</span>
              <OptBody text={o} img={q.optImages?.[i]} />
            </div>
          ))}
        </div>
        {q.why && <div className="qh-lead">{q.why}</div>}
        {chips(st.top.slice(0, 3))}
      </>
    );
    foot = (
      <button className="qh-btn" onClick={() => act('next', st.qIndex)}>
        {st.qIndex + 1 >= st.total ? 'Finish' : 'Next question'}
      </button>
    );
  } else {
    const top = st.top;
    mid = (
      <>
        <div className="qh-q">That is the game</div>
        <div className="qh-pod">
          {[1, 0, 2].map((idx) => {
            const t = top[idx];
            if (!t) return <div key={idx} />;
            return (
              <div className={`p${idx === 0 ? ' first' : ''}`} key={idx}>
                <Avatar k={t.avatar} />
                <div className="n">{t.nickname}</div>
                <div className="s">{t.score}</div>
                <div style={{ opacity: 0.7, fontSize: 13 }}>{idx === 0 ? '1st' : idx === 1 ? '2nd' : '3rd'}</div>
              </div>
            );
          })}
        </div>
        <div className="qh-lead">Scores are saved. Nobody is shown who came last.</div>
      </>
    );
    foot = (
      <>
        <button className="qh-btn" onClick={results}>
          Full results, for you
        </button>
        <button className="qh-btn ghost" onClick={quit}>
          Close
        </button>
      </>
    );
  }

  if (lost && !ended) {
    foot = (
      <>
        <span className="qh-lead" style={{ fontSize: 15 }}>
          Lost touch with the server ({lost}). Still trying…
        </span>
        <button className="qh-btn ghost" onClick={() => void refresh()}>
          Try now
        </button>
        <button className="qh-btn ghost" onClick={quit}>
          End game
        </button>
      </>
    );
  }

  return (
    <div className="qh-wrap on" role="dialog" aria-modal="true" aria-label="Quiz host">
      <div className="qh-top">
        <div className="t">{st?.title ?? ''}</div>
        <button className="qh-x" onClick={quit}>
          End game
        </button>
      </div>
      <div className="qh-mid">{mid}</div>
      <div className="qh-foot">{foot}</div>
    </div>
  );
}
