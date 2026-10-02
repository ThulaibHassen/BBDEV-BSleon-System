'use client';

import { useState } from 'react';
import { Field, Modal } from '@/components/staff/ui';
import { lkr } from '@/lib/shared/constants';
import { todayISO } from '@/lib/shared/dates';
import { PAYMENT_METHODS, type PaymentMethod } from './shared';

/* Record a payment with its amount, method and date. Used for part
   payments on the fee ledger and for invoices; "Mark paid" stays one tap. */

export type PaymentDraft = { amount: number; method: PaymentMethod; paidAt: string };

type Props = {
  open: boolean;
  title: string;
  sub?: string;
  balance: number;
  withDate?: boolean;
  onClose: () => void;
  onSave: (d: PaymentDraft) => Promise<void>;
};

/** Mounted only while open, so every opening starts from a fresh form. */
export function PaymentModal(props: Props) {
  return props.open ? <PaymentForm {...props} /> : null;
}

function PaymentForm({ title, sub, balance, withDate = true, onClose, onSave }: Props) {
  const [amount, setAmount] = useState(String(balance));
  const [method, setMethod] = useState<PaymentMethod>('Cash');
  const [paidAt, setPaidAt] = useState(todayISO());
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const n = parseInt(amount.replace(/[^0-9]/g, ''), 10) || 0;
    if (n <= 0) return setErr('Enter an amount above zero.');
    if (n > balance) return setErr(`That is more than the ${lkr(balance)} still due.`);
    if (withDate && (!paidAt || paidAt > todayISO())) return setErr('The payment date cannot be in the future.');
    setBusy(true);
    try {
      await onSave({ amount: n, method, paidAt });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      width={420}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy} onClick={save}>
            {busy ? 'Saving' : 'Record payment'}
          </button>
        </>
      }
    >
      {sub && <p className="hint" style={{ marginBottom: 14 }}>{sub}</p>}
      <Field label={`Amount (still due ${lkr(balance)})`} error={err && err.includes('amount') ? err : undefined}>
        <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
      </Field>
      <Field label="Method">
        <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
          {PAYMENT_METHODS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </Field>
      {withDate && (
        <Field label="Paid on">
          <input type="date" value={paidAt} max={todayISO()} onChange={(e) => setPaidAt(e.target.value)} />
        </Field>
      )}
      {err && !err.includes('amount') && <div className="login-err">{err}</div>}
    </Modal>
  );
}
