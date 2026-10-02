'use client';

/* The student panel (openCustomer): standing, summary, attendance, edit
   (both rows, fee follows the list price only if it still is the list
   price), remove (refused once money exists), fee history and the referral
   cadence. */

import { useState } from 'react';
import useSWR from 'swr';
import { useRouter } from 'next/navigation';
import { ApiError, del, fetcher, patch, post } from '@/lib/client/api';
import { BSWL_PROGRAMS, CFG, COHORT_SHORT, LOC_LABEL, PROG_LABEL, lkr, waLink } from '@/lib/shared/constants';
import { dPlus, fmtDate, todayISO } from '@/lib/shared/dates';
import { Icon } from '../Icon';
import { ErrorCard, Loading, Ok, PanelHead, useToast } from '../ui';
import { useStaff } from '../StaffContext';
import { useDialog } from '../Dialog';
import { openReceipt, openStarterGuide } from '../docs';
import { cadDays, cadLabel, firstName, standing, type StudentDetail } from './types';

export function StudentPanel({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { config, can } = useStaff();
  const router = useRouter();
  const { toast, toastUndo, toastError } = useToast();
  const ask = useDialog();
  const { data, error, mutate } = useSWR<{ student: StudentDetail }>(`/api/staff/students/${id}`, fetcher);
  const [editing, setEditing] = useState(false);
  const [noteMsg, setNoteMsg] = useState('');

  if (error) return <ErrorCard error={error} retry={() => void mutate()} />;
  if (!data) return <Loading />;
  const c = data.student;
  const changed = () => {
    void mutate();
    onChanged();
  };

  const first = c.history[0]?.date ?? c.last;
  const next = c.sent >= 3 ? null : c.snooze || (first ? dPlus(first, cadDays(config, c.sent)) : null);
  const due = !!next && next <= todayISO() && c.status !== 'alumni';
  const done = c.sent >= 3;
  const st = standing(c.level);

  const run = async (fn: () => Promise<unknown>, ok?: React.ReactNode) => {
    try {
      await fn();
      changed();
      if (ok) toast(ok);
    } catch (e) {
      toastError(e);
    }
  };

  const cadenceDone = (silent = false) =>
    run(
      () => patch(`/api/staff/students/${id}`, { action: 'cadence', op: 'done' }),
      silent ? undefined : (
        <Ok>
          {cadLabel(config, c.sent)} done for {firstName(c.name)}
        </Ok>
      ),
    );

  const send = () => {
    if (c.sent >= 3) return;
    if (!(c.phone || '').replace(/\D/g, '')) {
      toast('No number saved');
      return;
    }
    window.open(waLink(c.phone, `Hi ${firstName(c.name)}, checking in from ${config.company.name}. We would love to help you again.`), '_blank', 'noopener');
    void cadenceDone(true);
  };

  const setLevel = (level: 'good' | 'okay' | 'bad') =>
    run(
      () => patch(`/api/staff/students/${id}`, { action: 'level', level }),
      <Ok>
        {firstName(c.name)} set to {standing(level).label}
      </Ok>,
    );

  const docs = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      toastError(e);
    }
  };

  const remove = async () => {
    if (c.paidCount) {
      toast(
        <>
          <Icon name="warn" /> {firstName(c.name)} has {c.paidCount} payment{c.paidCount === 1 ? '' : 's'} recorded. Removing them would leave that money with nobody
          attached to it. Mark them alumni instead.
        </>,
        7000,
      );
      return;
    }
    if (!(await ask.confirm({ title: `Remove ${c.name} completely?`, body: 'They have no payments recorded, so nothing is lost.', okLabel: 'Remove', danger: true }))) return;
    try {
      const out = await del<{ token: string; name: string }>(`/api/staff/students/${id}`);
      onClose();
      onChanged();
      toastUndo(<Ok>{c.name} removed</Ok>, async () => {
        await post('/api/staff/students', { restore: out.token }).then(() => toast(<Ok>Undone</Ok>), toastError);
        onChanged();
      });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'has_payments')
        toast(
          <>
            <Icon name="warn" /> {e.message}
          </>,
          7000,
        );
      else toastError(e);
    }
  };

  const statusBadge =
    c.status === 'alumni'
      ? ['bdg-blue', 'Alumni']
      : done
        ? ['bdg-green', 'Cadence complete']
        : due
          ? ['bdg-action', `${cadLabel(config, c.sent)} due`]
          : ['bdg-grey', `Next: ${cadLabel(config, c.sent)}`];
  const att = c.attendance;
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '-');

  return (
    <>
      <PanelHead
        title={c.name}
        sub={c.co || ''}
        onClose={onClose}
        badges={
          <>
            <span className="bdg bdg-amber">{COHORT_SHORT[c.cohort] ?? ''}</span>
            <span className={`bdg ${statusBadge[0]}`}>{statusBadge[1]}</span>
          </>
        }
      />
      <div className="pn-actions">
        <button className="pa primary" onClick={send}>
          <Icon name="phone" /> WhatsApp
        </button>
        {can('messages.send') && (
          <button className="pa" onClick={() => router.push(`/staff/messages?student=${id}`)}>
            <Icon name="inbox" /> Message app
          </button>
        )}
        {due && (
          <button className="pa" onClick={() => cadenceDone()}>
            <Icon name="check" /> Mark done
          </button>
        )}
        <button className="pa" onClick={() => docs(() => openStarterGuide(id))}>
          Starter guide
        </button>
        <button
          className="pa"
          onClick={() =>
            docs(async () => {
              // no month: the latest month this student paid for
              const rno = await openReceipt({ studentId: id, month: '' });
              toast(<Ok>Receipt {rno} ready</Ok>);
            })
          }
        >
          Receipt
        </button>
      </div>
      <div className="pn-body">
        <div className="sec">
          <div className="sec-t">Knowledge level</div>
          <div className="lvl-set">
            <button className={`lvl-btn lv-good${st.key === 'good' ? ' on' : ''}`} onClick={() => setLevel('good')}>
              Strong
            </button>
            <button className={`lvl-btn lv-okay${st.key === 'okay' ? ' on' : ''}`} onClick={() => setLevel('okay')}>
              Okay
            </button>
            <button className={`lvl-btn lv-bad${st.key === 'bad' ? ' on' : ''}`} onClick={() => setLevel('bad')}>
              Needs work
            </button>
          </div>
        </div>

        <div className="sec">
          <div className="sec-t">Summary</div>
          <div className="info-grid">
            <div className="info">
              <div className="il">Fees paid to date</div>
              <div className="iv" style={{ color: 'var(--green)' }}>
                {lkr(c.ltv)}
              </div>
            </div>
            <div className="info">
              <div className="il">Months paid</div>
              <div className="iv">{c.history.length}</div>
            </div>
            <div className="info">
              <div className="il">First payment</div>
              <div className="iv">{fmtDate(first)}</div>
            </div>
            <div className="info">
              <div className="il">Last contact</div>
              <div className="iv">{fmtDate(c.last)}</div>
            </div>
            <div className="info">
              <div className="il">Monthly fee</div>
              <div className="iv">{c.feeEffective != null ? lkr(c.feeEffective) : 'No price set'}</div>
            </div>
            <div className="info">
              <div className="il">WhatsApp</div>
              <div className="iv">{c.phone || '-'}</div>
            </div>
          </div>
        </div>

        <div className="sec">
          <div className="sec-t">Attendance</div>
          <div className="info-grid">
            <div className="info">
              <div className="il">All classes</div>
              <div className="iv">
                {att.present} of {att.total} · {pct(att.present, att.total)}
              </div>
            </div>
            <div className="info">
              <div className="il">Last 30 days</div>
              <div className="iv">
                {att.present30} of {att.total30} · {pct(att.present30, att.total30)}
              </div>
            </div>
            <div className="info">
              <div className="il">Last attended</div>
              <div className="iv">{fmtDate(att.last)}</div>
            </div>
            <div className="info">
              <div className="il">Student app</div>
              <div className="iv">{c.appLogin === 'active' ? 'Signed in' : c.appLogin === 'locked' ? 'Locked' : c.appLogin === 'never' ? 'Not yet signed in' : 'No login'}</div>
            </div>
          </div>
        </div>

        {editing ? (
          <EditForm c={c} onCancel={() => setEditing(false)} onSaved={() => (setEditing(false), changed())} />
        ) : (
          <div className="sec">
            <div className="sec-t">This student</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {can('students.write') && (
                <button className="btn-ghost" onClick={() => setEditing(true)}>
                  Edit details
                </button>
              )}
              {can('students.write') && (
                <button
                  className="btn-ghost"
                  onClick={() =>
                    run(
                      () => patch(`/api/staff/students/${id}`, { action: 'status', status: c.status === 'alumni' ? 'active' : 'alumni' }),
                      <Ok>{c.status === 'alumni' ? `${firstName(c.name)} is active again` : `${firstName(c.name)} marked alumni`}</Ok>,
                    )
                  }
                >
                  {c.status === 'alumni' ? 'Make active' : 'Mark alumni'}
                </button>
              )}
              {can('students.delete') && (
                <button className="btn-ghost" onClick={remove}>
                  Remove
                </button>
              )}
            </div>
            <div className="hint" style={{ marginTop: 8 }}>
              {c.paidCount
                ? `${c.paidCount} payment${c.paidCount === 1 ? '' : 's'} recorded, so this student cannot be removed. Mark them alumni if they have left.`
                : 'No payments recorded yet, so this one can still be removed cleanly.'}
            </div>
          </div>
        )}

        <div className="sec">
          <div className="sec-t">Note</div>
          <textarea
            className="filter"
            rows={2}
            style={{ width: '100%', resize: 'vertical' }}
            placeholder="Anything worth remembering. Paid 300 extra in June, sits at the front, sibling in the 2028 batch."
            defaultValue={c.note}
            onBlur={async (e) => {
              const v = e.target.value.trim();
              if (v === (c.note || '')) return;
              try {
                const out = await patch<{ changed: boolean; cleared: boolean }>(`/api/staff/students/${id}`, { action: 'note', note: v });
                if (out.changed) setNoteMsg(out.cleared ? 'Note cleared.' : 'Saved.');
                void mutate();
              } catch (err) {
                toastError(err);
              }
            }}
          />
          <div className="hint" style={{ marginTop: 6 }}>
            {noteMsg}
          </div>
        </div>

        <div className="sec">
          <div className="sec-t">Fee history</div>
          <table className="tbl" style={{ fontSize: 12.5 }}>
            <thead>
              <tr>
                <th>Item</th>
                <th>Date</th>
                <th className="tnum">Value</th>
              </tr>
            </thead>
            <tbody>
              {c.history.length ? (
                [...c.history].reverse().map((h, i) => (
                  <tr key={i}>
                    <td style={{ fontSize: 12.5 }}>{h.item}</td>
                    <td className="tm">{fmtDate(h.date)}</td>
                    <td className="tnum" style={{ fontSize: 12.5 }}>
                      {lkr(h.value)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} style={{ color: 'var(--faint)' }}>
                    No purchases yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="sec">
          <div className="sec-t">Re-engage cadence</div>
          {[0, 1, 2].map((i) => {
            const s = c.sent > i ? 'done' : c.sent === i ? (due ? 'due' : 'next') : 'pending';
            const col = s === 'done' ? 'var(--green)' : s === 'due' ? 'var(--danger)' : 'var(--line)';
            const txt = s === 'done' ? 'Sent' : s === 'due' ? 'Due now' : s === 'next' && c.status !== 'alumni' ? `Scheduled ${fmtDate(next)}` : 'Upcoming';
            return (
              <div key={i} style={{ display: 'flex', gap: 12, padding: '11px 0', borderBottom: '1px solid var(--line2)' }}>
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    background: col,
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12.5,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {s === 'done' ? '✓' : i + 1}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{cadLabel(config, i)}</div>
                  {s === 'due' && (
                    <div className="mini-act" style={{ marginTop: 6 }}>
                      <button onClick={send}>Send</button>
                      <button onClick={() => cadenceDone()}>Mark done</button>
                      <button
                        onClick={() =>
                          run(
                            () => patch(`/api/staff/students/${id}`, { action: 'cadence', op: 'snooze' }),
                            <Ok>Snoozed 7 days</Ok>,
                          )
                        }
                      >
                        Snooze 7d
                      </button>
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, color: s === 'due' ? 'var(--danger)' : 'var(--muted)', whiteSpace: 'nowrap' }}>{txt}</div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function EditForm({ c, onCancel, onSaved }: { c: StudentDetail; onCancel: () => void; onSaved: () => void }) {
  const { toast, toastError } = useToast();
  const [f, setF] = useState({ name: c.name, phone: c.phone || '', cohort: c.cohort, program: c.program, loc: c.loc });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((o) => ({ ...o, [k]: v }));

  const save = async () => {
    if (!f.name.trim()) {
      toast(
        <>
          <Icon name="warn" /> A student needs a name.
        </>,
      );
      return;
    }
    try {
      const out = await patch<{ changed: boolean; feeMoves?: boolean; fee?: number | null }>(`/api/staff/students/${c.id}`, {
        action: 'edit',
        ...f,
        name: f.name.trim(),
        phone: f.phone.trim(),
      });
      onSaved();
      if (!out.changed) toast('Nothing changed.');
      else toast(<Ok>Saved.{out.feeMoves ? ` Fee is now ${lkr(out.fee)} a month.` : ''}</Ok>);
    } catch (e) {
      toastError(e);
    }
  };

  const lbl = (t: string, el: React.ReactNode) => (
    <div>
      <label className="hint">{t}</label>
      {el}
    </div>
  );

  return (
    <div className="sec">
      <div className="sec-t">Edit this student</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 12 }}>
        {lbl('Name', <input className="filter" style={{ width: '100%' }} value={f.name} onChange={(e) => set('name', e.target.value)} />)}
        {lbl('WhatsApp', <input className="filter" style={{ width: '100%' }} value={f.phone} onChange={(e) => set('phone', e.target.value)} />)}
        {lbl(
          'Batch',
          <select className="filter" style={{ width: '100%' }} value={f.cohort} onChange={(e) => set('cohort', +e.target.value)}>
            {CFG.cohorts.map((x, i) => (
              <option key={x} value={i}>
                {x}
              </option>
            ))}
          </select>,
        )}
        {lbl(
          'Class',
          <select className="filter" style={{ width: '100%' }} value={f.program} onChange={(e) => set('program', e.target.value)}>
            {BSWL_PROGRAMS.map((x) => (
              <option key={x} value={x}>
                {PROG_LABEL[x]}
              </option>
            ))}
          </select>,
        )}
        {lbl(
          'Place',
          <select className="filter" style={{ width: '100%' }} value={f.loc} onChange={(e) => set('loc', e.target.value)}>
            {Object.entries(LOC_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>,
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn-primary" onClick={save}>
          Save the changes
        </button>
        <button className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
