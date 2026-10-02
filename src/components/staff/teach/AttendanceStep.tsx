'use client';

import { useMemo, useState } from 'react';
import { post } from '@/lib/client/api';
import { Empty, Ok, useToast } from '@/components/staff/ui';
import { COHORT_SHORT, init2 } from '@/lib/shared/constants';
import type { ClassCtx } from './types';

/* Step 1 · Who came. Everyone is Present by default; a tap marks Absent and
   saves itself. "Save register" writes a row for everyone else, so a class
   where everybody came is still on record. */

export function AttendanceStep({ ctx, loc, reload }: { ctx: ClassCtx; loc: string; reload: () => void }) {
  const { toast, toastError } = useToast();
  // optimistic overrides while a tap is in flight
  const [over, setOver] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);

  const rowOf = useMemo(() => {
    const m = new Map<number, boolean>();
    for (const a of ctx.attendance) m.set(a.studentId, a.present);
    for (const [k, v] of Object.entries(over)) m.set(Number(k), v);
    return m;
  }, [ctx.attendance, over]);

  const roll = ctx.students.filter(
    (s) => (s.joined || '0000') <= ctx.date && s.cohort === ctx.cohort && (loc === 'all' || s.co === loc),
  );
  const absent = roll.filter((s) => rowOf.get(s.id) === false).length;
  const present = roll.length - absent;
  const taken = roll.length > 0 && roll.every((s) => rowOf.has(s.id));

  const toggle = async (id: number) => {
    const cur = rowOf.get(id);
    const next = cur === undefined ? false : !cur;
    setOver((o) => ({ ...o, [id]: next }));
    try {
      await post('/api/staff/attendance', { studentId: id, date: ctx.date, present: next });
      reload();
    } catch (e) {
      setOver((o) => {
        const n = { ...o };
        delete n[id];
        return n;
      });
      toastError(e);
    }
  };

  const save = async () => {
    if (!ctx.date) return toast('Pick a date first.');
    if (!roll.length) return toast('No students in this class on that date.');
    setBusy(true);
    try {
      const r = await post<{ present: number; absent: number }>('/api/staff/attendance/register', { date: ctx.date, cohort: ctx.cohort, co: loc });
      setOver({});
      reload();
      toast(
        <Ok>
          Register saved for {ctx.date}: {r.present} present, {r.absent} absent.
        </Ok>,
      );
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {roll.length > 0 && (
        <div className="att-sum">
          <div className="asx as-p">
            <b>{present}</b> present
          </div>
          <div className="asx as-a">
            <b>{absent}</b> absent
          </div>
          <div className="asx as-r">
            <b>{Math.round((present / roll.length) * 100)}%</b> turnout
          </div>
        </div>
      )}
      <div className="att-hint">Everyone is Present by default. Tap a student to mark them Absent, then save the register so the class is on record.</div>
      <div className="card">
        <div className="card-b">
          {roll.length ? (
            roll.map((s) => {
              const isAbsent = rowOf.get(s.id) === false;
              const r = ctx.rates[s.id];
              return (
                <div className="att-row" key={s.id}>
                  <div className="pr-av">{init2(s.name)}</div>
                  <div className="pr-main">
                    <div className="pr-nm">{s.name}</div>
                    <div className="pr-mt">
                      {COHORT_SHORT[s.cohort]} · {s.co} · {r != null ? `${r}% attendance` : 'new'}
                    </div>
                  </div>
                  <button
                    className={`att-btn ${isAbsent ? 'is-absent' : 'is-present'}`}
                    aria-pressed={isAbsent}
                    onClick={() => toggle(s.id)}
                  >
                    {isAbsent ? 'Absent' : 'Present'}
                  </button>
                </div>
              );
            })
          ) : (
            <Empty icon="users" title="No students for this class" sub="Nobody had joined by this date, or the filter is empty." />
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 'var(--sp-4)', flexWrap: 'wrap' }}>
        <button className="btn-primary" onClick={save} disabled={busy}>
          Save register
        </button>
        <span className="hint" style={{ color: taken ? 'var(--muted)' : 'var(--warn, #b45309)' }}>
          {taken
            ? 'This class is on record. Tap a student to correct it, the change saves itself.'
            : 'Not saved yet. Nothing is stored for this class until you save the register.'}
        </span>
      </div>
    </>
  );
}
