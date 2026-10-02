'use client';

/* Invoices (original §11, renderFinance): KPIs, payment breakdown,
   collection-rate donut, ageing buckets, filtered table oldest-first,
   Print (INVOICE / RECEIPT), Mark paid with Undo, Export. The rebuild adds
   what the original had no screen for: creating and editing an invoice and
   recording a part payment with its method. */

import { useRef, useState } from 'react';
import useSWR from 'swr';
import { fetcher, patch, post } from '@/lib/client/api';
import { useStaff } from '@/components/staff/StaffContext';
import { Empty, ErrorCard, Field, Loading, Modal, Ok, downloadCsv, useToast } from '@/components/staff/ui';
import { Icon } from '@/components/staff/Icon';
import { PaymentModal } from '@/components/staff/money/PaymentModal';
import { docFoot, docHead, esc, printDoc } from '@/components/staff/money/print';
import { lkr } from '@/lib/shared/constants';
import { daysBetween, dPlus, fmtDate, todayISO } from '@/lib/shared/dates';

type Invoice = { id: number; ref: string; studentId: number | null; cust: string; date: string; amount: number; paid: number; due: string | null; method: string };
type Filter = 'all' | 'Outstanding' | 'Overdue' | 'Paid';

const balance = (o: Invoice) => o.amount - o.paid;
const daysOver = (o: Invoice) => (o.due ? daysBetween(o.due, todayISO()) : 0);
const statusOf = (o: Invoice): [string, string] => (balance(o) <= 0 ? ['Paid', 'bdg-green'] : daysOver(o) > 0 ? ['Overdue', 'bdg-action'] : ['Open', 'bdg-grey']);

function StatKpi({ label, val, delta, dir, color }: { label: string; val: string; delta?: string; dir?: 'up' | 'down' | 'flat' | null; color: string }) {
  const ar = dir === 'up' ? '▲ ' : dir === 'down' ? '▼ ' : '';
  return (
    <div className="stat-kpi">
      <div className="stripe" style={{ background: color }} />
      <div className="lbl">{label}</div>
      <div className="val">{val}</div>
      {delta && <div className={`dl ${dir === 'up' ? 'up' : dir === 'down' ? 'down' : 'flat'}`}>{ar + delta}</div>}
    </div>
  );
}

