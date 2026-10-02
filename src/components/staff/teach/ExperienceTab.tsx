'use client';

import { useState, type ReactNode } from 'react';
import { patch } from '@/lib/client/api';
import { Ok, useToast } from '@/components/staff/ui';
import { useDialog } from '@/components/staff/Dialog';
import type { AppConfig } from '@/lib/shared/constants';
import { pl } from './util';

/* EXPERIENCE: what students see, scoped, with the effect stated BEFORE the
   press. Switching a feature off asks first, with the same count the row shows. */

const FEAT: Record<string, [string, string, string]> = {
  rewards: ['Rewards ladder', 'Attendance rewards and the university benefit', 'Hides the ladder. Attendance records are kept, nothing is deleted.'],
  batchStats: ['Batch figures', 'Percentages from the whole batch, with sample size, never rankings', 'Hides batch percentages from every student.'],
  seminars: ['Seminars', 'Invitations and one-tap registration', 'Hides seminars in the app. Existing registrations are kept.'],
  weeklyPlan: ['Weekly plan', 'The Do next queue and the ten-minute tasks', 'Hides the plan. Coverage and evidence records are kept.'],
  competition: [
    'Honours and the batch race',
    'Top attendance names and location v location turnout, never a full ranking',
    'Hides both. Nobody is ever ranked bottom in this app, on or off.',
  ],
};
const PH = ['', 'Build the foundation', 'Turn knowledge into marks', 'Enter exam mode'];
const SRC: [string, string][] = [
  ['leon', 'Leon verified'],
  ['system', 'System verified'],
  ['self', 'Student recorded'],
  ['outcome', 'Exam outcome'],
];

