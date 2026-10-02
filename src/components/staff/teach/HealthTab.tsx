'use client';

import { useState, type ReactNode } from 'react';
import useSWR from 'swr';
import { fetcher, post, put } from '@/lib/client/api';
import { ErrorCard, Loading, Ok, Switch, useToast } from '@/components/staff/ui';
import { useDialog } from '@/components/staff/Dialog';
import { MN_FULL, colomboParts, feedStamp } from '@/lib/shared/dates';
import { hr, pl } from './util';
import type { AccessData } from './types';

/* HEALTH: every number is a door, not a decoration. Plus the phone
   reminders (student nudges and the parent fee reminder) and a live
   "how it is going" read from the push log. */

const KINDS: [string, string, string][] = [
  ['recording', 'Missed class recording closing', '1 to 3 days before it closes'],
  ['tute', 'Tute not finished', 'assigned, started or marked to fix'],
  ['checkin', 'Monthly check-in due', 'last month unanswered, or from the 25th'],
  ['exam', 'Exam countdown days', '300, 200, 100 … 7, 3, 1 days to go'],
  ['topics', 'Topics marked Lost', 'a gentle nudge, at most weekly'],
  ['comeback', 'Not opened for 4+ days', '"your next step is ready"'],
];
const DEF = {
  on: true,
  max: 2,
  from: 16,
  to: 19,
  kinds: { recording: true, tute: true, checkin: true, exam: true, topics: true, comeback: true } as Record<string, boolean>,
  parent: { on: true, day: 5, day2: 12, hour: 18 },
};
type Cfg = typeof DEF;
type Status = {
  ready: boolean;
  students: { people: number; phones: number; of: number };
  parents: { people: number; phones: number };
  subscribed: { id: number; name: string }[];
  log: { id: number; name: string; kind: string; title: string | null; delivered: number; test: boolean; audience: string; sentAt: string }[];
};

function slots(max: number, from: number, to: number) {
  const m = Math.max(1, Math.min(6, max));
  const t = Math.max(from, to);
  if (m === 1) return [t];
  const o: number[] = [];
  for (let i = 0; i < m; i++) {
    const h = Math.round(from + (i * (t - from)) / (m - 1));
    if (!o.includes(h)) o.push(h);
  }
  return o;
}

const HOURS = Array.from({ length: 17 }, (_, i) => i + 6);
const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

function Row({ t, s, children }: { t: ReactNode; s?: ReactNode; children?: ReactNode }) {
  return (
    <div className="stu-row">
      <div className="sr-l">
        <div className="t">{t}</div>
        {s && <div className="s">{s}</div>}
      </div>
      {children}
    </div>
  );
}

export function HealthTab({ access, health, go }: { access: AccessData; health: { failed: number; version: string }; go: (t: 'access') => void }) {
  const s = access.stats;
  const rows: [string, string, ReactNode][] = [
    [
      'Accounts created',
      `${s.logins} of ${s.roster} active students`,
      s.logins ? null : (
        <button className="btn-ghost" onClick={() => go('access')}>
          Create the first, in Access
        </button>
      ),
    ],
    [
      'Never signed in',
      pl(s.never, 'student'),
      s.never ? (
        <button className="btn-ghost" onClick={() => go('access')}>
          View them
        </button>
      ) : null,
    ],
    [
      'Locked accounts',
      pl(s.locked, 'account'),
      s.locked ? (
        <button className="btn-ghost" onClick={() => go('access')}>
          Resolve, in Access
        </button>
      ) : null,
    ],
    ['Failed deliveries', `${pl(health.failed, 'reminder')} in the last 30 days`, <span key="h" className="hint">Phones that did not take a notification</span>],
    ['Staff OS version', health.version, null],
  ];
  return (
    <>
      <div className="card">
        <div className="card-h">
          <h3>App health</h3>
          <span className="hint">Live from the database</span>
        </div>
        <div className="card-b">
          {rows.map(([t, v, a]) => (
            <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--hair)' }}>
              <div style={{ flex: 1 }}>
                <b style={{ fontSize: 12.5 }}>{t}</b>
                <div className="hint">{v}</div>
              </div>
              {a}
            </div>
          ))}
        </div>
      </div>
      <Reminders />
    </>
  );
}

