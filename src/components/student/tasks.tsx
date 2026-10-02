'use client';

import { put, post } from '@/lib/client/api';
import type { Ctx } from './ctx';
import { useApp } from './ctx';
import { Ic } from './icons';
import { KV } from './ui';
import {
  CONF_LABEL,
  EV_TEXT,
  TUTE_LABEL,
  covered,
  evDate,
  evOf,
  evStale,
  fmtD,
  hasLesson,
  tName,
  tUnit,
  unitName,
  type RecItem,
} from './model';

/* THE TASK ROUTER, plus the sheets every screen opens: a topic, how sure you
   feel about it, and a unit's tute. A card that names a task opens THAT
   task, which was the defect the redesign existed to fix. */

export function routeTask(c: Ctx, r: Pick<RecItem, 'kind'> & Partial<RecItem>) {
  const m = c.m;
  if (!m) return;
  if (r.kind === 'recording') {
    const rec = m.recordings.find((x) => x.id === r.rec);
    if (rec) {
      window.open(rec.url, '_blank', 'noopener');
      c.say('Opening ' + rec.title);
      post(`/api/student/recordings/${rec.id}/view`).catch(() => {});
    } else c.show('learn', 'recordings');
    return;
  }
  if (r.kind === 'tute') {
    c.openSheet(<TuteSheet u={r.unit!} />);
    return;
  }
  if (r.kind === 'papers') {
    c.show('learn', 'papers');
    c.say('Papers');
    return;
  }
  const t = r.topic!;
  if (!hasLesson(t)) {
    /* no approved lesson yet: be honest and route somewhere useful */
    c.openSheet(<TopicSheet t={t} note="Leon has not added notes for this topic yet." />);
    return;
  }
  const state = m.progressTask && m.progressTask.topic === t ? m.progressTask : { topic: t, kind: r.kind, step: 0, answers: [] };
  c.setProgressTask(state);
  c.closeSheet();
  c.setFlow({ type: 'task', state });
}

/* ── confidence: the student's own read, saved as kind 'conf' only ── */

export function setConf(c: Ctx, t: string, v: string, opts: { inFlow?: boolean; silent?: boolean } = {}) {
  const prev = c.boot?.conf[t];
  c.write(
    (b) => {
      const conf = { ...b.conf };
      if (v === 'none') delete conf[t];
      else conf[t] = v;
      return { ...b, conf };
    },
    () => put('/api/student/topics', { topic: t, state: v }),
  );
  if (!opts.inFlow) c.closeSheet();
  if (opts.silent) return;
  c.showToast(tName(t) + ': ' + (v === 'none' ? 'not rated' : CONF_LABEL[v]), () => setConf(c, t, prev || 'none', { inFlow: true, silent: true }));
}

function confPick(c: Ctx, t: string, v: string) {
  setConf(c, t, v);
  const m = c.m!;
  if (v === 'got' && hasLesson(t) && evOf(m, t) !== 'demonstrated')
    setTimeout(() => c.startTask({ kind: 'recheck', topic: t, mins: 4, title: 'Quick check', why: 'Confirm it' }), 260);
  else if (v === 'lost' && hasLesson(t)) setTimeout(() => c.startTask({ kind: 'catchup', topic: t, mins: 9, title: 'Rebuild', why: 'You marked this Lost' }), 260);
}

export function ConfIcon({ k }: { k: string }) {
  if (k === 'got') return <Ic.check />;
  if (k === 'shaky') return <Ic.half />;
  if (k === 'lost') return <Ic.dash />;
  return null;
}