export function Fold({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <details className="card">
      <summary style={{ padding: '14px 18px', cursor: 'pointer', fontWeight: 700, fontSize: 13.5, listStyle: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
        {title}
        <span className="hint" style={{ fontWeight: 400 }}>
          {hint}
        </span>
        <span className="hint" style={{ marginLeft: 'auto' }}>
          Open
        </span>
      </summary>
      <div className="card-b">{children}</div>
    </details>
  );
}

export function ExperienceTab({ cfg, counts, reload }: { cfg: AppConfig; counts: Record<string, number>; reload: () => void }) {
  const { toast, toastError } = useToast();
  const ask = useDialog();
  const [wa, setWa] = useState(cfg.support.wa);
  const [hours, setHours] = useState(cfg.support.hours);

  const op = async (body: Record<string, unknown>, ok?: ReactNode) => {
    try {
      await patch('/api/staff/app', body);
      reload();
      toast(ok ?? <Ok>Saved</Ok>);
      return true;
    } catch (e) {
      toastError(e);
      return false;
    }
  };

  const features = cfg.features as Record<string, { on: boolean; aud: string; by: string; when: string }>;
  const reach = (aud: string) => counts[aud === 'all' ? 'all' : aud] ?? 0;

  const toggle = async (k: string) => {
    const f = features[k];
    const [title, , consequence] = FEAT[k];
    const n = reach(f.aud);
    if (f.on && n && !(await ask.confirm({ title: `${pl(n, 'student')} will lose ${title}.`, body: `${consequence}\n\nContinue?`, okLabel: 'Turn off', danger: true }))) return;
    await op({ op: 'feature', key: k, on: !f.on }, <Ok>{`${title} is ${f.on ? 'off' : 'on'} for ${n} students. ${f.on ? consequence : ''}`}</Ok>);
  };

  return (
    <>
      <div className="card">
        <div className="card-h">
          <h3>Features</h3>
          <span className="hint">Every change states its effect and lands in the activity log</span>
        </div>
        <div className="card-b">
          {Object.keys(FEAT).map((k) => {
            const f = features[k];
            if (!f) return null;
            const [title, desc] = FEAT[k];
            const n = reach(f.aud);
            return (
              <div key={k} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--hair)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ fontSize: 13.5 }}>{title}</b>
                  <div className="hint">{desc}</div>
                  <div className="hint" style={{ marginTop: 3 }}>
                    <b style={{ color: 'var(--ink)' }}>{f.on ? `${pl(n, 'student')} can see this` : 'Nobody can see this'}</b> ·{' '}
                    {f.aud === 'all' ? 'everyone' : f.aud === 'c0' ? 'the 2027 batch' : 'the 2028 batch'} · last changed by {f.by} on {f.when}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                  <button
                    className={f.on ? 'btn-primary' : 'btn-ghost'}
                    style={{ minWidth: 56 }}
                    aria-pressed={f.on}
                    title={f.on ? `Switching this off takes it from ${n} students` : `Switching this on gives it to ${n} students`}
                    onClick={() => toggle(k)}
                  >
                    {f.on ? 'On' : 'Off'}
                  </button>
                  <select className="filter" style={{ fontSize: 12.5, padding: '4px 8px' }} value={f.aud} onChange={(e) => op({ op: 'feature', key: k, aud: e.target.value })}>
                    <option value="all">Everyone</option>
                    <option value="c0">2027 Batch</option>
                    <option value="c1">2028 Batch</option>
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Fold title="Road to an A" hint="the 14 steps and their wording">
        {cfg.road.map((r, i) => (
          <div key={i}>
            {(i === 0 || cfg.road[i - 1][3] !== r[3]) && (
              <div style={{ margin: '12px 0 4px', fontWeight: 700, fontSize: 12.5, color: 'var(--muted)' }}>{PH[r[3]]}</div>
            )}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '7px 0' }}>
              <span className="hint" style={{ width: 20 }}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <input
                className="filter"
                style={{ flex: 1, padding: '6px 8px' }}
                defaultValue={r[0]}
                maxLength={60}
                onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== r[0] && op({ op: 'road', i, title: e.target.value.trim() })}
              />
              <select className="filter" style={{ padding: '4px 6px' }} value={r[2]} onChange={(e) => op({ op: 'road', i, src: e.target.value })}>
                {SRC.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ))}
        <div className="hint" style={{ marginTop: 8 }}>
          Step numbers never change, so every student&rsquo;s lit history survives any rewording.
        </div>
      </Fold>

      <Fold title="Rewards" hint="prizes, wording and the attendance bars">
        {cfg.rewardTiers.map((t, i) => (
          <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid var(--hair)' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <b style={{ fontSize: 12.5, flex: 1 }}>{t.t}</b>
              <button className="btn-ghost" style={{ fontSize: 11 }} aria-pressed={t.state === 'confirmed'} onClick={() => op({ op: 'tier', i, toggle: true })}>
                {t.state === 'confirmed' ? 'Confirmed' : 'Pending confirmation'}
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
              <input
                className="filter"
                style={{ padding: '6px 8px' }}
                defaultValue={t.prize}
                aria-label="Prize"
                onBlur={(e) => e.target.value.trim() !== t.prize && op({ op: 'tier', i, prize: e.target.value.trim() })}
              />
              <input
                className="filter"
                style={{ padding: '6px 8px' }}
                defaultValue={t.claim}
                aria-label="How to claim"
                onBlur={(e) => e.target.value.trim() !== t.claim && op({ op: 'tier', i, claim: e.target.value.trim() })}
              />
            </div>
          </div>
        ))}
        <div className="hint" style={{ marginTop: 8 }}>
          The attendance bars themselves are locked mid-term. Moving a goalpost students are running at breaks the ladder&rsquo;s whole promise.
        </div>
      </Fold>

      <Fold title="Self-checks" hint="how often the app re-asks a student">
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 12 }}>
          <div>
            <label className="hint">Recheck a topic after (days)</label>
            <input
              className="filter"
              type="number"
              min={14}
              max={90}
              defaultValue={cfg.checks.recheckDays}
              onBlur={(e) => Number(e.target.value) !== cfg.checks.recheckDays && op({ op: 'checks', k: 'recheckDays', v: Number(e.target.value) }, <Ok>Saved.</Ok>)}
            />
          </div>
          <div>
            <label className="hint">Smallest batch shown in figures</label>
            <input
              className="filter"
              type="number"
              min={5}
              max={50}
              defaultValue={cfg.checks.minBatch}
              onBlur={(e) => Number(e.target.value) !== cfg.checks.minBatch && op({ op: 'checks', k: 'minBatch', v: Number(e.target.value) }, <Ok>Saved.</Ok>)}
            />
          </div>
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          Below {cfg.checks.minBatch} students, batch figures hide themselves: small groups make individuals guessable.
        </div>
      </Fold>

      <Fold title="Support" hint="where Ask Leon points">
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 12 }}>
          <div>
            <label className="hint">Ask Leon points at</label>
            <input className="filter" value={wa} maxLength={40} onChange={(e) => setWa(e.target.value)} />
          </div>
          <div>
            <label className="hint">Support hours</label>
            <input className="filter" value={hours} maxLength={60} onChange={(e) => setHours(e.target.value)} />
          </div>
        </div>
        <button className="btn-primary" style={{ marginTop: 10 }} onClick={() => op({ op: 'support', wa: wa.trim(), hours: hours.trim() }, <Ok>Saved. Ask Leon now points at {wa.trim()}.</Ok>)}>
          Save
        </button>
      </Fold>
    </>
  );
}
