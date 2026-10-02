'use client';

import { useEffect, useRef, useState } from 'react';
import { post } from '@/lib/client/api';
import { useApp, type Ctx } from './ctx';
import { Ic } from './icons';
import { useOverlay } from './overlay';
import { setConf } from './tasks';
import { KV } from './ui';
import { CONF_LABEL, ERRS, KIND_LABEL, LESSON, comparable, dowName, errAdvice, recommend, tName, type Attempt, type FlowState } from './model';

/* ══ THE FLOWS: one decision per screen, full screen, never a trap.
   Task flow: context, learn, a question at a time with feedback, done.
   Exit mid-task keeps your place and Today offers Resume.
   Log flow: which paper, score, timed, what cost marks, check, saved. ══ */

function TaskFlow({ start, onClose }: { start: FlowState; onClose: (mid: boolean) => void }) {
  const c = useApp();
  const [f, setF] = useState<FlowState>(start);
  const L = LESSON[f.topic];
  const total = 2 + L.qs.length + 1;
  const s = f.step;
  const update = (n: FlowState) => {
    setF(n);
    c.setProgressTask(n);
  };
  const next = () => update({ ...f, step: f.step + 1 });

  /* finishing writes the self-check result (kept on this phone: the server
     only takes Leon's evidence) */
  const doneStep = s >= 2 + L.qs.length;
  const right = f.answers.filter((a, i) => a && a.pick === L.qs[i].a).length;
  const all = right === L.qs.length;
  useEffect(() => {
    if (!doneStep) return;
    c.setSelfEv(f.topic, all ? 'demonstrated' : 'developing');
    c.say(all ? 'Topic shown in checks' : 'Marked developing');
    // record once on arrival at the done step
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneStep]);

  let body: React.ReactNode;
  let foot: React.ReactNode;
  if (s === 0) {
    let when: string | null = null;
    for (const r of c.m!.classLog) if (r.topics.includes(f.topic)) when = r.date;
    body = (
      <>
        <div className="pill" style={{ marginBottom: 'var(--s4)' }}>
          {KIND_LABEL[f.kind] || 'Catch up'}
        </div>
        <h2>{tName(f.topic)}</h2>
        <p className="lede" style={{ marginTop: 'var(--s2)' }}>
          {when ? dowName(when) + '’s lesson covered this. ' : ''}Read the summary, then answer {L.qs.length} question{L.qs.length > 1 ? 's' : ''}.
        </p>
        <div className="banner" style={{ marginTop: 'var(--s5)' }}>
          <Ic.clock size={18} />
          <div>About {L.qs.length > 1 ? 9 : 6} minutes. You can stop any time and pick it up here.</div>
        </div>
        <p className="meta" style={{ marginTop: 'var(--s4)' }}>
          Topic {f.topic}
        </p>
      </>
    );
    foot = (
      <button className="btn btn-primary" onClick={next}>
        Start
      </button>
    );
  } else if (s === 1) {
    body = (
      <>
        <h2>The idea</h2>
        <p style={{ marginTop: 'var(--s3)', fontSize: 'var(--t-md)', lineHeight: 'var(--lh)' }}>{L.summary}</p>
        <div style={{ marginTop: 'var(--s6)' }}>
          {L.terms.map((k) => (
            <div className="keyterm" key={k[0]}>
              <b>{k[0]}</b>
              <span>{k[1]}</span>
            </div>
          ))}
        </div>
        <p className="meta" style={{ marginTop: 'var(--s5)' }}>
          Draft notes, pending Leon’s approval.
        </p>
      </>
    );
    foot = (
      <button className="btn btn-primary" onClick={next}>
        I have read this
      </button>
    );
  } else if (!doneStep) {
    const qi = s - 2;
    const Q = L.qs[qi];
    const picked = f.answers[qi];
    const answered = !!picked?.locked;
    const pick = (i: number) => {
      const a = f.answers.slice();
      a[qi] = { pick: i, locked: false };
      update({ ...f, answers: a });
    };
    const lock = () => {
      if (!picked) return;
      const a = f.answers.slice();
      a[qi] = { ...picked, locked: true };
      update({ ...f, answers: a });
      c.say(picked.pick === Q.a ? 'Correct' : 'Incorrect. Explanation shown.');
    };
    body = (
      <>
        <p className="meta">
          Question {qi + 1} of {L.qs.length}
        </p>
        <h2 style={{ marginTop: 'var(--s2)' }}>{Q.q}</h2>
        <div role="radiogroup" aria-label="Answer options">
          {Q.opts.map((o, i) => {
            const r = answered ? (i === Q.a ? 'right' : i === picked!.pick ? 'wrong' : undefined) : undefined;
            /* a tick on the option you got wrong reads as approval, so a wrong
               pick gets a cross and only the true answer keeps the tick */
            const cross = answered && picked!.pick === i && i !== Q.a;
            return (
              <button
                key={i}
                className="qopt"
                role="radio"
                aria-checked={picked?.pick === i}
                data-r={r}
                aria-label={answered && i === Q.a ? 'Correct answer: ' + o : undefined}
                disabled={answered}
                onClick={() => pick(i)}
              >
                <span className="mk">{cross ? <Ic.cross /> : <Ic.check />}</span>
                <span>{o}</span>
              </button>
            );
          })}
        </div>
        {answered && (
          <div className="verdict">
            <div className="vt">{picked!.pick === Q.a ? 'That is right' : 'Not this one'}</div>
            <p className="lede">{Q.why}</p>
          </div>
        )}
      </>
    );
    foot = answered ? (
      <button className="btn btn-primary" onClick={next}>
        Continue
      </button>
    ) : (
      <button className="btn btn-primary" disabled={!picked} onClick={lock}>
        Check answer
      </button>
    );
  } else {
    const m = c.m!;
    const nxt = recommend(m).filter((r) => r.topic !== f.topic)[0];
    body = (
      <>
        <div className="done-mark">
          <Ic.check size={26} />
        </div>
        <h2>{all ? 'Topic shown' : 'Partly there'}</h2>
        <p className="lede" style={{ marginTop: 'var(--s2)' }}>
          {right} of {L.qs.length} correct. {all ? tName(f.topic) + ' now counts as shown in checks.' : 'Marked as developing. Worth one more pass later.'}
        </p>
        <div className="list" style={{ marginTop: 'var(--s6)' }}>
          <div className="rowbtn" style={{ cursor: 'default' }}>
            <div className="grow">
              <div className="tt" style={{ fontWeight: 600 }}>
                How sure do you feel now?
              </div>
              <div className="meta">Your own read, kept separate from the check</div>
            </div>
          </div>
          <div style={{ padding: 'var(--s3) var(--s4)', display: 'flex', gap: 'var(--s2)' }}>
            {['got', 'shaky', 'lost'].map((k) => (
              <button key={k} className="chip" aria-pressed={m.conf[f.topic] === k} style={{ flex: 1, justifyContent: 'center' }} onClick={() => setConf(c, f.topic, k, { inFlow: true })}>
                {CONF_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
        {nxt && (
          <>
            <div className="sect-h">
              <h2>Next</h2>
            </div>
            <div className="list">
              <button
                className="rowbtn"
                onClick={() => {
                  c.setProgressTask(null);
                  onClose(false);
                  setTimeout(() => c.startTask(nxt), 60);
                }}
              >
                <div className="grow">
                  <div className="tt" style={{ fontWeight: 550 }}>
                    {nxt.title}
                  </div>
                  <div className="meta">
                    {nxt.why} · {nxt.mins} min
                  </div>
                </div>
                <span className="chev">
                  <Ic.chev />
                </span>
              </button>
            </div>
          </>
        )}
      </>
    );
    foot = (
      <button
        className="btn btn-primary"
        onClick={() => {
          c.setProgressTask(null);
          onClose(false);
          c.show('next');
        }}
      >
        Done
      </button>
    );
  }
  return (
    <FlowChrome
      prog={Math.round((s / (total - 1)) * 100)}
      canBack={s > 0}
      onBack={() => s > 0 && update({ ...f, step: s - 1 })}
      onExit={() => {
        const mid = s > 0 && !doneStep;
        if (!mid) c.setProgressTask(null);
        onClose(mid);
      }}
      body={body}
      foot={foot}
    />
  );
}

type PL = { step: number; paper: string; q: string; score: string; max: string; timed: boolean | null; err: string; mins?: number };

function LogFlow({ preset, onClose }: { preset?: { timed?: boolean; mins?: number }; onClose: () => void }) {
  const c = useApp();
  const m = c.m!;
  const [p, setP] = useState<PL>({ step: 0, paper: '', q: '', score: '', max: '20', timed: preset?.timed ?? null, err: '', mins: preset?.mins });
  const [saved, setSaved] = useState<Attempt | null>(null);
  const [busy, setBusy] = useState(false);
  const s = p.step;
  const set = (x: Partial<PL>) => setP((o) => ({ ...o, ...x }));
  const recent: string[] = [];
  m.papers
    .slice(-4)
    .reverse()
    .forEach((x) => {
      if (!recent.includes(x.paper)) recent.push(x.paper);
    });
  const sc = +p.score,
    mx = +p.max;
  const scoreOk = p.score !== '' && p.max !== '' && !isNaN(sc) && !isNaN(mx) && mx > 0 && sc >= 0 && sc <= mx && Number.isInteger(sc) && Number.isInteger(mx);

  const save = async () => {
    setBusy(true);
    try {
      const r = await post<{ attempt: Attempt }>('/api/student/attempts', {
        paper: p.paper.trim(),
        q: p.q.trim(),
        score: sc,
        max: mx,
        timed: !!p.timed,
        err: p.err,
      });
      /* compared against what was there before this one */
      setSaved(r.attempt);
      /* already saved above; this only puts it on screen without a reload */
      await c.write((b) => ({ ...b, papers: [...b.papers, r.attempt] }), async () => {});
      set({ step: 5 });
      c.say('Attempt saved. ' + Math.round((r.attempt.score / r.attempt.max) * 100) + ' percent.');
    } catch (e) {
      c.showToast('Not saved. ' + (e instanceof Error ? e.message : ''));
    } finally {
      setBusy(false);
    }
  };

  let body: React.ReactNode;
  let foot: React.ReactNode;
  if (s === 0) {
    body = (
      <>
        <h2>Which paper?</h2>
        <div className="stack" style={{ marginTop: 'var(--s4)' }}>
          {recent.length > 0 && (
            <div className="chipbar">
              {recent.map((x) => (
                <button key={x} className="chip" onClick={() => set({ paper: x })}>
                  {x}
                </button>
              ))}
            </div>
          )}
          <div>
            <label htmlFor="plPaper">Paper</label>
            <input id="plPaper" placeholder="2021 Paper I" value={p.paper} onChange={(e) => set({ paper: e.target.value })} />
          </div>
          <div>
            <label htmlFor="plQ">Question or section</label>
            <input id="plQ" placeholder="Q3" value={p.q} onChange={(e) => set({ q: e.target.value })} />
          </div>
          {p.mins != null && (
            <p className="meta">
              Timed by the app: {p.mins} minute{p.mins === 1 ? '' : 's'}.
            </p>
          )}
        </div>
      </>
    );
    foot = (
      <button className="btn btn-primary" disabled={!(p.paper.trim() && p.q.trim())} onClick={() => set({ step: 1 })}>
        Continue
      </button>
    );
  } else if (s === 1) {
    body = (
      <>
        <h2>What did you score?</h2>
        <div className="stack" style={{ marginTop: 'var(--s4)' }}>
          <div>
            <label htmlFor="plScore">Your score</label>
            <input id="plScore" inputMode="numeric" pattern="[0-9]*" value={p.score} onChange={(e) => set({ score: e.target.value.replace(/[^\d]/g, '') })} />
          </div>
          <div>
            <label htmlFor="plMax">Out of</label>
            <input id="plMax" inputMode="numeric" pattern="[0-9]*" value={p.max} onChange={(e) => set({ max: e.target.value.replace(/[^\d]/g, '') })} />
          </div>
          <p className="meta" role="alert">
            {p.score !== '' && p.max !== '' && !scoreOk ? 'Score must be between 0 and the maximum.' : ''}
          </p>
        </div>
      </>
    );
    foot = (
      <button className="btn btn-primary" disabled={!scoreOk} onClick={() => set({ step: 2 })}>
        Continue
      </button>
    );
  } else if (s === 2) {
    body = (
      <>
        <h2>Timed?</h2>
        <p className="lede" style={{ marginTop: 'var(--s2)' }}>
          Only timed attempts are compared with other timed attempts.
        </p>
        <div style={{ marginTop: 'var(--s4)' }}>
          {(
            [
              [true, 'Timed'],
              [false, 'Untimed'],
            ] as [boolean, string][]
          ).map(([v, l]) => (
            <button key={l} className="qopt" role="radio" aria-checked={p.timed === v} onClick={() => set({ timed: v })}>
              <span className="mk">
                <Ic.check />
              </span>
              <span>{l}</span>
            </button>
          ))}
        </div>
      </>
    );
    foot = (
      <button className="btn btn-primary" disabled={p.timed === null} onClick={() => set({ step: 3 })}>
        Continue
      </button>
    );
  } else if (s === 3) {
    body = (
      <>
        <h2>What cost you marks?</h2>
        <p className="lede" style={{ marginTop: 'var(--s2)' }}>
          Optional. This is what makes the pattern useful.
        </p>
        <div style={{ marginTop: 'var(--s4)' }}>
          {ERRS.map((e) => (
            <button key={e} className="qopt" role="radio" aria-checked={p.err === e} onClick={() => set({ err: p.err === e ? '' : e })}>
              <span className="mk">
                <Ic.check />
              </span>
              <span>{e}</span>
            </button>
          ))}
          <button className="btn btn-quiet" style={{ marginTop: 'var(--s4)' }} onClick={() => set({ err: '', step: 4 })}>
            Nothing in particular
          </button>
        </div>
      </>
    );
    foot = (
      <button className="btn btn-primary" onClick={() => set({ step: 4 })}>
        Continue
      </button>
    );
  } else if (s === 4) {
    const pct = Math.round((sc / mx) * 100);
    body = (
      <>
        <h2>Check this</h2>
        <div className="list" style={{ marginTop: 'var(--s4)' }}>
          <KV k="Paper" v={`${p.paper} ${p.q}`} />
          <KV k="Score" v={`${p.score} of ${p.max} · ${pct}%`} />
          <KV k="Conditions" v={p.timed ? 'Timed' : 'Untimed'} />
          <KV k="Main problem" v={p.err || 'None recorded'} />
        </div>
        <p className="meta" style={{ marginTop: 'var(--s4)' }}>
          Saved as self-marked.
        </p>
      </>
    );
    foot = (
      <button className="btn btn-primary" onClick={save} disabled={busy}>
        {busy ? 'Saving' : 'Save attempt'}
      </button>
    );
  } else {
    const a = saved!;
    const comp = comparable(m, a).filter((x) => x.id !== a.id);
    const pctv = Math.round((a.score / a.max) * 100);
    const better = comp.filter((x) => x.score < a.score).length;
    body = (
      <>
        <div className="done-mark">
          <Ic.check size={26} />
        </div>
        <h2>{pctv}%</h2>
        <p className="lede" style={{ marginTop: 'var(--s2)' }}>
          {comp.length
            ? `Compared with ${comp.length} other ${a.timed ? 'timed' : 'untimed'} attempt${comp.length > 1 ? 's' : ''} out of ${a.max}. You beat ${better} of them.`
            : 'First attempt of this type, so there is nothing comparable yet.'}
        </p>
        {a.err && (
          <div className="verdict" style={{ marginTop: 'var(--s5)' }}>
            <div className="vt">{a.err}</div>
            <p className="lede">{errAdvice(a.err)}</p>
          </div>
        )}
      </>
    );
    foot = (
      <button className="btn btn-primary" onClick={onClose}>
        Done
      </button>
    );
  }
  return (
    <FlowChrome
      prog={Math.round((Math.min(s, 5) / 5) * 100)}
      canBack={s > 0 && s < 5}
      onBack={() => s > 0 && s < 5 && set({ step: s - 1 })}
      onExit={onClose}
      body={body}
      foot={foot}
    />
  );
}

function FlowChrome({ prog, canBack, onBack, onExit, body, foot }: { prog: number; canBack: boolean; onBack: () => void; onExit: () => void; body: React.ReactNode; foot: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo(0, 0);
  }, [prog]);
  return (
    <div className="flow on" ref={ref} role="dialog" aria-modal="true" aria-label="Study task">
      <div className="flow-top">
        <button className="ic-btn" aria-label="Go back" style={{ visibility: canBack ? 'visible' : 'hidden' }} onClick={onBack}>
          <Ic.back />
        </button>
        <div className="flow-prog">
          <i style={{ width: prog + '%' }} />
        </div>
        <button className="ic-btn" aria-label="Close and save for later" onClick={onExit}>
          <Ic.close />
        </button>
      </div>
      <div className="flow-body">{body}</div>
      <div className="flow-foot">{foot}</div>
    </div>
  );
}

/** The flow host: whichever flow is open, with Back and Escape wired. */
export function FlowHost() {
  const c = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const flow = c.flow;
  const close = (ctx: Ctx, mid: boolean) => {
    ctx.setFlow(null);
    if (mid) ctx.showToast('Saved. Pick up where you left off.');
  };
  /* Back and Escape: a task left part way keeps its place for Resume */
  const exit = () => {
    if (flow?.type !== 'task') return c.setFlow(null);
    const st = flow.state;
    const cur = c.m?.progressTask?.topic === st.topic ? c.m.progressTask : st;
    const mid = cur.step > 0 && cur.step < 2 + LESSON[st.topic].qs.length;
    if (!mid) c.setProgressTask(null);
    close(c, mid);
  };
  useOverlay(!!flow, exit, () => ref.current);
  if (!flow) return <div className="flow" />;
  return (
    <div ref={ref}>
      {flow.type === 'task' ? (
        <TaskFlow key={flow.state.topic} start={flow.state} onClose={(mid) => close(c, mid)} />
      ) : (
        <LogFlow preset={flow.preset} onClose={() => c.setFlow(null)} />
      )}
    </div>
  );
}
