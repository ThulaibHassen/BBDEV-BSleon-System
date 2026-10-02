'use client';

/* Reports (original §12, renderReports): month switcher, compare-with
   select, KPIs, compare card, 6-month trend, who enrolled them, top
   enrolments, insights, CSV export and the printed SALES REPORT.

   A PART MONTH IS NOT A MONTH: while the selected month is still running
   the KPIs show no percentage at all, only "day d of n, still running".
   Records carry their month, not the day they were won, so there is no
   honest pace-for-pace comparison; the full comparison returns when the
   month closes. */

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { fetcher } from '@/lib/client/api';
import { useStaff } from '@/components/staff/StaffContext';
import { BarChart, Empty, ErrorCard, Loading, downloadCsv, useToast } from '@/components/staff/ui';
import { Icon } from '@/components/staff/Icon';
import { MonthSwitch } from '@/components/staff/money/MonthSwitch';
import { docFoot, docHead, esc, printDoc } from '@/components/staff/money/print';
import { CFG, init2, lkr } from '@/lib/shared/constants';
import { MN, monthLbl, monthShort, ymNow, ymShift } from '@/lib/shared/dates';

type Report = {
  ym: string;
  prev: string;
  running: boolean;
  day: number;
  daysIn: number;
  cur: { rev: number; won: number; created: number };
  prv: { rev: number; won: number; created: number };
  trend: { ym: string; v: number; n: number }[];
  byOwner: { name: string; v: number }[];
  top: { id: number; name: string; co: string; value: number }[];
  wins: { name: string; co: string; owner: string; value: number }[];
  open: { n: number; weighted: number };
};

const pct = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : a ? 100 : 0);
const dir = (v: number): 'up' | 'down' | 'flat' => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');

function StatKpi({ label, val, delta, d, color }: { label: string; val: string | number; delta: string; d: 'up' | 'down' | 'flat'; color: string }) {
  const ar = d === 'up' ? '▲ ' : d === 'down' ? '▼ ' : '';
  return (
    <div className="stat-kpi">
      <div className="stripe" style={{ background: color }} />
      <div className="lbl">{label}</div>
      <div className="val">{val}</div>
      <div className={`dl ${d}`}>{ar + delta}</div>
    </div>
  );
}

