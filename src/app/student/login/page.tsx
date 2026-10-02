'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ApiError, post, refreshOnce } from '@/lib/client/api';
import { LoginMark } from '@/components/student/LoginMark';

/* Student sign-in: first name and the code Leon's team issued.

   Before anything shows, a silent refresh: an installed app whose access
   token lapsed overnight goes straight back in instead of asking a
   fifteen-year-old for a new code. Error messages come from the server,
   already phrased for a student (expired code, locked login, no code yet). */

function safeNext(n: string | null) {
  return n && n.startsWith('/student') && !n.startsWith('/student/login') && !n.startsWith('//') ? n : '/student';
}

function LoginInner() {
  const sp = useSearchParams();
  const next = safeNext(sp.get('next'));
  const [checking, setChecking] = useState(true);
  const [user, setUser] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    refreshOnce('student').then((ok) => {
      if (ok) window.location.replace(next);
      else setChecking(false);
    });
  }, [next]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    const u = user.trim();
    const c = code.trim();
    if (!u || !c) return setErr('Enter your name and your code.');
    setBusy(true);
    try {
      await post('/api/auth/student/login', { username: u, code: c });
      /* an explicit sign-in earns the splash, and the walkthrough on a first run */
      try {
        sessionStorage.setItem('bswl_fresh', '1');
      } catch {}
      window.location.replace(next);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Could not sign you in');
      setBusy(false);
    }
  };

  return (
    <div className="login" style={checking ? { visibility: 'hidden' } : undefined}>
      <div className="login-in">
        <LoginMark />
        <h1 className="lg-t">BS With Leon</h1>
        <p className="lg-s">Sign in to your study app</p>
        <form autoComplete="off" onSubmit={submit}>
          <label htmlFor="lgUser">Your name</label>
          <input
            id="lgUser"
            name="lgUser"
            autoCapitalize="words"
            autoComplete="username"
            placeholder="Amaya"
            enterKeyHint="next"
            value={user}
            onChange={(e) => setUser(e.target.value)}
          />
          <label htmlFor="lgPin" style={{ marginTop: 'var(--s4)' }}>
            Your code
          </label>
          <input
            id="lgPin"
            name="lgPin"
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            maxLength={6}
            placeholder="6 digits"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <p className="lg-err" role="alert">
            {err}
          </p>
          <button className="btn btn-primary" type="submit" style={{ marginTop: 'var(--s5)' }} disabled={busy}>
            {busy ? 'Signing in' : 'Sign in'}
          </button>
        </form>
        <p className="lg-foot">Ask Leon for a code. Each one works once.</p>
      </div>
    </div>
  );
}

export default function StudentLogin() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
