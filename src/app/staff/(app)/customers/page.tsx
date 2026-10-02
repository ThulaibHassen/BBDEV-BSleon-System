'use client';

import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { fetcher } from '@/lib/client/api';
import { BSWL_PROGRAMS, CFG, COHORT_SHORT, LOC_LABEL, PROG_LABEL, lkr, locClass, waLink } from '@/lib/shared/constants';
import { dPlus, fmtDate, todayISO } from '@/lib/shared/dates';
import { Icon } from '@/components/staff/Icon';
import { CountUp, Empty, ErrorCard, Loading, Panel, downloadCsv } from '@/components/staff/ui';
import { useStaff } from '@/components/staff/StaffContext';
import { EnrolPanel } from '@/components/staff/crm/EnrolPanel';
import { StudentPanel } from '@/components/staff/crm/StudentPanel';
import { cadDays, cadLabel, cohortLabel, firstName, standing, type StudentRow } from '@/components/staff/crm/types';

/* Students: the roster with Leon's filters (status, batch, mode, class chips,
   institute only once Physical is picked), standing dots, the referral
   cadence and the one-tap fee reminder. */

type PanelState = { kind: 'student'; id: number } | { kind: 'add' } | null;

function StatKpi({ label, val, delta, dir, color }: { label: string; val: ReactNode; delta?: string; dir?: 'up' | 'down' | null; color: string }) {
  return (
    <div className="stat-kpi">
      <div className="stripe" style={{ background: color }} />
      <div className="lbl">{label}</div>
      <div className="val">{typeof val === 'number' ? <CountUp to={val} fmt="int" /> : val}</div>
      {delta && (
        <div className={`dl ${dir === 'up' ? 'up' : dir === 'down' ? 'down' : 'flat'}`}>
          {dir === 'up' ? '▲ ' : dir === 'down' ? '▼ ' : ''}
          {delta}
        </div>
      )}
    </div>
  );
}

/** recWaText — the same words the Fees page sends, so a student never gets two versions of one debt. */
function recWaText(name: string, n: number, owed: number) {
  const first = firstName(name);
  if (n === 0) return `Hi ${first}, thank you, your fees are up to date.`;
  return (
    `Hi ${first}, this is a reminder from ${CFG.app.client}. ` +
    (n === 1 ? 'Your fee for this month' : `${n} months of fees`) +
    ` is still outstanding, ${lkr(owed)} in total. Please let us know if you have already paid so we can update our records.`
  );
}

export default function CustomersPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Customers />
    </Suspense>
  );
}

