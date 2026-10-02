'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { post, refreshOnce, ApiError } from '@/lib/client/api';
import { LoginMark } from '@/components/parent/LoginMark';
import { usePMode } from '@/components/parent/mode';

/* Parent sign-in: the CHILD's name and the 6-digit code from Leon.
   The mark gathers while a silent refresh decides whether we are even
   staying on this screen; a returning parent is sent straight on, which
   costs nothing and is never seen. */

/** Where to go after sign-in: only ever back into the parent app. */
function nextUrl() {
  const n = new URLSearchParams(window.location.search).get('next');
  return n && /^\/parent(\/|\?|$)/.test(n) && !n.startsWith('/parent/login') ? n : '/parent';
}

export default function ParentLoginPage() {
  usePMode();
  const [child, setChild] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    refreshOnce('parent').then((ok) => {
      if (ok) window.location.replace(nextUrl());
    });
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const c = child.trim();
    const d = code.replace(/\D/g, '');
    setErr('');
    if (!c || !d) return setErr("Enter your child's name and the code.");
    setBusy(true);
    try {
      const r = await post<{ parent: { id: number } }>('/api/auth/parent/login', { child: c, code: d });
      /* an explicit sign-in: the hub may offer the fee reminder, once */
      try {
        sessionStorage.setItem('bswl_par_fresh', String(r.parent.id));
      } catch {}
      window.location.replace(nextUrl());
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Could not sign you in');
      setBusy(false);
    }
  };

  return (
    <div className="login" id="login">
      <div className="login-in">
        <LoginMark />
        <h1 className="lg-t">BS With Leon</h1>
        <p className="lg-s">Parent access &mdash; fees, attendance and how the class is going</p>
        <form autoComplete="off" onSubmit={submit}>
          <label htmlFor="pChild">Your child&rsquo;s name</label>
          <input
            id="pChild"
            autoCapitalize="words"
            autoComplete="off"
            placeholder="Amaya"
            value={child}
            onChange={(e) => setChild(e.target.value)}
          />
          <label htmlFor="pCode" style={{ marginTop: 'var(--s4)' }}>
            The code from Leon
          </label>
          <input
            id="pCode"
            inputMode="numeric"
            maxLength={6}
            placeholder="6 digits"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <p className="lg-err" role="alert">
            {err}
          </p>
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ marginTop: 'var(--s5)' }}>
            {busy ? 'Signing in' : 'Sign in'}
          </button>
        </form>
        <p className="lg-foot">Ask Leon or Bihandu for a code. It lasts a day, and it works on more than one phone.</p>
      </div>
    </div>
  );
}

