'use client';

/* New / Edit enquiry (openRecordModal + saveRecord). Batch and class are
   picked, never typed, so the enrolment value is derived from Leon's price
   list — a typed value is a guess that becomes a forecast. */

import { useEffect, useRef, useState } from 'react';
import { patch, post } from '@/lib/client/api';
import { BSWL_PROGRAMS, CFG, SL_PHONE, bswlFee, lkr } from '@/lib/shared/constants';
import { dPlus, todayISO } from '@/lib/shared/dates';
import { Field, Modal, Ok, useToast } from '../ui';
import { useStaff, type StaffConfig } from '../StaffContext';
import { fieldLabel, type Enquiry } from './types';

export function feeLabelFor(program: string, cohort: number) {
  const v = bswlFee(program, cohort);
  if (v != null) return `Monthly fee ${lkr(v)}, from Leon's price list.`;
  return `No price set for ${program} in the ${CFG.cohorts[cohort] || 'this'}. Ask Leon before you enrol, so the enrolment value is not a guess.`;
}

type Props = { open: boolean; record: Enquiry | null; onClose: () => void; onSaved: (r: Enquiry) => void };

/* The form mounts fresh on every open (keyed on the record), so its state
   is initialised from the record instead of being synced in an effect. */
export function EnquiryModal(props: Props) {
  return props.open ? <EnquiryForm key={props.record?.id ?? 'new'} {...props} /> : null;
}

function initial(r: Enquiry | null, cfg: StaffConfig, isMaster: boolean, meId: number) {
  /* an old record's free-text "co" is parsed back where it can be */
  const batch = r ? (r.batch ?? Math.max(0, CFG.cohorts.findIndex((c) => (r.co || '').includes(c.split(' ')[0])))) : 0;
  return {
    name: r?.name ?? '',
    batch,
    phone: r?.phone ?? '',
    stage: r?.stage ?? cfg.stages[0].k,
    owner: r?.owner ?? (isMaster ? (cfg.team.find((t) => t.active)?.id ?? meId) : meId),
    prog: r && r.prog && (BSWL_PROGRAMS as readonly string[]).includes(r.prog) ? r.prog : (BSWL_PROGRAMS[0] as string),
    school: r?.school ?? '',
    /* FOLLOW-UP DEFAULTS TO TWO DAYS OUT — a default, not a lock */
    followUp: r ? (r.followUp ?? '') : dPlus(todayISO(), 2),
  };
}

function EnquiryForm({ open, record, onClose, onSaved }: Props) {
  const { me, isMaster, config, refreshBadges } = useStaff();
  const { toast, toastError } = useToast();
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const [f, setF] = useState(() => initial(record, config, isMaster, me.id));
  const [bad, setBad] = useState<{ name?: boolean; phone?: boolean }>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const k = setTimeout(() => nameRef.current?.focus(), 60);
    return () => clearTimeout(k);
  }, []);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((o) => ({ ...o, [k]: v }));
  const fee = bswlFee(f.prog, f.batch);

  const save = async () => {
    const name = f.name.trim();
    const phone = f.phone.trim();
    const b = { name: !name, phone: !!phone && !SL_PHONE.test(phone.replace(/[\s-]/g, '')) };
    setBad(b);
    if (b.name) return nameRef.current?.focus();
    if (b.phone) return phoneRef.current?.focus();
    setBusy(true);
    try {
      const data = { name, batch: f.batch, prog: f.prog, school: f.school.trim(), phone, stage: f.stage, owner: f.owner, followUp: f.followUp };
      const out = record
        ? await patch<{ record: Enquiry }>(`/api/staff/records/${record.id}`, data)
        : await post<{ record: Enquiry }>('/api/staff/records', data);
      toast(<Ok>{record ? `${out.record.name} updated` : `${name} added`}</Ok>);
      refreshBadges();
      onSaved(out.record);
      onClose();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const optional = <span style={{ color: 'var(--faint)', fontWeight: 400 }}>(optional)</span>;

  return (
    <Modal
      open={open}
      width={520}
      title={`${record ? 'Edit' : 'New'} ${config.entity.singular}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save} disabled={busy}>
            Save
          </button>
        </>
      }
    >
      <Field label={fieldLabel(config, 'name')} error={bad.name && 'Please enter a name.'}>
        <input ref={nameRef} value={f.name} placeholder="e.g. Sunrise Traders" onChange={(e) => set('name', e.target.value)} />
      </Field>
      <div className="fld-grid2">
        <Field label="Batch">
          <select value={f.batch} onChange={(e) => set('batch', +e.target.value)}>
            {CFG.cohorts.map((c, i) => (
              <option key={c} value={i}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label={fieldLabel(config, 'phone')} error={bad.phone && 'Enter a valid Sri Lankan number.'}>
          <input ref={phoneRef} inputMode="tel" value={f.phone} placeholder="07X XXX XXXX" onChange={(e) => set('phone', e.target.value)} />
        </Field>
      </div>
      <div className="fld-grid3">
        <Field label={fieldLabel(config, 'stage')}>
          <select value={f.stage} onChange={(e) => set('stage', e.target.value)}>
            {config.stages
              .filter((s) => !s.terminal || s.terminal === 'won' || s.k === f.stage)
              .map((s) => (
                <option key={s.k} value={s.k}>
                  {s.label}
                </option>
              ))}
          </select>
        </Field>
        <Field label={fieldLabel(config, 'owner')}>
          <select value={f.owner} disabled={!isMaster} onChange={(e) => set('owner', +e.target.value)}>
            {config.team
              .filter((s) => s.active || s.id === f.owner)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <div className="fld-grid2">
        <Field label="Class they want">
          <select value={f.prog} onChange={(e) => set('prog', e.target.value)}>
            {BSWL_PROGRAMS.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </Field>
        <Field label={<>School {optional}</>}>
          <input value={f.school} placeholder="e.g. Royal College" onChange={(e) => set('school', e.target.value)} />
        </Field>
      </div>
      <Field label="Enrolment value">
        <div className={`rc-price${fee == null ? ' rc-price-gap' : ''}`}>
          {fee == null ? feeLabelFor(f.prog, f.batch) : `${lkr(fee)} a month, from Leon's price list.`}
        </div>
      </Field>
      <Field label={<>Follow-up date {optional}</>}>
        <input type="date" value={f.followUp} onChange={(e) => set('followUp', e.target.value)} />
      </Field>
    </Modal>
  );
}