function Reminders() {
  const { toast, toastError } = useToast();
  const ask = useDialog();
  const { data, error, mutate } = useSWR<{ config: Cfg; status: Status }>('/api/staff/push', fetcher);
  // null = no unsaved edits: the draft is what is stored
  const [draft, setD] = useState<Cfg | null>(null);
  const [stu, setStu] = useState('');
  if (error && !data) return <ErrorCard error={error} retry={() => mutate()} />;
  if (!data) return <Loading />;

  const saved: Cfg = { on: data.config.on, max: data.config.max, from: data.config.from, to: data.config.to, kinds: data.config.kinds, parent: data.config.parent };
  const d = draft ?? saved;
  const dirty = JSON.stringify(d) !== JSON.stringify(saved);
  const set = (k: 'on' | 'max' | 'from' | 'to', v: number | boolean) =>
    setD(() => {
      const n = { ...d, [k]: v };
      if (n.to < n.from) {
        if (k === 'from') n.to = n.from;
        else n.from = n.to;
      }
      return n;
    });
  const setPar = (k: 'on' | 'day' | 'day2' | 'hour', v: number | boolean) =>
    setD(() => {
      const p = { ...d.parent, [k]: v };
      // the follow-up cannot land before the first one
      if (p.day2 <= p.day) p.day2 = Math.min(28, p.day + 7);
      return { ...d, parent: p };
    });
  const when = slots(d.max, d.from, d.to).map(hr).join(', ');

  const save = async () => {
    try {
      await put('/api/staff/push', d);
      await mutate();
      setD(null);
      toast(<Ok>Reminder settings saved</Ok>);
    } catch (e) {
      toastError(e);
    }
  };
  const test = async () => {
    const id = Number(stu || data.status.subscribed[0]?.id);
    if (!id) return toast('Pick a student with reminders on');
    try {
      toast('Sending a test…');
      const r = await post<{ delivered: number; devices: number }>('/api/staff/push', { test: true, studentId: id });
      mutate();
      toast(<Ok>{`Sent to ${r.delivered} of ${pl(r.devices, 'phone')}`}</Ok>);
    } catch (e) {
      toastError(e);
    }
  };
  const runNow = async () => {
    if (!(await ask.confirm({ title: 'Send each student their next due reminder now?', body: 'The daily limit still applies.', okLabel: 'Send now' }))) return;
    try {
      const r = await post<{ sent?: number; note?: string }>('/api/staff/push', { run: true });
      mutate();
      toast(<Ok>{`${pl(r.sent ?? 0, 'reminder')} sent${r.note ? ` · ${r.note}` : ''}`}</Ok>);
    } catch (e) {
      toastError(e);
    }
  };

  const st = data.status;
  const sel = (val: number, opts: [number, string][], on: (v: number) => void, label: string) => (
    <select className="filter" value={val} onChange={(e) => on(Number(e.target.value))} aria-label={label}>
      {opts.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <div className="card">
        <div className="card-h">
          <h3>Phone reminders</h3>
          <span className="hint">notifications on students&rsquo; phones, even with the app closed</span>
        </div>
        <div className="card-b">
          <Row t="Reminders" s="switch off to stop all of them at once">
            <span className="sp" style={{ flex: 1 }} />
            <Switch on={d.on} onChange={(v) => set('on', v)} label="Reminders on or off" />
          </Row>
          <Row t="Maximum per student, per day" s="each student gets at most this many">
            {sel(d.max, [[1, '1 a day'], [2, '2 a day'], [3, '3 a day'], [4, '4 a day']], (v) => set('max', v), 'Maximum per day')}
          </Row>
          <Row t="Between" s="Sri Lanka time">
            {sel(d.from, HOURS.map((h) => [h, hr(h)]), (v) => set('from', v), 'Earliest hour')}
            <span className="hint">and</span>
            {sel(d.to, HOURS.map((h) => [h, hr(h)]), (v) => set('to', v), 'Latest hour')}
          </Row>
          <Row t="Sends at">
            <b>{d.on ? when : 'Off'}</b>
            <span className="hint">{d.on ? 'one reminder per student at each time, only if something is due' : ''}</span>
          </Row>
          {KINDS.map(([k, t, s]) => (
            <Row key={k} t={t} s={s}>
              <span className="sp" style={{ flex: 1 }} />
              <Switch on={!!d.kinds[k]} onChange={(v) => setD({ ...d, kinds: { ...d.kinds, [k]: v } })} label={t} />
            </Row>
          ))}
          <div className="stu-foot">
            <button className="btn-primary" onClick={save} disabled={!dirty}>
              Save reminders
            </button>
            <span className="sp" />
            <button className="stu-reset" onClick={() => setD(structuredClone(DEF))}>
              Reset to default
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <h3>Parent fee reminders</h3>
          <span className="hint">on the parent app, at most two a month, never anything else</span>
        </div>
        <div className="card-b">
          <Row t="Fee reminders" s="switch off to stop them for every parent">
            <span className="sp" style={{ flex: 1 }} />
            <Switch on={d.parent.on} onChange={(v) => setPar('on', v)} label="Parent fee reminders on or off" />
          </Row>
          <Row t="First reminder" s="day of the month, only if the fee is unpaid">
            {sel(d.parent.day, DAYS.map((x) => [x, `Day ${x}`]), (v) => setPar('day', v), 'First reminder day')}
          </Row>
          <Row t="Follow-up" s="one more, only if it is still unpaid">
            {sel(d.parent.day2, DAYS.filter((x) => x > d.parent.day).map((x) => [x, `Day ${x}`]), (v) => setPar('day2', v), 'Follow-up day')}
          </Row>
          <Row t="Time of day" s="Sri Lanka time">
            {sel(d.parent.hour, HOURS.map((h) => [h, hr(h)]), (v) => setPar('hour', v), 'Hour')}
          </Row>
          <Row t="A parent sees">
            <span className="hint">
              {d.parent.on
                ? `“${MN_FULL[colomboParts().m - 1]} class fee · Nimal’s fee of LKR 2,900 is due this month.” Nothing is sent to a parent who has paid. It runs on its own day and hour, whatever the student reminders are set to.`
                : 'nothing'}
            </span>
          </Row>
          <div className="stu-foot">
            <button className="btn-primary" onClick={save} disabled={!dirty}>
              Save reminders
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <h3>How it is going</h3>
          <span className="hint">live from the database</span>
        </div>
        <div className="card-b">
          {!st.ready && <div className="hint">Push keys are not set up on the server, so nothing can be sent yet.</div>}
          <Row t="Students with reminders on" s="they turn it on in the app, under Progress">
            <b>
              {st.students.people} of {st.students.of}
            </b>
            <span className="hint">{pl(st.students.phones, 'phone')}</span>
          </Row>
          <Row t="Parents with reminders on" s="they turn it on in the parent app">
            <b>{st.parents.people}</b>
            <span className="hint">{pl(st.parents.phones, 'phone')}</span>
          </Row>
          <Row t="Send a test" s="one notification to that student now">
            {st.subscribed.length ? (
              <>
                <select className="filter" style={{ minWidth: 180 }} value={stu || st.subscribed[0].id} onChange={(e) => setStu(e.target.value)}>
                  {st.subscribed.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
                <button className="btn-ghost" onClick={test}>
                  Send test
                </button>
              </>
            ) : (
              <span className="hint">Nobody has turned reminders on yet.</span>
            )}
          </Row>
          <Row t="Send due reminders now" s="instead of waiting for the next sending hour">
            <button className="btn-ghost" onClick={runNow} disabled={!st.subscribed.length}>
              Send now
            </button>
          </Row>
          <div className="stu-row" style={{ display: 'block' }}>
            <div className="t" style={{ fontSize: 12.5, fontWeight: 650, marginBottom: 6 }}>
              Last sent
            </div>
            {st.log.length ? (
              st.log.map((l) => (
                <div key={l.id} style={{ display: 'flex', gap: 10, fontSize: 12.5, padding: '5px 0', borderTop: '1px dashed var(--line2)' }}>
                  <span style={{ width: 118, flex: 'none', color: 'var(--muted)' }}>{feedStamp(l.sentAt)}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b>{l.name}</b> · {l.title || l.kind}
                    {l.audience === 'parent' && <span className="hint"> (parent)</span>}
                    {l.test && <span className="hint"> (test)</span>}
                  </span>
                  <span className="hint">{l.delivered ? 'delivered' : 'not delivered'}</span>
                </div>
              ))
            ) : (
              <div className="hint">Nothing sent yet.</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