export default function FinancePage() {
  const { config } = useStaff();
  const { toastUndo, toastError, toast } = useToast();
  const { data, error, mutate } = useSWR<{ invoices: Invoice[] }>('/api/staff/invoices', fetcher);
  const [filter, setFilter] = useState<Filter>('all');
  const [edit, setEdit] = useState<Invoice | 'new' | null>(null);
  const [payFor, setPayFor] = useState<Invoice | null>(null);
  // invoices with a Mark paid in flight: a second tap is refused and its error would replace the Undo
  const marking = useRef(new Set<number>());

  if (error && !data) return <ErrorCard error={error} retry={() => mutate()} />;
  if (!data) return <Loading />;
  const O = data.invoices;

  /* THE TRUE TOTAL AND THE DIVISOR ARE TWO DIFFERENT NUMBERS: `denom` only
     guards the division, `total` is what is shown. */
  const total = O.reduce((s, o) => s + o.amount, 0);
  const denom = total || 1;
  const collected = O.reduce((s, o) => s + o.paid, 0);
  const outstanding = total - collected;
  const overdue = O.filter((o) => balance(o) > 0 && daysOver(o) > 0).reduce((s, o) => s + balance(o), 0);
  const pctc = Math.round((collected / denom) * 100);
  const awaiting = Math.max(0, outstanding - overdue);
  const CIR = 2 * Math.PI * 52;

  const bk: [string, number][] = [['Current', 0], ['1-30d', 0], ['31-60d', 0], ['61-90d', 0], ['90d+', 0]];
  for (const o of O) {
    const b = balance(o);
    if (b <= 0) continue;
    const d = daysOver(o);
    bk[d <= 0 ? 0 : d <= 30 ? 1 : d <= 60 ? 2 : d <= 90 ? 3 : 4][1] += b;
  }

  let rows = [...O];
  if (filter === 'Paid') rows = rows.filter((o) => balance(o) <= 0);
  else if (filter === 'Outstanding') rows = rows.filter((o) => balance(o) > 0);
  else if (filter === 'Overdue') rows = rows.filter((o) => balance(o) > 0 && daysOver(o) > 0);
  rows.sort((a, b) => daysOver(b) - daysOver(a));

  const markPaid = async (o: Invoice) => {
    if (marking.current.has(o.id)) return;
    marking.current.add(o.id);
    try {
      const r = await post<{ prev: { paid: number; method: string } }>(`/api/staff/invoices/${o.id}/pay`, { method: 'Cash' });
      const fresh = mutate();
      toastUndo(<Ok>{o.ref} marked paid</Ok>, async () => {
        await patch(`/api/staff/invoices/${o.id}`, r.prev).then(() => toast(<Ok>Undone</Ok>), toastError);
        mutate();
      });
      await fresh;
    } catch (e) {
      toastError(e);
    } finally {
      marking.current.delete(o.id);
    }
  };

  const recordPay = async (o: Invoice, d: { amount: number; method: string }) => {
    const r = await post<{ prev: { paid: number; method: string } }>(`/api/staff/invoices/${o.id}/pay`, { amount: d.amount, method: d.method });
    mutate();
    toastUndo(<Ok>Payment recorded · {o.ref}</Ok>, async () => {
      await patch(`/api/staff/invoices/${o.id}`, r.prev).then(() => toast(<Ok>Undone</Ok>), toastError);
      mutate();
    });
  };

  const printInvoice = (o: Invoice) => {
    const bal = balance(o);
    const paid = o.amount - bal;
    const st = statusOf(o);
    const inner =
      docHead(config.company, bal <= 0 ? 'RECEIPT' : 'INVOICE') +
      '<div style="display:flex;justify-content:space-between;gap:20px;font-size:12.5px;margin-bottom:14px">' +
      '<div><div style="color:#777">Billed to</div><b>' + esc(o.cust) + '</b></div>' +
      '<div style="text-align:right"><div style="color:#777">Reference</div><b>' + esc(o.ref) + '</b>' +
      '<div style="color:#777;margin-top:6px">Due</div><b>' + fmtDate(o.due) + '</b></div></div>' +
      '<table><thead><tr><th>Description</th><th class="tr">Amount</th></tr></thead><tbody><tr><td>' + esc(config.entity.singular + ' fees') + '</td><td class="tr">' + lkr(o.amount) + '</td></tr></tbody></table>' +
      '<div class="tot"><div class="box">' +
      '<div class="trow"><span>Invoiced</span><span>' + lkr(o.amount) + '</span></div>' +
      '<div class="trow"><span>Paid</span><span>' + lkr(paid) + '</span></div>' +
      '<div class="trow grand"><span>' + (bal <= 0 ? 'Settled in full' : 'Still to pay') + '</span><span>' + (bal <= 0 ? lkr(0) : lkr(bal)) + '</span></div></div></div>' +
      '<p style="font-size:12px;color:#555;margin-top:14px">' +
      (bal <= 0 ? 'This invoice has been paid in full. Thank you.' : 'Status: ' + esc(st[0]) + '. Please settle the balance above.') +
      '</p>' +
      docFoot(config.company);
    try {
      printDoc((bal <= 0 ? 'Receipt ' : 'Invoice ') + o.ref, inner);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const exportCsv = () =>
    downloadCsv(
      'finance.csv',
      ['Invoice', 'Customer', 'Invoiced', 'Paid', 'Balance', 'Due', 'Days over', 'Method'],
      O.map((o) => [o.ref, o.cust, o.amount, o.paid, balance(o), o.due ?? '', Math.max(0, daysOver(o)), o.method]),
    );

  return (
    <>
      <div className="stat-kpis">
        <StatKpi label="Invoiced" val={lkr(total)} delta={`${O.length} invoices`} color="var(--brand)" />
        <StatKpi label="Collected" val={lkr(collected)} delta={`${pctc}% of invoiced`} color="var(--green)" />
        <StatKpi label="Outstanding" val={lkr(outstanding)} delta="still to collect" color="var(--amber)" />
        <StatKpi label="Overdue" val={lkr(overdue)} delta={overdue > 0 ? 'chase now' : 'none overdue'} dir={overdue > 0 ? 'down' : 'flat'} color={overdue > 0 ? 'var(--danger)' : 'var(--faint)'} />
      </div>

      <div className="grid2" style={{ marginBottom: 20 }}>
        <div className="card">
          <div className="card-h">
            <h3>Payment breakdown</h3>
            <span className="hint">Where the money stands</span>
          </div>
          <div className="card-b">
            <div className="fin-bar">
              {collected > 0 && <div style={{ width: `${(collected / denom) * 100}%`, background: 'var(--green)' }} />}
              {awaiting > 0 && <div style={{ width: `${(awaiting / denom) * 100}%`, background: 'var(--amber)' }} />}
              {overdue > 0 && <div style={{ width: `${(overdue / denom) * 100}%`, background: 'var(--danger)' }} />}
            </div>
            <div className="fin-break">
              {(
                [
                  ['Collected', 'var(--green)', collected],
                  ['Awaiting', 'var(--amber)', awaiting],
                  ['Overdue', 'var(--danger)', overdue],
                ] as const
              ).map(([l, c, v]) => (
                <div className="fb" key={l}>
                  <div className="fbl">
                    <span className="dot" style={{ background: c }} />
                    {l}
                  </div>
                  <div className="fbv">{lkr(v)}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14, fontSize: 12.5, color: 'var(--muted)' }}>
              Awaiting payment: <b style={{ color: 'var(--amber)' }}>{lkr(awaiting)}</b> · Overdue to chase: <b style={{ color: 'var(--danger)' }}>{lkr(overdue)}</b>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-h">
            <h3>Collection rate</h3>
            <span className="hint">Collected vs invoiced</span>
          </div>
          <div className="card-b" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="fin-donut">
              <svg width="130" height="130" viewBox="0 0 130 130">
                <circle cx="65" cy="65" r="52" fill="none" stroke="var(--line)" strokeWidth="13" />
                <circle cx="65" cy="65" r="52" fill="none" stroke="var(--green)" strokeWidth="13" strokeLinecap="round" strokeDasharray={CIR} strokeDashoffset={CIR * (1 - pctc / 100)} transform="rotate(-90 65 65)" />
              </svg>
              <div className="fc">
                <div className="fp">{pctc}%</div>
                <div className="fpl">collected</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="aging-row">
        {bk.map(([l, v], i) => (
          <div key={l} className={`ag-box${i >= 2 && v > 0 ? ' over' : ''}`}>
            <div className="ag-l">{l}</div>
            <div className="ag-v">{lkr(v)}</div>
          </div>
        ))}
      </div>

      <div className="toolbar">
        <select className="filter" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Filter invoices">
          <option value="all">All invoices</option>
          <option value="Outstanding">Outstanding</option>
          <option value="Overdue">Overdue only</option>
          <option value="Paid">Paid</option>
        </select>
        <div className="sp" />
        <button className="btn-ghost" onClick={exportCsv}>
          <Icon name="download" />
          Export
        </button>
        <button className="btn-primary" onClick={() => setEdit('new')}>
          <Icon name="plus" className="" size={14} strokeWidth={2.5} /> New invoice
        </button>
      </div>

      <div className="card">
        <div className="card-h">
          <h3>Invoices &amp; collections</h3>
          <span className="hint">Balances to collect, oldest first</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Customer</th>
                <th className="tnum">Invoiced</th>
                <th className="tnum">Balance</th>
                <th>Due</th>
                <th>Aging</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {!rows.length ? (
                <tr>
                  <td colSpan={8} style={{ padding: 0 }}>
                    {filter !== 'all' ? (
                      <Empty
                        icon="money"
                        title={`Nothing ${filter.toLowerCase()}`}
                        sub="No invoice matches this filter. Clear it to see the rest."
                        cta={
                          <button className="btn-ghost" onClick={() => setFilter('all')}>
                            Show all invoices
                          </button>
                        }
                      />
                    ) : (
                      <Empty icon="money" title="No invoices yet" sub="Invoices appear here once a student is enrolled on a paid programme." />
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((o) => {
                  const st = statusOf(o);
                  const bal = balance(o);
                  const d = daysOver(o);
                  return (
                    <tr key={o.id}>
                      <td className="tn">
                        <button className="lk" style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 600, cursor: 'pointer', color: 'inherit' }} onClick={() => setEdit(o)} title="Edit invoice">
                          {o.ref}
                        </button>
                      </td>
                      <td>{o.cust}</td>
                      <td className="tnum">{lkr(o.amount)}</td>
                      <td className="tnum" style={bal > 0 ? { color: 'var(--danger)' } : undefined}>
                        {bal > 0 ? lkr(bal) : '-'}
                      </td>
                      <td className="tm">{fmtDate(o.due)}</td>
                      <td style={{ fontSize: 12.5, fontWeight: 600, color: bal > 0 && d > 0 ? 'var(--danger)' : 'var(--muted)' }}>
                        {bal <= 0 ? 'Settled' : d > 0 ? `${d}d over` : d === 0 ? 'due today' : `${Math.abs(d)}d left`}
                      </td>
                      <td>
                        <span className={`bdg ${st[1]}`}>{st[0]}</span>
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button className="btn-ghost" style={{ padding: '6px 11px' }} onClick={() => printInvoice(o)}>
                          Print
                        </button>
                        {bal > 0 && (
                          <>
                            {' '}
                            <button className="btn-ghost" style={{ padding: '6px 11px' }} onClick={() => setPayFor(o)}>
                              Record payment
                            </button>{' '}
                            <button className="btn-ghost" style={{ padding: '6px 11px' }} onClick={() => markPaid(o)}>
                              Mark paid
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <InvoiceModal
        inv={edit}
        onClose={() => setEdit(null)}
        onSaved={(msg) => {
          mutate();
          toast(<Ok>{msg}</Ok>);
        }}
      />
      <PaymentModal
        open={!!payFor}
        title={payFor ? `Record a payment · ${payFor.ref}` : ''}
        sub={payFor ? `${payFor.cust} · invoiced ${lkr(payFor.amount)}` : undefined}
        balance={payFor ? balance(payFor) : 0}
        withDate={false}
        onClose={() => setPayFor(null)}
        onSave={(d) => recordPay(payFor!, d)}
      />
    </>
  );
}

function InvoiceModal({ inv, onClose, onSaved }: { inv: Invoice | 'new' | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const isNew = inv === 'new';
  const cur = inv && inv !== 'new' ? inv : null;
  const [k, setK] = useState<string>('');
  const [cust, setCust] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [due, setDue] = useState(dPlus(todayISO(), 14));
  const [ref, setRef] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // reset the form whenever a different invoice (or "new") is opened
  const thisKey = inv === null ? '' : isNew ? 'new' : String(cur!.id);
  if (thisKey !== k) {
    setK(thisKey);
    setCust(cur?.cust ?? '');
    setAmount(cur ? String(cur.amount) : '');
    setDate(cur?.date ?? todayISO());
    setDue(cur?.due ?? dPlus(todayISO(), 14));
    setRef(cur?.ref ?? '');
    setErr({});
  }

  const save = async () => {
    const e: Record<string, string> = {};
    const n = parseInt(amount.replace(/[^0-9]/g, ''), 10) || 0;
    if (!cust.trim()) e.cust = 'Who is it billed to?';
    if (n <= 0) e.amount = 'Amount must be above zero';
    else if (cur && n < cur.paid) e.amount = `${lkr(cur.paid)} is already paid on this invoice`;
    if (!due) e.due = 'Pick a due date';
    setErr(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const b = { cust: cust.trim(), amount: n, date, due, ...(ref.trim() ? { ref: ref.trim() } : {}) };
      if (cur) await patch(`/api/staff/invoices/${cur.id}`, b);
      else await post('/api/staff/invoices', b);
      onSaved(cur ? 'Invoice saved' : 'Invoice created');
      onClose();
    } catch (x) {
      setErr({ form: (x as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={inv !== null}
      title={isNew ? 'New invoice' : `Edit ${cur?.ref ?? ''}`}
      onClose={onClose}
      width={460}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy} onClick={save}>
            {busy ? 'Saving' : isNew ? 'Create invoice' : 'Save invoice'}
          </button>
        </>
      }
    >
      <Field label="Billed to" error={err.cust}>
        <input value={cust} maxLength={120} placeholder="Student or parent name" onChange={(e) => setCust(e.target.value)} autoFocus />
      </Field>
      <Field label="Amount (LKR)" error={err.amount}>
        <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Issued">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Due" error={err.due}>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
      </div>
      <Field label="Reference">
        <input value={ref} maxLength={40} placeholder={isNew ? 'Left blank, it is numbered for you' : ''} onChange={(e) => setRef(e.target.value)} />
      </Field>
      {err.form && <div className="login-err">{err.form}</div>}
    </Modal>
  );
}
