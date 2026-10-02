'use client';

/* ENROLMENT — the missing link between an enquiry and a student. It asks for
   batch, class (place) and programme; never for the fee, which comes from
   Leon's price list. The server writes students + recurring_plans (same id)
   and links the enquiry in one transaction. */

import { useState } from 'react';
import { ApiError, post } from '@/lib/client/api';
import { BSWL_PROGRAMS, CFG, LOC_LABEL, bswlFee, lkr } from '@/lib/shared/constants';
import { Icon } from '../Icon';
import { PanelHead, useToast, Ok } from '../ui';
import { useStaff } from '../StaffContext';
import { useDialog } from '../Dialog';
import { feeLabelFor } from './EnquiryModal';
import type { Enquiry } from './types';

export function EnrolPanel({ rec, onClose, onDone }: { rec: Enquiry | null; onClose: () => void; onDone: (studentId: number) => void }) {
  const { refreshBadges } = useStaff();
  const { toast, toastError } = useToast();
  const ask = useDialog();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [cohort, setCohort] = useState(rec?.batch ?? 0);
  const [loc, setLoc] = useState('Kings');
  const [program, setProgram] = useState<string>(rec?.prog && (BSWL_PROGRAMS as readonly string[]).includes(rec.prog) ? rec.prog : BSWL_PROGRAMS[0]);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const nm = rec ? rec.name : name.trim();
    if (!nm) {
      toast(
        <>
          <Icon name="warn" /> A student needs a name.
        </>,
      );
      return;
    }
    setBusy(true);
    const send = (confirmDuplicate: boolean) =>
      rec
        ? post<{ student: { id: number } }>(`/api/staff/records/${rec.id}/enrol`, { cohort, loc, program, confirmDuplicate })
        : post<{ student: { id: number } }>('/api/staff/students', { name: nm, phone: phone.trim(), cohort, loc, program, confirmDuplicate });
    try {
      let out;
      try {
        out = await send(false);
      } catch (e) {
        if (e instanceof ApiError && e.code === 'duplicate') {
          if (!(await ask.confirm({ title: `${nm} is already an active student.`, body: 'Add a second record anyway?', okLabel: 'Add anyway' }))) return;
          out = await send(true);
        } else throw e;
      }
      refreshBadges();
      toast(
        <Ok>
          {nm} is now a student. Fee {lkr(bswlFee(program, cohort))} a month.
        </Ok>,
      );
      onDone(out.student.id);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const lbl = (htmlFor: string, t: string) => (
    <label className="hint" htmlFor={htmlFor}>
      {t}
    </label>
  );

  return (
    <>
      <PanelHead title={rec ? rec.name : 'New student'} sub={rec ? 'Enrolling from an enquiry' : 'Adding a student by hand'} onClose={onClose} />
      <div className="pn-body">
        <div className="sec">
          {!rec && (
            <>
              <div style={{ marginBottom: 12 }}>
                {lbl('enName', 'Full name')}
                <input className="filter" id="enName" style={{ width: '100%' }} placeholder="Student name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </div>
              <div style={{ marginBottom: 12 }}>
                {lbl('enPhone', 'Phone')}
                <input className="filter" id="enPhone" style={{ width: '100%' }} placeholder="07X XXX XXXX" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </>
          )}
          <div style={{ marginBottom: 12 }}>
            {lbl('enCohort', 'Batch')}
            <select className="filter" id="enCohort" style={{ width: '100%' }} value={cohort} onChange={(e) => setCohort(+e.target.value)}>
              {CFG.cohorts.map((c, i) => (
                <option key={c} value={i}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div style={{ marginBottom: 12 }}>
            {lbl('enLoc', 'Class')}
            <select className="filter" id="enLoc" style={{ width: '100%' }} value={loc} onChange={(e) => setLoc(e.target.value)}>
              {Object.entries(LOC_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div style={{ marginBottom: 12 }}>
            {lbl('enProg', 'Programme')}
            <select className="filter" id="enProg" style={{ width: '100%' }} value={program} onChange={(e) => setProgram(e.target.value)}>
              {BSWL_PROGRAMS.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </div>
          <div className="hint" style={{ marginBottom: 14 }}>
            {feeLabelFor(program, cohort)} They appear in Students straight away and in Fees from this month.
          </div>
          <button className="btn-primary" onClick={save} disabled={busy}>
            {rec ? 'Enrol as a student' : 'Add the student'}
          </button>
        </div>
      </div>
    </>
  );
}
