'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { post, refreshOnce, ApiError } from '@/lib/client/api';
import { roleLabel, type StaffRole } from '@/lib/shared/rbac';

/* Two-step sign-in, as before: pick your account from the ones this device
   remembers (name, email, role — never a password), or sign in by email.
   Before showing anything it tries a silent refresh, so an expired access
   token never costs the user a sign-in. */

type Known = { id: number; name: string; role: StaffRole; email: string };
const KNOWN_KEY = 'bswl_staff_known_v1';

function readKnown(): Known[] {
  try {
    const v = JSON.parse(localStorage.getItem(KNOWN_KEY) || '[]');
    return Array.isArray(v) ? v.slice(0, 30) : [];
  } catch {
    return [];
  }
}

function remember(k: Known) {
  try {
    const list = [k, ...readKnown().filter((x) => x.email !== k.email)].slice(0, 30);
    localStorage.setItem(KNOWN_KEY, JSON.stringify(list));
  } catch {}
}

function LoginInner() {
  const sp = useSearchParams();
  const next = safeNext(sp.get('next'));
  const [checking, setChecking] = useState(true);
  const [known, setKnown] = useState<Known[]>([]);
  const [step, setStep] = useState<1 | 2>(1);
  const [picked, setPicked] = useState<Known | null>(null);
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setKnown(readKnown());
    refreshOnce('staff').then((ok) => {
      if (ok) window.location.replace(next);
      else setChecking(false);
    });
  }, [next]);

  const pick = (k: Known | null) => {
    setPicked(k);
    setEmail(k?.email ?? '');
    setPw('');
    setErr('');
    setStep(2);
  };

  const submit = async () => {
    setErr('');
    const em = email.trim().toLowerCase();
    if (!em || !pw) return setErr(picked ? 'Enter your password.' : 'Enter your email and your password.');
    setBusy(true);
    try {
      const r = await post<{ staff: Known }>('/api/auth/staff/login', { email: em, password: pw });
      remember({ id: r.staff.id, name: r.staff.name, role: r.staff.role, email: r.staff.email });
      window.location.replace(next);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not reach the server. Check the connection.');
      setBusy(false);
    }
  };

  return (
    <div id="login">
      <div className="login-bg" />
      <div className="login-card">
        <div style={{ textAlign: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="login-logo" src="/brand/logo-login.png" alt="BS With Leon" />
        </div>
        {checking ? (
          <div className="login-h">
            <p>Checking your session…</p>
          </div>
        ) : step === 1 ? (
          <div>
            <div className="login-h">
              <h2>BS With Leon</h2>
              <p>{known.length ? 'Choose your account to sign in' : 'Sign in to the team app'}</p>
            </div>
            {known.length > 0 && (
              <>
                <div className="login-lbl">Team</div>
                <div className="users">
                  {known.map((k) => (
                    <button key={k.email} className="urow" onClick={() => pick(k)}>
                      <div className={`uav${k.role === 'owner' ? '' : ' alt'}`}>{k.name[0]}</div>
                      <div style={{ textAlign: 'left' }}>
                        <div className="uname">{k.name}</div>
                        <div className="urole">
                          {roleLabel(k.role)}
                          {k.role === 'staff' ? ' · Own leads' : ' · Full access'}
                        </div>
                      </div>
                      <span className="uarrow">&rarr;</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            <button className={known.length ? 'btn-ghost' : 'btn-primary'} style={{ width: '100%', justifyContent: 'center', marginTop: 10 }} onClick={() => pick(null)}>
              {known.length ? 'Not listed? Sign in with your email' : 'Sign in with your email'}
            </button>
          </div>
        ) : (
          <div>
            <div className="login-h">
              {picked ? (
                <>
                  <div className={`uav${picked.role === 'owner' ? '' : ' alt'}`} style={{ width: 54, height: 54, borderRadius: 15, fontSize: 21, margin: '0 auto 12px' }}>
                    {picked.name[0]}
                  </div>
                  <h2>{picked.name}</h2>
                  <p>{roleLabel(picked.role)}</p>
                </>
              ) : (
                <>
                  <h2>Sign in</h2>
                  <p>Use the email your account was created with</p>
                </>
              )}
            </div>
            {!picked && (
              <div className="fld">
                <label htmlFor="lgEmail">Email</label>
                <input id="lgEmail" type="email" autoComplete="username" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
              </div>
            )}
            <div className="fld">
              <label htmlFor="lgPw">Password</label>
              <input
                id="lgPw"
                type="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                value={pw}
                autoFocus={!!picked}
                onChange={(e) => setPw(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
              />
            </div>
            <div className="login-err" role="alert">
              {err}
            </div>
            <button className="btn-primary" style={{ width: '100%', justifyContent: 'center', padding: 12, fontSize: 13.5 }} disabled={busy} onClick={submit}>
              {busy ? 'Signing in' : 'Sign In'}
            </button>
            <button
              className="btn-ghost"
              style={{ width: '100%', justifyContent: 'center', marginTop: 8, border: 'none', background: 'none', boxShadow: 'none' }}
              onClick={() => setStep(1)}
            >
              &larr; Back
            </button>
          </div>
        )}
        <div className="login-foot">Academy of Business Studies by Leon Fambeck</div>
      </div>
    </div>
  );
}

function safeNext(n: string | null) {
  return n && /^\/staff(\/|\?|$)/.test(n) && !n.startsWith('/staff/login') ? n : '/staff/dashboard';
}

export default function StaffLogin() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
