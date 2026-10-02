'use client';

/* Fee collection — the hero ledger (original §10, renderRecurring).
   The server returns every plan charged in the month with what it has paid
   and how many months it is behind; the filters, the hero figures and the
   ageing board are the original's maths over that list. */

import { useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { fetcher, post } from '@/lib/client/api';
import { useStaff } from '@/components/staff/StaffContext';
import { CountUp, ErrorCard, Loading, Ok, downloadCsv, useToast } from '@/components/staff/ui';
import { Icon } from '@/components/staff/Icon';
import { openReceipt } from '@/components/staff/docs';
import { MonthSwitch } from '@/components/staff/money/MonthSwitch';
import { PaymentModal } from '@/components/staff/money/PaymentModal';
import { CFG, COHORT_SHORT, init2, lkr, waLink } from '@/lib/shared/constants';
import { monthLbl, monthShort, ymNow, ymShift } from '@/lib/shared/dates';

type Plan = {
  id: number;
  name: string;
  phone: string;
  cohort: number;
  program: string;
  co: string;
  level: string;
  fee: number;
  got: number;
  monthsOwed: number;
  owedAmount: number;
};
type Ledger = { ym: string; first: string; collected: number; plans: Plan[] };
type Undo = { id: number; created: boolean; prev?: { amount: number; status: string; method: string; paidAt: string | null } };
type Status = 'all' | 'paid' | 'partial' | 'owing';
type Age = 'all' | 'paid' | 'm1' | 'm2' | 'm3';

const AGE_BUCKETS: [Exclude<Age, 'all'>, string, string, string][] = [
  ['paid', 'Paid', 'var(--green)', 'Paid up to date'],
  ['m1', '1 month', 'var(--amber)', 'One month behind'],
  ['m2', '2 months', 'var(--orange)', 'Two months behind'],
  ['m3', '3+ months', 'var(--danger)', 'Three months or more behind'],
];

const stateOf = (p: Plan): 'paid' | 'partial' | 'owing' => (p.got >= p.fee ? 'paid' : p.got > 0 ? 'partial' : 'owing');
const bucketOf = (n: number): Exclude<Age, 'all'> => (n === 0 ? 'paid' : n === 1 ? 'm1' : n === 2 ? 'm2' : 'm3');
const first = (name: string) => name.split(' ')[0];

export default function FeesPage() {
  const { config, refreshBadges } = useStaff();
  const { toast, toastUndo, toastError } = useToast();
  const [ym, setYm] = useState(ymNow());
  const [status, setStatus] = useState<Status>('all');
  const [cohort, setCohort] = useState<'all' | string>('all');
  const [age, setAge] = useState<Age>('all');
  const [q, setQ] = useState('');
  const [partFor, setPartFor] = useState<Plan | null>(null);
  // plans with a Mark paid in flight: a second tap would be refused as already paid
  // and its error toast would replace the first one's Undo
  const marking = useRef(new Set<number>());

  const key = `/api/staff/fees?ym=${ym}`;
  const { data, error, mutate, isLoading } = useSWR<Ledger>(key, fetcher, { keepPreviousData: true });

  const label = config.recurring.label;
  const cohortsOn = config.modules.cohorts !== false;
  const term = q.trim().toLowerCase();

  const view = useMemo(() => {
    const plans = data?.plans ?? [];
    const filt = (list: Plan[]) => list.filter((p) => (cohort === 'all' || String(p.cohort) === cohort) && (!term || p.name.toLowerCase().includes(term)));
    const paid = plans.filter((p) => stateOf(p) === 'paid');
    const partial = plans.filter((p) => stateOf(p) === 'partial');
    const owing = plans.filter((p) => stateOf(p) === 'owing');
    let expected = 0;
    let outstanding = 0;
    for (const p of plans) {
      expected += p.fee;
      if (p.got < p.fee) outstanding += p.fee - Math.max(0, p.got);
    }
    const filtered = filt(plans);
    /* THE HEADLINE MUST DESCRIBE WHAT IS ON SCREEN: with a filter on, the
       figures come from the filtered set and the label says so. */
    const narrowed = filtered.length !== plans.length || status !== 'all';
    const set = status === 'paid' ? filt(paid) : status === 'partial' ? filt(partial) : status === 'owing' ? filt(owing) : filtered;
    let hero = { collected: data?.collected ?? 0, expected, outstanding, toPay: owing.length + partial.length };
    if (narrowed) {
      let e = 0, c = 0, o = 0, n = 0;
      for (const p of set) {
        e += p.fee;
        c += p.got;
        if (p.got < p.fee) {
          o += p.fee - p.got;
          n++;
        }
      }
      hero = { collected: c, expected: e, outstanding: o, toPay: n };
    }
    const order = { owing: 0, partial: 1, paid: 2 };
    const show = [...set].sort((a, b) => order[stateOf(a)] - order[stateOf(b)]);
    const aging: Record<Exclude<Age, 'all'>, Plan[]> = { paid: [], m1: [], m2: [], m3: [] };
    for (const p of plans) aging[bucketOf(p.monthsOwed)].push(p);
    return { plans, filtered, narrowed, hero, show, aging, counts: { paid: filt(paid).length, partial: filt(partial).length, owing: filt(owing).length } };
  }, [data, cohort, term, status]);

  // the hero counts up from the figure shown before (original data-from)
  const [hero, setHero] = useState({ from: 0, to: 0 });
  if (hero.to !== view.hero.collected) setHero({ from: hero.to, to: view.hero.collected });

  if (error && !data) return <ErrorCard error={error} retry={() => mutate()} />;
  if (!data) return <Loading />;

  const pct = view.hero.expected ? Math.min(100, Math.round((view.hero.collected / view.hero.expected) * 100)) : 0;
  const from = hero.from;

  const shift = (n: number) => {
    const t = ymShift(ym, n);
    if (t > ymNow() || t < data.first) return;
    setYm(t);
  };

  const after = () => {
    refreshBadges();
    return mutate();
  };

  const undoPay = (u: Undo) => async () => {
    try {
      await post('/api/staff/fees/undo', u);
      after();
      toast('Undone');
    } catch (e) {
      toastError(e);
    }
  };

  const receipt = async (id: number) => {
    try {
      const rno = await openReceipt({ studentId: id, month: ym });
      toast(<Ok>Receipt {rno} ready</Ok>);
    } catch (e) {
      toastError(e);
    }
  };

  const mark = async (p: Plan) => {
    if (p.fee - p.got <= 0 || marking.current.has(p.id)) return;
    marking.current.add(p.id);
    try {
      const r = await post<{ undo: Undo; amount: number }>('/api/staff/fees/pay', { planId: p.id, month: ym, method: 'Cash' });
      const fresh = after();
      toastUndo(
        <>
          <Icon name="check" strokeWidth={2.6} /> {first(p.name)} paid · {lkr(r.amount)}
          <button className="t-act" onClick={() => receipt(p.id)}>
            Receipt
          </button>
        </>,
        undoPay(r.undo),
      );
      await fresh; // the row stays guarded until the list shows it paid
    } catch (e) {
      toastError(e);
    } finally {
      marking.current.delete(p.id);
    }
  };

  const recordPart = async (p: Plan, d: { amount: number; method: string; paidAt: string }) => {
    const r = await post<{ undo: Undo; amount: number; settled: boolean }>('/api/staff/fees/pay', { planId: p.id, month: ym, ...d });
    after();
    toastUndo(
      <>
        <Icon name="check" strokeWidth={2.6} /> {first(p.name)} {r.settled ? 'paid' : 'part paid'} · {lkr(r.amount)}
        <button className="t-act" onClick={() => receipt(p.id)}>
          Receipt
        </button>
      </>,
      undoPay(r.undo),
    );
  };

  const remind = (p: Plan) => {
    if (!p.phone.replace(/\D/g, '')) return toast('No number saved');
    const msg = config.recurring.waRemind
      .replaceAll('{name}', first(p.name))
      .replaceAll('{month}', monthLbl(ym).split(' ')[0])
      .replaceAll('{label}', label.toLowerCase())
      .replaceAll('{amount}', lkr(p.fee - p.got));
    window.open(waLink(p.phone, msg), '_blank', 'noopener');
  };

  const receivedWa = (p: Plan) => {
    if (!p.phone.replace(/\D/g, '')) return toast('No number saved');
    if (p.got <= 0) return toast(`No payment recorded for ${monthLbl(ym)} yet`);
    const msg = `Hi ${first(p.name)}, thank you. Your ${monthLbl(ym)} class fee of ${lkr(p.got)} has been received. Your receipt is attached. — Leon, Academy of Business Studies`;
    window.open(waLink(p.phone, msg), '_blank', 'noopener');
  };

  const chaseText = (p: Plan) =>
    p.monthsOwed === 0
      ? `Hi ${first(p.name)}, thank you, your fees are up to date.`
      : `Hi ${first(p.name)}, this is a reminder from ${CFG.app.client}. ` +
        (p.monthsOwed === 1 ? 'Your fee for this month' : `${p.monthsOwed} months of fees`) +
        ` is still outstanding, ${lkr(p.owedAmount)} in total. Please let us know if you have already paid so we can update our records.`;

  const exportCsv = () =>
    downloadCsv(
      `fees-${ym}.csv`,
      ['Student', 'Batch', 'Program', `${label} (${CFG.currency})`, 'Paid', 'Balance', 'Status', 'Months behind', 'Owed in total', 'WhatsApp'],
      view.show.map((p) => [p.name, CFG.cohorts[p.cohort] ?? '', p.program, p.fee, p.got, Math.max(0, p.fee - p.got), stateOf(p), p.monthsOwed, p.owedAmount, p.phone]),
    );

  const chase = age !== 'all' ? view.aging[age] : null;
  const ageInfo = AGE_BUCKETS.find((b) => b[0] === age);
  const words = config.contactWord;

  return (
    <>
      <div className="toolbar">
        <MonthSwitch ym={ym} onShift={shift} prevDisabled={ymShift(ym, -1) < data.first} nextDisabled={ymShift(ym, 1) > ymNow()} />
        {isLoading && <span className="hint">Loading…</span>}
        <div className="sp" />
        <input className="search" placeholder="Search…" style={{ width: 180 }} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search plans" />
        <button className="btn-ghost" onClick={exportCsv}>
          <Icon name="download" />
          Export
        </button>
      </div>

      <div className="pay-hero">
        <div className="ph-lbl">
          Collected · {monthShort(ym)}
          {view.narrowed && (
            <>
              {' · '}
              <b>these {view.filtered.length} only</b>
            </>
          )}
        </div>
        <div className="ph-val">
          <CountUp to={view.hero.collected} from={from} fmt="lkr" />
        </div>
        <div className="ph-sub">
          of {lkr(view.hero.expected)} expected · {pct}%
        </div>
        <div className="ph-track">
          <div className="ph-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="ph-foot">
          <span>
            <b>{lkr(view.hero.outstanding)}</b> outstanding
          </span>
          <span>{view.hero.toPay} to collect</span>
        </div>
      </div>

      <div className="pay-segs">
        {(
          [
            ['paid', 'Paid', view.counts.paid, 'var(--green)'],
            ['partial', 'Partial', view.counts.partial, 'var(--amber)'],
            ['owing', 'Owing', view.counts.owing, 'var(--danger)'],
          ] as const
        ).map(([k, l, n, c]) => (
          <button key={k} className={`seg seg-${k}${status === k ? ' on' : ''}`} aria-pressed={status === k} onClick={() => setStatus(status === k ? 'all' : k)}>
            <div className="sv">{n}</div>
            <div className="sl">
              <span className="dot" style={{ background: c }} />
              {l}
            </div>
          </button>
        ))}
      </div>

      {/* THE AGEING BOARD. Counts of STUDENTS: 4 of 15. */}
      <div className="age-row" role="group" aria-label="Who is behind on fees">
        {AGE_BUCKETS.map(([k, l, c, tip]) => (
          <button key={k} className={`age-box${age === k ? ' on' : ''}`} aria-pressed={age === k} title={tip} onClick={() => setAge(age === k ? 'all' : k)}>
            <span className="age-dot" style={{ background: c }} />
            <span className="age-n">{view.aging[k].length}</span>
            <span className="age-of">of {view.plans.length}</span>
            <span className="age-l">{l}</span>
          </button>
        ))}
      </div>

      {chase && ageInfo && (
        <div>
          <div className="card-h">
            <div>
              <b>
                {chase.length} {(chase.length === 1 ? words.singular : words.plural).toLowerCase()}
              </b>
              <div className="hint">
                {ageInfo[3]}
                {age === 'paid' ? '' : '. The message is written for you. You press send.'}
              </div>
            </div>
            <button className="btn-ghost" onClick={() => setAge('all')}>
              Show everyone
            </button>
          </div>
          <div>
            {chase.length ? (
              chase.map((p) => {
                const ph = p.phone.replace(/[^0-9]/g, '');
                return (
                  <div className="chase-row" key={p.id}>
                    <div className="grow">
                      <div className="tn">{p.name}</div>
                      <div className="hint">
                        {p.monthsOwed ? `${p.monthsOwed} month${p.monthsOwed === 1 ? '' : 's'} behind · ${lkr(p.owedAmount)}` : 'up to date'}
                        {` · ${COHORT_SHORT[p.cohort] ?? ''} Batch`}
                      </div>
                    </div>
                    {p.monthsOwed && ph ? (
                      <a className="btn-ghost" target="_blank" rel="noopener noreferrer" href={waLink(p.phone, chaseText(p))}>
                        Remind on WhatsApp
                      </a>
                    ) : (
                      <span className="hint">{p.monthsOwed ? 'No number on file' : '✓'}</span>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="hint" style={{ padding: '14px 20px' }}>
                Nobody is in this group. Good.
              </div>
            )}
          </div>
        </div>
      )}

      {cohortsOn && (
        <div className="pay-chips">
          {[['all', 'All groups'] as const, ...CFG.cohorts.map((c, i) => [String(i), c] as const)].map(([k, l]) => (
            <button key={k} className={`chip${cohort === k ? ' on' : ''}`} aria-pressed={cohort === k} onClick={() => setCohort(k)}>
              {l}
            </button>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-b">
          {view.show.length ? (
            view.show.map((p) => {
              const st = stateOf(p);
              const meta = (cohortsOn ? `${(CFG.cohorts[p.cohort] ?? '').replace(' Batch', '')} · ` : '') + (p.program ? `${p.program} · ` : '') + lkr(p.fee);
              return (
                <div className="pay-row" key={p.id}>
                  <div className="pr-av">{init2(p.name)}</div>
                  <div className="pr-main">
                    <div className="pr-nm">
                      <span className={`sdot s-${p.level}`} />
                      {p.name}
                    </div>
                    <div className="pr-mt">
                      {meta}
                      {p.monthsOwed > 1 ? ` · ${p.monthsOwed} months behind` : ''}
                    </div>
                  </div>
                  <div className="pr-act">
                    {st === 'owing' && (
                      <>
                        <button className="btn-rcpt" title="Part payment, another method or date" aria-label={`Record a payment for ${p.name}`} onClick={() => setPartFor(p)}>
                          <Icon name="money" />
                          <span className="rc-t">Part</span>
                        </button>
                        <button className="btn-mark" onClick={() => mark(p)}>
                          <Icon name="check" />
                          Mark paid
                        </button>
                        <button className="btn-wa" title="Remind on WhatsApp" aria-label="Remind on WhatsApp" onClick={() => remind(p)}>
                          <Icon name="wa" />
                        </button>
                      </>
                    )}
                    {st === 'partial' && (
                      <>
                        <span className="pr-pill pill-partial">
                          {p.got.toLocaleString()} / {p.fee.toLocaleString()}
                        </span>
                        <button className="btn-rcpt" onClick={() => receipt(p.id)} aria-label={`Receipt for ${p.name}`}>
                          <Icon name="doc" />
                          <span className="rc-t">Receipt</span>
                        </button>
                        <button className="btn-rcpt" title="Record another part payment" aria-label={`Record a payment for ${p.name}`} onClick={() => setPartFor(p)}>
                          <Icon name="money" />
                          <span className="rc-t">Part</span>
                        </button>
                        <button className="btn-mark" onClick={() => mark(p)}>
                          <Icon name="check" />
                          Complete
                        </button>
                      </>
                    )}
                    {st === 'paid' && (
                      <>
                        <span className="pr-pill pill-paid">
                          <Icon name="check" />
                          Paid
                        </span>
                        <button className="btn-rcpt" onClick={() => receipt(p.id)} aria-label={`Receipt for ${p.name}`}>
                          <Icon name="doc" />
                          <span className="rc-t">Receipt</span>
                        </button>
                        <button className="btn-wa" title="Tell them on WhatsApp the fee is received" aria-label={`WhatsApp ${p.name} about the receipt`} onClick={() => receivedWa(p)}>
                          <Icon name="wa" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="empty" style={{ padding: '30px 8px' }}>
              <div className="es-ic">
                <Icon name="money" />
              </div>
              <div className="es-t">Nothing here</div>
              No plans match this filter.
            </div>
          )}
        </div>
      </div>

      <PaymentModal
        open={!!partFor}
        title={partFor ? `Record a payment · ${first(partFor.name)}` : ''}
        sub={partFor ? `${monthLbl(ym)} ${label.toLowerCase()} of ${lkr(partFor.fee)}${partFor.got ? `, ${lkr(partFor.got)} paid so far` : ''}.` : undefined}
        balance={partFor ? partFor.fee - partFor.got : 0}
        onClose={() => setPartFor(null)}
        onSave={(d) => recordPart(partFor!, d)}
      />
    </>
  );
}