function Customers() {
  const { config, can } = useStaff();
  const router = useRouter();
  const sp = useSearchParams();
  const { data, error, mutate } = useSWR<{ rows: StudentRow[] }>('/api/staff/students', fetcher);
  const [status, setStatus] = useState<'active' | 'alumni'>('active');
  const [cohort, setCohort] = useState('all');
  const [mode, setMode] = useState<'all' | 'online' | 'physical'>('all');
  const [progs, setProgs] = useState<string[]>([]);
  const [inst, setInst] = useState('all');
  const [panel, setPanel] = useState<PanelState>(null);
  const cohortsOn = config.modules.cohorts !== false;

  /* ?open=<id> from the topbar search: derived once per URL, then cleaned */
  const spKey = sp.toString();
  const [seenKey, setSeenKey] = useState('');
  if (spKey !== seenKey) {
    setSeenKey(spKey);
    const o = Number(sp.get('open'));
    if (o) setPanel({ kind: 'student', id: o });
  }
  useEffect(() => {
    if (sp.get('open')) router.replace('/staff/customers', { scroll: false });
  }, [sp, router]);

  const today = todayISO();
  const nextOf = (c: StudentRow) => {
    if (c.sent >= 3) return null;
    const first = c.first ?? c.last;
    return c.snooze || (first ? dPlus(first, cadDays(config, c.sent)) : null);
  };
  const dueOf = (c: StudentRow) => {
    const n = nextOf(c);
    return !!n && n <= today;
  };

  const all = useMemo(() => data?.rows ?? [], [data]);
  const list = useMemo(() => {
    let l = all;
    if (cohortsOn) l = l.filter((c) => (status === 'alumni' ? c.status === 'alumni' : c.status !== 'alumni'));
    if (cohortsOn && cohort !== 'all') l = l.filter((c) => String(c.cohort) === cohort);
    if (mode !== 'all') l = l.filter((c) => (locClass(c.loc) === 'online') === (mode === 'online'));
    if (progs.length) l = l.filter((c) => progs.includes(c.program));
    // a hidden filter must not keep filtering
    if (mode === 'physical' && inst !== 'all') l = l.filter((c) => c.loc === inst);
    return l;
  }, [all, cohortsOn, status, cohort, mode, progs, inst]);

  if (error) return <ErrorCard error={error} retry={() => void mutate()} />;

  const totLTV = all.reduce((s, c) => s + c.ltv, 0);
  const orders = all.reduce((s, c) => s + c.payments, 0);
  const dueN = all.filter((c) => c.status !== 'alumni' && dueOf(c)).length;
  const arr = [...list].sort((a, b) => (nextOf(a) || '9999').localeCompare(nextOf(b) || '9999'));
  const plural = config.contactWord.plural;

  const chase = (c: StudentRow) => {
    if (!c.plan) return <span className="tm">—</span>;
    if (!c.plan.monthsOwed)
      return (
        <span className="tm" title="Up to date">
          ✓
        </span>
      );
    if (!(c.plan.phone || '').replace(/\D/g, '')) return <span className="tm">No number</span>;
    const n = c.plan.monthsOwed;
    return (
      <a
        className="btn-ghost"
        style={{ padding: '6px 11px', whiteSpace: 'nowrap' }}
        target="_blank"
        rel="noopener"
        onClick={(e) => e.stopPropagation()}
        title={`${n} month${n === 1 ? '' : 's'} behind, ${lkr(c.plan.owed)}`}
        href={waLink(c.plan.phone, recWaText(c.name, n, c.plan.owed))}
      >
        Remind
      </a>
    );
  };

  return (
    <>
      {data && (
        <div className="stat-kpis">
          <StatKpi label={plural} val={list.length} delta={status === 'alumni' ? 'alumni' : `${all.length - list.length} alumni not shown`} color="var(--brand)" />
          <StatKpi label="Fees paid" val={lkr(totLTV)} delta="since they joined" color="var(--green)" />
          <StatKpi label="Avg monthly fee" val={orders ? lkr(totLTV / orders) : '-'} delta="across every payment" color="var(--amber)" />
          <StatKpi
            label="Referral asks due"
            val={dueN}
            delta={dueN ? 'ask them today' : 'none due'}
            dir={dueN ? 'down' : null}
            color={dueN ? 'var(--danger)' : 'var(--faint)'}
          />
        </div>
      )}
      <div className="toolbar">
        {cohortsOn && (
          <div className="seg-toggle">
            {(['active', 'alumni'] as const).map((s) => (
              <button key={s} className={`segt${status === s ? ' active' : ''}`} onClick={() => setStatus(s)}>
                {s === 'active' ? 'Active' : 'Alumni'}
              </button>
            ))}
          </div>
        )}
        {cohortsOn && (
          <select className="filter" value={cohort} onChange={(e) => setCohort(e.target.value)} aria-label="Batch">
            <option value="all">All groups</option>
            {CFG.cohorts.map((c, i) => (
              <option key={c} value={i}>
                {c}
              </option>
            ))}
          </select>
        )}
        <select
          className="filter"
          value={mode}
          aria-label="Mode"
          onChange={(e) => {
            const v = e.target.value as typeof mode;
            setMode(v);
            if (v !== 'physical') setInst('all');
          }}
        >
          <option value="all">Online and physical</option>
          <option value="online">Online</option>
          <option value="physical">Physical</option>
        </select>
        <div className="chips" role="group" aria-label="Class">
          {BSWL_PROGRAMS.map((x) => {
            const on = progs.includes(x);
            return (
              <button key={x} className={`chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => setProgs((p) => (on ? p.filter((y) => y !== x) : [...p, x]))}>
                {PROG_LABEL[x]}
              </button>
            );
          })}
        </div>
        {mode === 'physical' && (
          <select className="filter" value={inst} onChange={(e) => setInst(e.target.value)} aria-label="Institute">
            <option value="all">Every institute</option>
            {Object.keys(LOC_LABEL)
              .filter((k) => locClass(k) !== 'online')
              .map((k) => (
                <option key={k} value={k}>
                  {LOC_LABEL[k]}
                </option>
              ))}
          </select>
        )}
        <div className="sp" />
        {can('students.write') && (
          <button className="btn-primary" onClick={() => setPanel({ kind: 'add' })}>
            <Icon name="plus" strokeWidth={2.4} />
            Add student
          </button>
        )}
        <button
          className="btn-ghost"
          onClick={() =>
            downloadCsv(
              'customers.csv',
              ['Customer', 'Detail', 'Type', 'First order', 'Last contact', 'Cadence', `Lifetime value (${CFG.currency})`],
              all.map((c) => [c.name, c.co, COHORT_SHORT[c.cohort] ?? '', c.first ?? c.last ?? '', c.last ?? '', c.sent >= 3 ? 'Complete' : cadLabel(config, c.sent), c.ltv]),
            )
          }
        >
          <Icon name="download" />
          Export
        </button>
      </div>

      {!data ? (
        <Loading />
      ) : (
        <div className="card">
          <table className="tbl">
            <thead>
              <tr>
                <th>{config.contactWord.singular}</th>
                <th>Referral ask</th>
                <th>Next action</th>
                <th>Mode</th>
                <th className="tnum">Fees paid</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cohortsOn && arr.length > 0 && (
                <tr className="stand-legend-row">
                  <td colSpan={6}>
                    <span className="stand-legend">
                      <span>
                        <span className="sdot s-good" />
                        Strong
                      </span>
                      <span>
                        <span className="sdot s-okay" />
                        Okay
                      </span>
                      <span>
                        <span className="sdot s-bad" />
                        Needs work
                      </span>
                      <span style={{ color: 'var(--faint)', fontWeight: 500 }}>— each student&apos;s subject standing · tap a student to change</span>
                    </span>
                  </td>
                </tr>
              )}
              {arr.map((c) => {
                const done = c.sent >= 3;
                const due = dueOf(c) && c.status !== 'alumni';
                const st = standing(c.level);
                const online = locClass(c.loc) === 'online';
                return (
                  <tr key={c.id} onClick={() => setPanel({ kind: 'student', id: c.id })}>
                    <td>
                      <div className="tn">
                        <span className={`sdot s-${st.key}`} title={st.label} />
                        {c.name}
                      </div>
                      <div className="tm">
                        {cohortsOn ? `${cohortLabel(c.cohort).replace(' Batch', '')} · ` : ''}
                        {c.program ? `${c.program} · ` : ''}
                        {c.co || ''}
                      </div>
                    </td>
                    <td>
                      <span className="cad-dots">
                        {[0, 1, 2].map((i) => (
                          <span key={i} style={{ background: c.sent > i ? 'var(--green)' : c.sent === i && due ? 'var(--danger)' : 'var(--line)' }} />
                        ))}
                      </span>
                    </td>
                    <td style={{ fontSize: 12.5, color: due ? 'var(--danger)' : 'var(--muted)' }}>{done || c.status === 'alumni' ? '-' : fmtDate(nextOf(c))}</td>
                    <td>
                      <span className={`bdg ${online ? 'bdg-blue' : 'bdg-grey'}`}>{online ? 'Online' : 'Physical'}</span>
                    </td>
                    <td className="tnum">{online ? lkr(c.ltv) : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{chase(c)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!arr.length && <Empty icon="users" title={`No ${plural.toLowerCase()}`} sub={`Won deals become ${plural.toLowerCase()} here for repeat business.`} />}
        </div>
      )}

      <Panel open={!!panel} onClose={() => setPanel(null)}>
        {panel?.kind === 'student' && <StudentPanel key={panel.id} id={panel.id} onClose={() => setPanel(null)} onChanged={() => void mutate()} />}
        {panel?.kind === 'add' && (
          <EnrolPanel
            rec={null}
            onClose={() => setPanel(null)}
            onDone={(id) => {
              void mutate();
              setPanel({ kind: 'student', id });
            }}
          />
        )}
      </Panel>
    </>
  );
}
