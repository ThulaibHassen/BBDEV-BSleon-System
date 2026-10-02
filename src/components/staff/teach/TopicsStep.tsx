'use client';

import { useState } from 'react';
import { post, del } from '@/lib/client/api';
import { Ok, useToast } from '@/components/staff/ui';
import { Icon } from '@/components/staff/Icon';
import { BSWL_SYLLABUS, COHORT_SHORT, init2 } from '@/lib/shared/constants';
import { openWa } from './util';
import type { ClassCtx } from './types';

/* Step 2 · What you taught. Leon's ten-second topic marker: tick, save once,
   the whole batch is updated. Coverage is per batch, never per student.
   The tute setter sits here because he is already here marking what he taught. */

export function TopicsStep({ ctx, reload }: { ctx: ClassCtx; reload: () => void }) {
  const { toast, toastUndo, toastError } = useToast();
  const [picked, setPicked] = useState<Record<string, true>>({});
  const short = COHORT_SHORT[ctx.cohort];

  const tog = (id: string) =>
    setPicked((p) => {
      const n = { ...p };
      if (n[id]) delete n[id];
      else n[id] = true;
      return n;
    });

  const save = async () => {
    const ids = Object.keys(picked);
    if (!ids.length) return toast('Tick at least one topic first');
    try {
      await post('/api/staff/classes', { date: ctx.date, cohort: ctx.cohort, topics: ids });
      setPicked({});
      reload();
      toast(<Ok>Saved. The whole {short} batch is updated.</Ok>);
    } catch (e) {
      toastError(e);
    }
  };

  const tute = async (unit: string) => {
    const cur = ctx.tutes.find((t) => t.unit === unit);
    try {
      if (cur) {
        await del('/api/staff/classes/tutes', { unit, cohort: ctx.cohort });
        reload();
        toastUndo(`Unit ${unit} tute removed`, async () => {
          await post('/api/staff/classes/tutes', { unit, cohort: ctx.cohort, date: cur.date }).then(() => toast(<Ok>Undone</Ok>), toastError);
          reload();
        });
      } else {
        await post('/api/staff/classes/tutes', { unit, cohort: ctx.cohort, date: ctx.date });
        reload();
        toast(
          <Ok>
            Unit {unit} tute assigned to the {short} batch.
          </Ok>,
        );
      }
    } catch (e) {
      toastError(e);
    }
  };

  const sig = ctx.signals;
  const bar = (lbl: string, pc: number, note?: string) => (
    <div style={{ margin: '7px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
        <span>{lbl}</span>
        <b>{pc}%</b>
      </div>
      <div style={{ height: 7, background: 'var(--surface-2)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pc}%`, background: 'var(--brand)', borderRadius: 99 }} />
      </div>
      {note && (
        <div className="hint" style={{ marginTop: 3, fontSize: 11, color: 'var(--faint)' }}>
          {note}
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="card">
        <div className="card-h">
          <h3>What did this class cover?</h3>
          <span className="hint">Tick the topics, then save once. It applies to the whole batch.</span>
        </div>
        <div className="card-b">
          {BSWL_SYLLABUS.map((u) => (
            <div key={u.u}>
              <div style={{ margin: '10px 0 4px', fontWeight: 700, fontSize: 12.5 }}>
                {u.u}. {u.name}
              </div>
              {u.topics.map(([id, name]) => {
                const done = ctx.covered[id];
                if (done) {
                  return (
                    <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 2px', color: 'var(--faint)', fontSize: 13.5 }}>
                      <Icon name="check" /> <span>
                        {id} {name}
                      </span>
                      <span className="hint" style={{ marginLeft: 'auto' }}>
                        covered {done.slice(5)}
                      </span>
                    </div>
                  );
                }
                const on = !!picked[id];
                return (
                  <button
                    key={id}
                    aria-pressed={on}
                    style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 2px', width: '100%', textAlign: 'left', fontSize: 13.5, fontWeight: on ? 700 : undefined }}
                    onClick={() => tog(id)}
                  >
                    <span
                      style={{
                        width: 17,
                        height: 17,
                        border: '1.6px solid var(--line-2)',
                        borderRadius: 5,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flex: 'none',
                      }}
                    >
                      {on && <Icon name="check" />}
                    </span>
                    <span>
                      {id} {name}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="card-b">
          <button className="btn-primary" onClick={save}>
            Save this class
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <h3>Set the tute for this class</h3>
          <span className="hint">The batch sees it in Learn, under Tutes</span>
        </div>
        <div className="card-b">
          {BSWL_SYLLABUS.map((u) => {
            const cur = ctx.tutes.find((t) => t.unit === u.u);
            return (
              <div key={u.u} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: '1px solid var(--line2)' }}>
                <div style={{ flex: 1 }}>
                  <b style={{ fontSize: 13.5 }}>Unit {u.u}</b>
                  <div className="hint">{u.name}</div>
                </div>
                {cur && <span className="hint">set {cur.date}</span>}
                <button className={cur ? 'btn-ghost' : 'btn-primary'} onClick={() => tute(u.u)}>
                  {cur ? 'Remove' : 'Assign'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <h3>Coverage so far</h3>
          <span className="hint">How much of the syllabus each batch has seen</span>
        </div>
        <div className="card-b">
          {ctx.coverage.map((c) => (
            <div key={c.cohort} style={{ margin: '8px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 5 }}>
                <b>{COHORT_SHORT[c.cohort]} Batch</b>
                <span>
                  {c.n} of {c.total} topics · {c.pc}%
                </span>
              </div>
              <div style={{ height: 8, background: 'var(--surface-2)', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${c.pc}%`, background: 'var(--brand)', borderRadius: 99 }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <h3>Batch signals</h3>
          <span className="hint">Where this batch is struggling and what to teach next</span>
        </div>
        <div className="card-b">
          <div style={{ fontSize: 12.5, marginBottom: 6 }}>
            <b>Last class:</b>{' '}
            {sig.lastDate ? `${sig.lastPresent} of ${sig.batchN} students present (${sig.lastDate})` : 'no register saved for this batch yet'}
          </div>
          {bar('Syllabus covered in class', sig.covPc)}
          {bar('Demonstrated in student checks', sig.demPc, sig.sample ? `From ${sig.sample} students with checks on record.` : 'No student checks on record yet.')}
          {bar('Tute completion (self-reported)', sig.tutePc, sig.tuteN ? undefined : 'No tute progress on record yet.')}
          <div style={{ fontSize: 12.5, margin: '8px 0 4px' }}>
            Recent paper median: <b>{sig.median != null ? `${sig.median} of 20` : 'no papers yet'}</b> · confidence and evidence disagree for{' '}
            <b>{sig.mismatch}</b> students
          </div>
          <div style={{ borderTop: '1px solid var(--hair)', marginTop: 10, paddingTop: 10 }}>
            <b style={{ fontSize: 12.5 }}>Teach next</b>
            <div style={{ fontSize: 12.5, marginTop: 5 }}>
              1. The gap between covered ({sig.covPc}%) and demonstrated ({sig.demPc}%) says a recap beats new ground this week.
            </div>
            <div style={{ fontSize: 12.5, marginTop: 3 }}>
              2. {sig.mismatch} students feel sure of a topic the checks disagree on. Ten minutes of re-teaching clears it batch-wide.
            </div>
            <div className="hint" style={{ marginTop: 5, fontSize: 11, color: 'var(--faint)' }}>
              Rankings are never shown, here or to students.
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <h3>Worth a look</h3>
          <span className="hint">At most ten students, each with a reason and one action</span>
        </div>
        <div className="card-b">
          {ctx.queue.length ? (
            ctx.queue.map((x) => (
              <div key={x.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--hair)' }}>
                <div className="pr-av">{init2(x.name)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{x.name}</div>
                  <div className="hint" style={{ fontSize: 11, color: 'var(--faint)' }}>
                    {x.absent >= 2
                      ? `${x.absent} absences on record. A pattern, not a one-off.`
                      : 'Missed a class in the last fortnight and the catch-up is not confirmed.'}{' '}
                    One WhatsApp beats a lost student.
                  </div>
                </div>
                <button className="btn-ghost" style={{ flex: 'none' }} onClick={() => openWa(x.phone) || toast('No number on that student record.')}>
                  Message
                </button>
              </div>
            ))
          ) : (
            <div className="hint" style={{ padding: '8px 0' }}>
              Nobody needs chasing in this batch. Rare and good.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