export default function ReportsPage() {
  const { config } = useStaff();
  const { toast } = useToast();
  const [ym, setYm] = useState(ymNow());
  const [cmp, setCmp] = useState<string | null>(null);
  const { data, error, mutate } = useSWR<Report>(`/api/staff/reports?ym=${ym}${cmp ? `&cmp=${cmp}` : ''}`, fetcher, { keepPreviousData: true });

  if (error && !data) return <ErrorCard error={error} retry={() => mutate()} />;
  if (!data) return <Loading />;

  const { cur, prv, prev, running } = data;
  const plural = config.entity.plural.toLowerCase();
  const bLbl = monthShort(prev).split(' ')[0];
  const aov = cur.won ? cur.rev / cur.won : 0;
  const paov = prv.won ? prv.rev / prv.won : 0;
  const winRate = cur.created ? Math.round((cur.won / cur.created) * 100) : 0;
  const pWin = prv.created ? Math.round((prv.won / prv.created) * 100) : 0;
  const paceNote = running ? ` · day ${data.day} of ${data.daysIn}, still running` : ` vs ${bLbl}`;
  const deltaLbl = (a: number, b: number) => (running ? '' : `${Math.abs(pct(a, b))}%`);
  const deltaDir = (a: number, b: number) => (running ? 'flat' : dir(pct(a, b)));

  const shift = (n: number) => {
    const t = ymShift(ym, n);
    if (t > ymNow()) return;
    setYm(t);
    setCmp(null);
  };
  const quick = (kind: 'prev' | 'year') => setCmp(kind === 'year' ? ymShift(ym, -12) : ymShift(ym, -1));

  const cmpRows: [string, string | number, string | number, number, string][] = [
    ['Revenue', lkr(cur.rev), lkr(prv.rev), pct(cur.rev, prv.rev), '%'],
    ['Enrolled', cur.won, prv.won, pct(cur.won, prv.won), '%'],
    ['Avg', lkr(aov), lkr(paov), pct(aov, paov), '%'],
    ['Enrol rate', `${winRate}%`, `${pWin}%`, winRate - pWin, 'pp'],
  ];

  const maxO = Math.max(1, ...data.byOwner.map((o) => o.v));
  const ins: string[] = [];
  const pr = pct(cur.rev, prv.rev);
  ins.push(pr >= 0 ? `Revenue is up ${pr}% versus ${monthLbl(prev)}.` : `Revenue dipped ${Math.abs(pr)}% versus ${monthLbl(prev)} — chase the open enquiries.`);
  if (data.byOwner.length) ins.push(`${data.byOwner[0].name} brought in the most this month (${lkr(data.byOwner[0].v)}).`);
  ins.push(`Enrol rate is ${winRate}% (${cur.won} of ${cur.created} ${plural} created).`);
  ins.push(`Open enquiries are worth ${lkr(data.open.weighted)} (weighted) across ${data.open.n} open ${plural}.`);

  const exportCsv = () =>
    downloadCsv(
      'bswl-report.csv',
      ['Month', 'Enrolled', `Enrolment value (${CFG.currency})`],
      data.trend.map((t) => [monthLbl(t.ym), t.n, t.v]),
    );

  const print = () => {
    const rows =
      data.wins.map((r) => '<tr><td>' + esc(r.name) + '</td><td>' + esc(r.co) + '</td><td>' + esc(r.owner) + '</td><td class="tr">' + lkr(r.value) + '</td></tr>').join('') ||
      '<tr><td colspan="4" style="color:#999">No wins this month</td></tr>';
    const inner =
      docHead(config.company, 'SALES REPORT') +
      '<div style="font-size:12.5px;margin-bottom:8px"><b>' + monthLbl(ym) + '</b> · ' + cur.won + ' deals · ' + lkr(cur.rev) + ' revenue</div>' +
      '<table><thead><tr><th>Customer</th><th>Detail</th><th>Owner</th><th class="tr">Value</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="tot"><div class="box"><div class="trow grand"><span>Total revenue</span><span>' + lkr(cur.rev) + '</span></div></div></div>' +
      docFoot(config.company);
    try {
      printDoc(`Sales Report ${monthLbl(ym)}`, inner);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const cmpOptions = Array.from({ length: 18 }, (_, i) => ymShift(ym, -(i + 1)));

  return (
    <>
      <div className="toolbar">
        <MonthSwitch ym={ym} onShift={shift} nextDisabled={ym >= ymNow()} />
        <div className="sp" />
        <button className="btn-ghost" onClick={print}>
          <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <polyline points="6 9 6 2 18 2 18 9" />
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
            <rect x="6" y="14" width="12" height="8" />
          </svg>
          Print / PDF
        </button>
        <button className="btn-ghost" onClick={exportCsv}>
          <Icon name="download" />
          Export
        </button>
      </div>

      <div className="stat-kpis">
        <StatKpi label="Revenue" val={lkr(cur.rev)} delta={deltaLbl(cur.rev, prv.rev) + paceNote} d={deltaDir(cur.rev, prv.rev)} color="var(--brand)" />
        <StatKpi label="Enrolled" val={cur.won} delta={deltaLbl(cur.won, prv.won) + paceNote} d={deltaDir(cur.won, prv.won)} color="var(--green)" />
        <StatKpi label="Avg enrolment" val={lkr(aov)} delta={deltaLbl(aov, paov) + paceNote} d={deltaDir(aov, paov)} color="var(--amber)" />
        <StatKpi label="Enrol rate" val={`${winRate}%`} delta={`${Math.abs(winRate - pWin)}pp vs ${bLbl}`} d={dir(winRate - pWin)} color="var(--blue)" />
      </div>

      <div className="card">
        <div className="card-h" style={{ flexWrap: 'wrap', gap: 10 }}>
          <h3>
            {monthLbl(ym)} vs {monthLbl(prev)}
          </h3>
          <div className="rp-cmp-ctl">
            <span className="rp-cmp-vs">compare with</span>
            <select className="filter" value={prev} onChange={(e) => setCmp(e.target.value)} aria-label="Compare with">
              {cmpOptions.map((m) => (
                <option key={m} value={m}>
                  {monthLbl(m)}
                </option>
              ))}
            </select>
            <button className={`rp-quick${prev === ymShift(ym, -1) ? ' on' : ''}`} onClick={() => quick('prev')}>
              Previous month
            </button>
            <button className={`rp-quick${prev === ymShift(ym, -12) ? ' on' : ''}`} onClick={() => quick('year')}>
              Same month last year
            </button>
          </div>
        </div>
        <div className="card-b">
          <div className="cmp-grid">
            {cmpRows.map(([l, v, pv, delta, unit]) => {
              const up = delta >= 0;
              return (
                <div key={l} className={`cmp-item ${up ? 'up' : 'down'}`}>
                  <div className="cl">{l}</div>
                  <div className="cv">{v}</div>
                  <div className="cvs">vs {pv}</div>
                  <div className={`cd ${up ? 'up' : 'down'}`}>
                    {up ? '▲' : '▼'} {Math.abs(delta)}
                    {unit}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <h3>Enrolment trend</h3>
          <span className="hint">Fees collected, last 6 months</span>
        </div>
        <div className="card-b">
          <BarChart
            h={150}
            data={data.trend.map((t) => ({ label: MN[+t.ym.slice(5, 7) - 1], v: t.v, hi: t.ym === ym, top: `${(t.v / 1e6).toFixed(1)}M`, full: lkr(t.v) }))}
          />
        </div>
      </div>

      <div className="grid2" style={{ marginBottom: 20 }}>
        <div className="card">
          <div className="card-h">
            <h3>Who enrolled them</h3>
            <span className="hint">By team member, this month</span>
          </div>
          <div className="card-b">
            {data.byOwner.length ? (
              data.byOwner.map((o) => (
                <div className="fn-row" key={o.name}>
                  <div className="fn-name">{o.name}</div>
                  <div className="fn-bar">
                    <div className="fn-fill" style={{ width: `${(o.v / maxO) * 100}%` }} />
                  </div>
                  <div className="fn-v">{lkr(o.v)}</div>
                </div>
              ))
            ) : (
              <Empty icon="users" title="No wins yet" sub="Closed deals split by owner appear here." />
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-h">
            <h3>Top enrolments</h3>
            <span className="hint">{monthLbl(ym)}</span>
          </div>
          <div className="card-b">
            {data.top.length ? (
              data.top.map((r) => (
                <Link key={r.id} className="eq-row" href={`/staff/records?open=${r.id}`} prefetch={false} style={{ color: 'inherit', textDecoration: 'none' }}>
                  <div className="eq-av">{init2(r.name)}</div>
                  <div className="eq-main">
                    <div className="eq-nm">{r.name}</div>
                    <div className="eq-mt">{r.co}</div>
                  </div>
                  <div className="eq-val">{lkr(r.value)}</div>
                </Link>
              ))
            ) : (
              <Empty icon="trend" title="No deals" sub="Wins this month show here." />
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <h3>What the numbers say</h3>
        </div>
        <div className="card-b" style={{ padding: '14px 20px', fontSize: 13.5, lineHeight: 1.7 }}>
          {ins.map((t) => (
            <div key={t} style={{ marginBottom: 8, paddingLeft: 14, borderLeft: '3px solid var(--brand)' }}>
              {t}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
