'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, post } from '@/lib/client/api';
import { useApp } from './ctx';
import { AVATARS, Avatar } from './icons';
import { useOverlay } from './overlay';
import { ordinal } from './model';

/* ══ CLASS QUIZ ═════════════════════════════════════════════════════════
   Leon opens a game on the class screen and calls out a code. A student
   joins, picks a name and a mark, and plays. WHAT THIS FILE DOES NOT KNOW
   is the right answer: it arrives only at reveal, and marking and timing
   happen on the server. The SSE channel only nudges; a 2-second poll is the
   path that is always right, so a weak class connection makes it slower,
   not wrong. */

const QZ_KEY = 'bswl_qz';
type Saved = { id: number; pin: string; title: string; nick?: string; av?: string };
export const readQz = (): Saved | null => {
  try {
    return JSON.parse(localStorage.getItem(QZ_KEY) || 'null');
  } catch {
    return null;
  }
};
const clearQz = () => {
  try {
    localStorage.removeItem(QZ_KEY);
  } catch {}
};

type QState = {
  gameId: number;
  pin: string;
  state: 'lobby' | 'question' | 'reveal' | 'ended';
  qIndex: number;
  total: number;
  startedAt: string | null;
  serverNow: string;
  question: { id: number; q: string; imageId: number | null; opts: string[]; optImages: (number | null)[]; seconds: number; pointsX: number; answer: number | null; why: string | null } | null;
  answered: number;
  players: number;
  me: { score: number; streak: number; answered: boolean; place: number } | null;
  top: { nickname: string; avatar: string; score: number }[];
};

export function QuizJoin() {
  const c = useApp();
  const [code, setCode] = useState('');
  const [nick, setNick] = useState('');
  const [av, setAv] = useState('bulb');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const pinRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => pinRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, []);
  const join = async () => {
    const pin = code.replace(/\D/g, '');
    setErr('');
    if (pin.length < 4) return setErr('Type the code from the class screen.');
    setBusy(true);
    try {
      const g = await post<{ gameId: number; pin: string; title: string }>('/api/student/quiz/join', { pin, nick: nick.trim() || null, avatar: av });
      const saved: Saved = { id: g.gameId, pin: g.pin, title: g.title, nick: nick.trim() || c.m?.me.first, av };
      try {
        localStorage.setItem(QZ_KEY, JSON.stringify(saved));
      } catch {}
      c.closeSheet();
      c.setQuiz({ id: g.gameId, pin: g.pin, title: g.title });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not reach the game');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h3 id="sheetTitle">Join a quiz</h3>
      <p className="lede">Leon puts the code on the class screen.</p>
      <input
        ref={pinRef}
        className="qg-pin"
        inputMode="numeric"
        maxLength={6}
        placeholder="000000"
        style={{ marginTop: 'var(--s4)' }}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        aria-label="Game code"
      />
      <label style={{ display: 'block', marginTop: 'var(--s4)' }} htmlFor="qgNick">
        Your name in the game
      </label>
      <input id="qgNick" maxLength={18} placeholder={c.m?.me.first || 'You'} value={nick} onChange={(e) => setNick(e.target.value)} />
      <p className="meta" style={{ marginTop: 'var(--s4)' }}>
        Pick your mark
      </p>
      <div className="qg-av" style={{ marginTop: 'var(--s2)' }}>
        {AVATARS.map((k) => (
          <button key={k} className={k === av ? 'on' : ''} aria-label={k} aria-pressed={k === av} onClick={() => setAv(k)}>
            <Avatar k={k} />
          </button>
        ))}
      </div>
      <p className="meta" role="alert" style={{ minHeight: 18, marginTop: 'var(--s3)' }}>
        {err}
      </p>
      <button className="btn btn-primary" style={{ width: '100%' }} onClick={join} disabled={busy}>
        Join
      </button>
    </>
  );
}

