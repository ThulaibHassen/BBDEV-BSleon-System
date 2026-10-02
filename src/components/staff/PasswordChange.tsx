'use client';

import { useState } from 'react';
import { post } from '@/lib/client/api';
import { Field, Modal } from './ui';

/* Change your password. `forced` = first sign-in with a password someone
   else set (the seeded owner, or a user added by an owner): it cannot be
   dismissed until a new password is saved. */
export function PasswordChange({ forced, onDone }: { forced?: boolean; onDone?: (saved: boolean) => void }) {
  const [open, setOpen] = useState(true);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setErr('');
    if (next !== again) return setErr('The two new passwords do not match.');
    setBusy(true);
    try {
      await post('/api/auth/staff/password', { current: cur, next });
      setOpen(false);
      if (forced) window.location.reload();
      onDone?.(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={forced ? 'Choose your own password' : 'Change password'}
      onClose={() => {
        if (!forced) {
          setOpen(false);
          onDone?.(false);
        }
      }}
      footer={
        <button className="btn-primary" disabled={busy} onClick={save}>
          {busy ? 'Saving' : 'Save password'}
        </button>
      }
    >
      {forced && <p className="hint" style={{ marginBottom: 14 }}>This account was set up with a temporary password. Pick one only you know before you carry on.</p>}
      <Field label="Current password">
        <input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
      </Field>
      <Field label="New password" error={err && err.includes('characters') ? err : undefined}>
        <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
      </Field>
      <Field label="New password again">
        <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
      </Field>
      <div className="hint">At least 10 characters, with letters and numbers.</div>
      {err && <div className="login-err" style={{ marginTop: 10 }}>{err}</div>}
    </Modal>
  );
}