export function ConfSheet({ t }: { t: string }) {
  const c = useApp();
  const cur = c.m?.conf[t] || 'none';
  const opts: [string, string, string][] = [
    ['got', 'Got it', 'Offer a quick check'],
    ['shaky', 'Shaky', 'Practice this'],
    ['lost', 'Lost', 'Start a recovery task'],
  ];
  return (
    <>
      <h3 id="sheetTitle">How sure are you?</h3>
      <p className="lede">{tName(t)}</p>
      <div className="list" style={{ marginTop: 'var(--s4)' }}>
        {opts.map((o) => (
          <button key={o[0]} className="rowbtn" onClick={() => confPick(c, t, o[0])}>
            <span className={`conf ${o[0]}`} aria-hidden="true">
              <ConfIcon k={o[0]} />
            </span>
            <span className="grow">
              <span style={{ display: 'block', fontWeight: 550 }}>{o[1]}</span>
              <span className="meta">{o[2]}</span>
            </span>
            {cur === o[0] && <span className="pill solid">Current</span>}
          </button>
        ))}
      </div>
      {cur !== 'none' && (
        <button className="btn btn-quiet" style={{ marginTop: 'var(--s3)' }} onClick={() => confPick(c, t, 'none')}>
          Clear rating
        </button>
      )}
    </>
  );
}

export function TopicSheet({ t, note }: { t: string; note?: string }) {
  const c = useApp();
  const m = c.m!;
  const cov = covered(m)[t];
  const ev = evOf(m, t);
  const u = tUnit(t);
  const ed = evDate(m, t);
  return (
    <>
      <h3 id="sheetTitle">{tName(t)}</h3>
      <p className="lede">
        Topic {t} · Unit {u} {unitName(u)}
      </p>
      {note && (
        <div className="banner" style={{ marginTop: 'var(--s4)' }}>
          {note}
        </div>
      )}
      <div className="list" style={{ marginTop: 'var(--s4)' }}>
        <KV k="In class" v={cov ? 'Covered ' + fmtD(cov) : 'Not covered yet'} />
        <KV k="You feel" v={m.conf[t] ? CONF_LABEL[m.conf[t]] : 'Not rated'} />
        <KV k="Checks" v={EV_TEXT[ev] + (ed ? ' · ' + fmtD(ed) : '') + (evStale(m, t) ? ' · recheck due' : '')} />
        <KV k="Tute" v={'Unit ' + u + ' · ' + TUTE_LABEL[m.tutes[u] || 'assigned']} />
      </div>
      <div className="stack" style={{ marginTop: 'var(--s4)' }}>
        {hasLesson(t) && (
          <button
            className="btn btn-primary"
            onClick={() => {
              c.closeSheet();
              c.startTask({ kind: 'catchup', topic: t, mins: 9 });
            }}
          >
            {ev === 'untested' ? 'Study and check' : 'Check again'}
          </button>
        )}
        <button className="btn btn-secondary" onClick={() => c.openSheet(<ConfSheet t={t} />)}>
          Change how sure you feel
        </button>
      </div>
    </>
  );
}

/* ── tutes: the student's own record; rewards are not affected ── */

export function setTute(c: Ctx, u: string, v: string, silent = false) {
  const prev = c.boot?.tutes[u] || 'assigned';
  c.write(
    (b) => ({ ...b, tutes: { ...b.tutes, [u]: v } }),
    () => put('/api/student/tutes', { unit: u, state: v }),
  );
  c.closeSheet();
  if (!silent) c.showToast('Unit ' + u + ' tute: ' + TUTE_LABEL[v], () => setTute(c, u, prev, true));
}

export function TuteSheet({ u }: { u: string }) {
  const c = useApp();
  const cur = c.m?.tutes[u] || 'assigned';
  const doc = c.m?.tuteAssign.find((a) => a.unit === u && a.documentId)?.documentId;
  return (
    <>
      <h3 id="sheetTitle">Unit {u} tute</h3>
      <p className="lede">{unitName(u)}</p>
      {doc && (
        <button className="btn btn-primary" style={{ marginTop: 'var(--s4)' }} onClick={() => c.openDoc(doc)} disabled={c.libBusy === doc}>
          {c.libBusy === doc ? 'Opening…' : 'Open the tute'}
        </button>
      )}
      <div className="list" style={{ marginTop: 'var(--s4)' }}>
        {['assigned', 'started', 'done', 'fix'].map((k) => (
          <button key={k} className="rowbtn" onClick={() => setTute(c, u, k)}>
            <span className="grow">{TUTE_LABEL[k]}</span>
            {cur === k && <span className="pill solid">Current</span>}
          </button>
        ))}
      </div>
      <p className="meta" style={{ marginTop: 'var(--s4)' }}>
        Your own record. Rewards are not affected.
      </p>
    </>
  );
}