/** An option's words, its picture, or both (a set may have picture-only options). */
function OptBody({ text, img }: { text: string; img: number | null | undefined }) {
  return (
    <span className="ot">
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="opt-img" src={`/api/media/${img}`} alt="" loading="lazy" />
      ) : null}
      {text}
    </span>
  );
}

export function QuizGame() {
  const c = useApp();
  const g = c.quiz;
  const ref = useRef<HTMLDivElement>(null);
  const [st, setSt] = useState<QState | null>(null);
  const [skew, setSkew] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [last, setLast] = useState<{ correct: boolean; points: number } | null>(null);
  const [fails, setFails] = useState(0);
  const [now, setNow] = useState(Date.now);
  const qid = useRef<number | null>(null);
  const over = useRef(false);
  const saved = g ? readQz() : null;

  const leave = useCallback(() => {
    clearQz();
    setSt(null);
    setPicked(null);
    setLast(null);
    qid.current = null;
    c.setQuiz(null);
  }, [c]);
  useOverlay(!!g, leave, () => ref.current);

  const refresh = useCallback(async () => {
    if (!g || over.current) return;
    try {
      const s = await api<QState>(`/api/student/quiz/${g.id}/state`);
      setNow(Date.now());
      setSkew(new Date(s.serverNow).getTime() - Date.now());
      const q = s.question?.id ?? null;
      if (qid.current !== q) {
        qid.current = q;
        setPicked(null);
        setLast(null);
      }
      setSt(s);
      setFails(0);
      /* the game is over: stop asking */
      if (s.state === 'ended') {
        over.current = true;
        clearQz();
      }
    } catch (e) {
      /* a game that has been deleted, or a player that is not in it */
      if (e instanceof ApiError && (e.code === 'not_player' || e.code === 'no_game')) return leave();
      setFails((n) => n + 1);
    }
  }, [g, leave]);

  useEffect(() => {
    if (!g) return;
    const first = setTimeout(refresh, 0);
    /* the stream is the quick path; the poll is the one that is always right */
    const poll = setInterval(refresh, 2000);
    let es: EventSource | null = null;
    try {
      es = new EventSource(`/api/quiz/${g.id}/events`);
      es.onmessage = () => refresh();
    } catch {}
    return () => {
      clearTimeout(first);
      clearInterval(poll);
      es?.close();
    };
  }, [g, refresh]);

  const ended = st?.state === 'ended';
  useEffect(() => {
    if (st?.state !== 'question') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [st?.state, st?.question?.id]);

  if (!g) return <div className="qg" />;
  const me = st?.me || { score: 0, streak: 0, place: 0, answered: false };
  const letter = (i: number) => String.fromCharCode(65 + i);
  const left = () => {
    if (!st?.question || !st.startedAt) return 0;
    return Math.max(0, Math.ceil((new Date(st.startedAt).getTime() + st.question.seconds * 1000 - (now + skew)) / 1000));
  };
  const answer = async (i: number) => {
    if (!st || st.state !== 'question' || picked != null || !st.question) return;
    setPicked(i);
    try {
      const r = await post<{ correct: boolean; points: number }>(`/api/student/quiz/${g.id}/answer`, { questionId: st.question.id, choice: i });
      setLast(r);
    } catch (e) {
      setPicked(null);
      c.showToast(e instanceof Error ? e.message : 'Could not send that');
    }
  };

  let mid: React.ReactNode = null;
  if (!st) mid = <p className="lede">Joining…</p>;
  else if (st.state === 'lobby')
    mid = (
      <>
        <div className="qg-big">You are in</div>
        <p className="lede">Waiting for Leon to start. {st.players || 1} here so far.</p>
        <div className="qg-chipline">
          <span className="qg-chip">
            <Avatar k={saved?.av || 'bulb'} /> {saved?.nick || c.m?.me.first || 'You'}
          </span>
          <span className="qg-chip">Code {g.pin}</span>
        </div>
        <p className="meta">Keep this screen open. Answer fast, a run of right answers pays more.</p>
      </>
    );
  else if (st.state === 'question' && st.question) {
    const q = st.question;
    const l = left();
    if (picked != null || me.answered)
      mid = (
        <>
          <div className="qg-big">{last || me.answered ? 'Locked in' : 'Sending…'}</div>
          <p className="lede">{q.q}</p>
          <div className="qg-chipline">
            {picked != null && <span className="qg-chip">You chose {letter(picked)}</span>}
            <span className="qg-chip">{me.score} points</span>
          </div>
          <p className="meta">Wait for the class screen. No peeking at anyone else.</p>
        </>
      );
    else if (l <= 0)
      /* AT ZERO THE SERVER STOPS TAKING ANSWERS, so the buttons stop too. */
      mid = (
        <>
          <div className="qg-big">Time</div>
          <p className="lede">{q.q}</p>
          <p className="meta">No answer this time. Wait for the class screen.</p>
        </>
      );
    else
      mid = (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
            <span className="qg-clock">{l}</span>
            <span className="meta">
              Question {st.qIndex + 1} of {st.total}
              {q.pointsX > 1 ? ' · double points' : ''}
            </span>
          </div>
          <div className="qg-bar">
            <i style={{ width: Math.round((l / q.seconds) * 100) + '%' }} />
          </div>
          {q.q && <div className="qg-q">{q.q}</div>}
          {q.imageId ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="q-img" src={`/api/media/${q.imageId}`} alt="Picture for this question" loading="lazy" />
          ) : null}
          <div className="qg-opts">
            {q.opts.map((o, i) => (
              <button key={i} className="qg-opt" onClick={() => answer(i)}>
                <span className="lt">{letter(i)}</span>
                <OptBody text={o} img={q.optImages?.[i]} />
              </button>
            ))}
          </div>
        </>
      );
  } else if (st.state === 'reveal' && st.question) {
    const q = st.question;
    mid = (
      <>
        <div className="qg-big">{picked == null && !last ? 'No answer this time' : last?.correct ? 'Right' : 'Not this one'}</div>
        {!!last?.points && (
          <p className="lede">
            +{last.points} points{me.streak > 1 ? ` · ${me.streak} in a row` : ''}
          </p>
        )}
        <div className="qg-opts">
          {q.opts.map((o, i) => (
            <div key={i} className={`qg-opt${i === q.answer ? ' right' : picked === i ? ' wrong' : ''}`}>
              <span className="lt">{letter(i)}</span>
              <OptBody text={o} img={q.optImages?.[i]} />
            </div>
          ))}
        </div>
        {q.why && <p className="meta">{q.why}</p>}
        <div className="qg-chipline">
          <span className="qg-chip">{me.score} points</span>
          {me.place > 0 && <span className="qg-chip">{ordinal(me.place)}</span>}
        </div>
      </>
    );
  } else if (ended)
    mid = (
      <>
        <div className="qg-big">That is the game</div>
        <p className="lede">
          You finished on <b>{me.score}</b> points{me.place ? ', ' + ordinal(me.place) : ''}.
        </p>
        {st.top.length > 0 && (
          <div className="qg-chipline">
            {st.top.map((t, i) => (
              <span className="qg-chip" key={i}>
                <Avatar k={t.avatar} /> {i + 1}. {t.nickname} · {t.score}
              </span>
            ))}
          </div>
        )}
        <p className="meta">Only the top three are shown, here and on the class screen.</p>
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={leave}>
          Done
        </button>
      </>
    );

  return (
    <div className="qg on" ref={ref} role="dialog" aria-modal="true" aria-label="Class quiz">
      <div className="qg-top">
        <span className="m">{g.title || 'Class quiz'}</span>
        <button className="qg-x" onClick={leave}>
          Leave
        </button>
      </div>
      <div className="qg-mid">
        {mid}
        {fails >= 3 && <p className="meta">Weak connection. Trying again…</p>}
      </div>
    </div>
  );
}
