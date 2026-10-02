'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { fetcher } from '@/lib/client/api';
import { CFG, lkr } from '@/lib/shared/constants';
import { colomboParts, DY_FULL, greetWord, MN, MN_FULL, fmtDate } from '@/lib/shared/dates';
import { Icon } from '@/components/staff/Icon';
import { BarChart, CountUp, Empty, ErrorCard, Loading } from '@/components/staff/ui';
import { useStaff } from '@/components/staff/StaffContext';
import { TaskModal, TaskRows } from '@/components/staff/crm/Tasks';
import { cohortLabel, type Task } from '@/components/staff/crm/types';

/* The LIVE dashboard is the tuition-fees one (the original's renderDashboard
   override at line 9320): greeting, money hero, four KPIs, fees chart, who
   owes then follow-ups, and the first four tasks. */

type Dash = {
  ym: string;
  fees: boolean;
  collected: number;
  expected: number;
  outstanding: number;
  toPay: number;
  prevOutstanding: number;
  prevPay: number;
  online: number;
  openEnquiries: number;
  dueToday: number;
  chart: { ym: string; v: number }[];
  owe: { id: number; name: string; cohort: number; owes: number; partial: boolean }[];
  followUps: { id: number; name: string; co: string; followUp: string }[];
  tasks: Task[];
};

function KpiC({ label, val, sub, accent, icon }: { label: string; val: ReactNode; sub: ReactNode; accent?: boolean; icon: string }) {
  return (
    <div className={`kpi${accent ? ' accent' : ''}`}>
      <div className="kpi-top">
        <div className="lbl">{label}</div>
        <div className="kt">
          <Icon name={icon} />
        </div>
      </div>
      <div className="val">{typeof val === 'number' ? <CountUp to={val} fmt="int" /> : val}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}

export default function DashboardPage() {
  const { me, can, config } = useStaff();
  const router = useRouter();
  const { data, error, mutate } = useSWR<Dash>('/api/staff/dashboard', fetcher);
  const [adding, setAdding] = useState(false);

  if (error) return <ErrorCard error={error} retry={() => void mutate()} />;
  if (!data) return <Loading />;

  const now = colomboParts();
  const pctc = data.expected ? Math.min(100, Math.round((data.collected / data.expected) * 100)) : 0;
  const month = MN_FULL[now.m - 1];
  const dueN = data.dueToday;
  const feesHref = can('fees.manage') ? '/staff/recurring' : null;

  return (
    <>
      <div id="greet" style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.5px' }}>
          {greetWord(now.h)}, {me.name}
        </h1>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 5 }}>
          {DY_FULL[now.dow]} {now.d} {month} ·{' '}
          {dueN ? `${dueN} follow-up${dueN > 1 ? 's' : ''} due today` : 'fees, students and enquiries at a glance'}
        </div>
      </div>

      {data.fees && (
      <div className="hero-money">
        <div className="hm-cell">
          <div className="hm-label">Collected · {month}</div>
          <div className="hm-val">
            <CountUp to={data.collected} fmt="lkr" />
          </div>
          <div className="hm-track">
            <div className="hm-fill" style={{ width: `${pctc}%` }} />
          </div>
          <div className="hm-sub">
            {pctc}% of {lkr(data.expected)} expected
          </div>
        </div>
        <div className="hm-cell">
          <div className="hm-label">Outstanding</div>
          <div className="hm-val">
            <CountUp to={data.outstanding} fmt="lkr" />
          </div>
          <div className="hm-sub">
            {data.toPay} student{data.toPay === 1 ? '' : 's'} still to pay
          </div>
        </div>
      </div>
      )}

      <div className="kpis">
        {data.fees && <KpiC label="Outstanding this month" val={lkr(data.outstanding)} sub={`${data.toPay} still to pay`} icon="warn" />}
        {data.fees && <KpiC
          label="Outstanding last month"
          val={lkr(data.prevOutstanding)}
          sub={data.prevPay ? `${data.prevPay} still owed` : 'all cleared'}
          icon="money"
        />}
        <KpiC label="Online students" val={data.online} sub="active online" icon="users" />
        <KpiC
          label={`New ${config.entity.plural.toLowerCase()}`}
          val={data.openEnquiries}
          sub={dueN ? `${dueN} due today` : 'potential converts'}
          accent
          icon="inbox"
        />
      </div>

      {data.fees && (
      <div className="card">
        <div className="card-h">
          <h3>Fees collected, last 6 months</h3>
          <span className="hint">Collected by month ({CFG.currency})</span>
        </div>
        <div className="card-b">
          <BarChart
            h={150}
            data={data.chart.map((c) => ({
              label: MN[+c.ym.split('-')[1] - 1],
              v: c.v,
              hi: c.ym === data.ym,
              top: `${Math.round(c.v / 1000)}k`,
              full: lkr(c.v),
            }))}
          />
        </div>
      </div>
      )}

      <div className="grid2">
        <div className="card">
          <div className="card-h">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="flame" style={{ color: 'var(--brand)', width: 16, height: 16 }} />
              Needs attention today
            </h3>
            <span className="hint">Students who owe, then follow-ups</span>
          </div>
          <div className="card-b">
            {!data.owe.length && !data.followUps.length ? (
              // a role without fees sees no debtors at all, so "all collected" would be a claim it cannot make
              data.fees ? (
                <Empty icon="check" title="All collected" sub={`Every student has paid for ${month}.`} />
              ) : (
                <Empty icon="check" title="Nothing due" sub="No follow-ups are due today." />
              )
            ) : (
              <>
                {data.owe.map((o) => (
                  <div key={`o${o.id}`} className="aq-item" onClick={() => feesHref && router.push(feesHref)} style={feesHref ? undefined : { cursor: 'default' }}>
                    <span className="aq-dot" style={{ background: o.partial ? 'var(--amber)' : 'var(--danger)' }} />
                    <div className="aq-main">
                      <div className="aq-nm">{o.name}</div>
                      <div className="aq-why">
                        {cohortLabel(o.cohort)} · owes {lkr(o.owes)}
                      </div>
                    </div>
                    <span className="aq-act">Collect</span>
                  </div>
                ))}
                {data.followUps.map((r) => (
                  <Link key={`f${r.id}`} href={`/staff/records?open=${r.id}`} className="aq-item" prefetch={false} style={{ color: 'inherit', textDecoration: 'none' }}>
                    <span className="aq-dot" style={{ background: 'var(--danger)' }} />
                    <div className="aq-main">
                      <div className="aq-nm">
                        {r.name} <span className="bdg bdg-action">DUE</span>
                      </div>
                      <div className="aq-why">
                        {r.co ? `${r.co} · ` : ''}follow-up {fmtDate(r.followUp)}
                      </div>
                    </div>
                    <span className="aq-act">Call now</span>
                  </Link>
                ))}
              </>
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-h">
            <h3>Tasks</h3>
            <button className="btn-ghost" onClick={() => setAdding(true)} style={{ padding: '6px 12px' }}>
              <Icon name="plus" strokeWidth={2.4} />
              Add
            </button>
          </div>
          <div className="card-b">
            <TaskRows list={data.tasks} onChange={() => void mutate()} onAdd={() => setAdding(true)} />
          </div>
        </div>
      </div>
      <TaskModal open={adding} onClose={() => setAdding(false)} onSaved={() => void mutate()} />
    </>
  );
}
