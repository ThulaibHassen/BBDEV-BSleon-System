'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { fetcher, post, patch, del } from '@/lib/client/api';
import { Empty, Ok, useToast } from '@/components/staff/ui';
import { Icon } from '@/components/staff/Icon';
import { useStaff } from '@/components/staff/StaffContext';
import { COHORT_SHORT } from '@/lib/shared/constants';
import { fmtDate } from '@/lib/shared/dates';
import { first, openWa } from './util';
import { useCopy, useDialog } from '@/components/staff/Dialog';
import type { AccessData, CodeCard, LoginRow, ParentRow } from './types';

/* ACCESS. No password is ever stored or shown. A code appears once, at the
   moment it is made, then it is gone. Lock, sign-out and remove take effect
   on the student's phones within seconds (their sessions are revoked). */

const statusLabel = (l: Pick<LoginRow, 'status' | 'lastActive'>) =>
  l.status === 'active' && !l.lastActive ? 'Code issued, not signed in yet' : ({ active: 'Active', never: 'Never signed in', locked: 'Locked' } as const)[l.status] ?? l.status;

export function AccessTab({ access, reload }: { access: AccessData; reload: () => void }) {
  const { toast, toastError } = useToast();
  const { can } = useStaff();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [f, setF] = useState<'all' | 'active' | 'never' | 'locked'>('all');
  const [newSid, setNewSid] = useState('');
  const [panel, setPanel] = useState<{ manage: number } | { code: CodeCard } | null>(null);
  const [rmArmed, setRmArmed] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const s = access.stats;
  const term = q.trim().toLowerCase();
  const list = access.logins.filter((l) => {
    if (term && !l.name.toLowerCase().includes(term) && !l.username.toLowerCase().includes(term)) return false;
    if (f === 'active') return l.status === 'active';
    if (f === 'never') return !l.lastActive;
    if (f === 'locked') return l.status === 'locked';
    return true;
  });

  const showCode = (c: CodeCard) => setPanel({ code: c });

  const create = async () => {
    const sid = Number(newSid);
    if (!sid) return toast('Pick a student first.');
    setBusy(true);
    try {
      toast('Issuing a code...');
      const r = await post<{ code: string; expiresAt: string; username: string; name: string }>('/api/staff/logins', { studentId: sid });
      setNewSid('');
      reload();
      showCode({ kind: 'student', name: r.name, username: r.username, code: r.code, expiresAt: r.expiresAt });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  // one at a time: a second code replaces the first, so a double press could show a dead code
  const issue = async (l: LoginRow) => {
    if (busy) return;
    setBusy(true);
    try {
      toast('Issuing a code...');
      const r = await post<{ code: string; expiresAt: string; username: string; name: string }>(`/api/staff/logins/${l.id}/code`);
      reload();
      showCode({ kind: 'student', name: r.name, username: r.username, code: r.code, expiresAt: r.expiresAt });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const act = async (l: LoginRow, action: 'lock' | 'unlock' | 'signout') => {
    try {
      const r = await patch<{ username: string; status?: LoginRow['status']; lastActive?: string | null }>(`/api/staff/logins/${l.id}`, { action });
      reload();
      if (action === 'signout') toast(<Ok>{r.username} is signed out everywhere. Their data is untouched.</Ok>);
      else toast(<Ok>{`${r.username} is now ${statusLabel({ status: r.status!, lastActive: r.lastActive ?? null }).toLowerCase()}.`}</Ok>);
    } catch (e) {
      toastError(e);
    }
  };

  const remove = async (l: LoginRow) => {
    if (rmArmed !== l.id) {
      setRmArmed(l.id);
      return toast(`Removes ${l.username}’s app access only, never the student record. Tap again to confirm.`);
    }
    try {
      await del(`/api/staff/logins/${l.id}`);
      setRmArmed(null);
      setPanel(null);
      reload();
      toast(<Ok>Access removed. {l.name} stays in Students, untouched.</Ok>);
    } catch (e) {
      toastError(e);
    }
  };

  const manage = 'manage' in (panel ?? {}) ? access.logins.find((l) => l.id === (panel as { manage: number }).manage) : undefined;

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 'var(--sp-5)' }}>
        {(
          [
            ['On the roster', s.roster],
            ['Signing in', s.signingIn],
            ['Never signed in', s.never],
            ['No account yet', s.noAccount],
          ] as const
        ).map(([l, v]) => (
          <div key={l} className="card" style={{ margin: 0, padding: '12px 14px' }}>
            <div className="hint">{l}</div>
            <div style={{ fontSize: 19, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-h">
          <h3>Have it, stopped opening it</h3>
          <span className="hint">{access.quiet.length} with a working account, nothing opened for 14 days or more</span>
        </div>
        <div className="card-b">
          {access.quiet.length ? (
            <>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Location</th>
                    <th>Quiet for</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {access.quiet.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <b>{l.name}</b>
                      </td>
                      <td>{l.co || 'Not set'}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{l.quietDays} days</td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn-ghost" onClick={() => setPanel({ manage: l.id })}>
                          Open
                        </button>{' '}
                        <button className="btn-ghost" onClick={() => openWa(l.phone, `Hi ${first(l.name)}, `) || toast('No number on that student record.')}>
                          WhatsApp
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="hint" style={{ marginTop: 10 }}>
                This is the list to ring. Not the locked accounts, and not the ones who never signed in.
              </div>
            </>
          ) : (
            <div className="hint">Nobody with an account has gone quiet. That is the number you want.</div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <h3>Student access</h3>
          <span className="hint">Reset sends a fresh one-time code. Nobody, including BB, can see a current password.</span>
        </div>
        <div className="card-b">
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <input className="filter" placeholder="Search students…" style={{ flex: 2, minWidth: 160 }} value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="filter" style={{ flex: 1, minWidth: 130 }} value={f} onChange={(e) => setF(e.target.value as typeof f)}>
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="never">Never signed in</option>
              <option value="locked">Locked</option>
            </select>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Student</th>
                <th>Username</th>
                <th>Status</th>
                <th>Last active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.length ? (
                list.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <b>{l.name}</b>
                    </td>
                    <td>{l.username}</td>
                    <td>{statusLabel(l)}</td>
                    <td>{l.lastActive || 'Never'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn-ghost" onClick={() => setPanel({ manage: l.id })}>
                        Manage
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} style={{ padding: 0 }}>
                    {term || f !== 'all' ? (
                      <Empty icon="users" title="No account matches" sub="Nothing here matches the search or the filter." />
                    ) : (
                      <Empty icon="users" title="No student logins yet" sub="A login is created when you invite a student to the app." />
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
            <select className="filter" style={{ flex: 1, minWidth: 180 }} value={newSid} onChange={(e) => setNewSid(e.target.value)}>
              {access.withoutLogin.length ? (
                <>
                  <option value="">Choose a student…</option>
                  {access.withoutLogin.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.co}
                    </option>
                  ))}
                </>
              ) : (
                <option value="">Every active student already has access</option>
              )}
            </select>
            <button className="btn-primary" onClick={create} disabled={busy}>
              Create access
            </button>
          </div>
        </div>
      </div>

      {can('parents.manage') && <ParentAccess active={access.active} onCode={showCode} />}

      {panel && 'code' in panel && <CodeBox key={panel.code.code} c={panel.code} onDone={() => setPanel(null)} />}
      {manage && (
        <div className="card">
          <div className="card-h">
            <h3>{manage.name}</h3>
            <span className="hint">
              {manage.program} ({COHORT_SHORT[manage.cohort]}) · {manage.co}
            </span>
          </div>
          <div className="card-b">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, fontSize: 12.5, marginBottom: 12 }}>
              <div>
                <span className="hint">Status</span>
                <br />
                <b>{statusLabel(manage)}</b>
              </div>
              <div>
                <span className="hint">Last active</span>
                <br />
                <b>{manage.lastActive || 'Never'}</b>
              </div>
              <div>
                <span className="hint">Devices signed in</span>
                <br />
                <b>{manage.sessions}</b>
              </div>
              <div>
                <span className="hint">Recent failed logins</span>
                <br />
                <b>{manage.failed}</b>
              </div>
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', margin: '2px 0 6px' }}>Contact</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              <button className="btn-primary" onClick={() => router.push(`/staff/messages?to=${manage.studentId}`)}>
                <Icon name="inbox" /> Message their app
              </button>
              <button className="btn-ghost" onClick={() => router.push(`/staff/messages?to=${manage.studentId}&draft=payment`)}>
                Payment received
              </button>
              <button className="btn-ghost" onClick={() => openWa(manage.phone, `Hi ${first(manage.name)}, `) || toast('No number on that student record.')}>
                <Icon name="phone" /> WhatsApp
              </button>
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', margin: '2px 0 6px' }}>Account</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn-primary" onClick={() => issue(manage)} disabled={busy}>
                Send one-time code
              </button>
              {manage.status === 'locked' ? (
                <button className="btn-ghost" onClick={() => act(manage, 'unlock')}>
                  Unlock
                </button>
              ) : (
                <button className="btn-ghost" onClick={() => act(manage, 'lock')}>
                  Lock account
                </button>
              )}
              <button className="btn-ghost" onClick={() => act(manage, 'signout')}>
                Sign out all devices
              </button>
              <button className="btn-ghost" onClick={() => remove(manage)}>
                {rmArmed === manage.id ? 'Tap again to remove' : 'Remove app access'}
              </button>
            </div>
            <div className="hint" style={{ marginTop: 10 }}>
              A message reaches their app through the same rail the Messages page uses. Locking and signing out take effect on their phones within a
              minute: every session they have is ended. Nothing here ever shows or sets a password, and every action carries your name in the activity
              log.
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* A code that is shown once and can never be read back must not sit in a fading toast. */
function CodeBox({ c, onDone }: { c: CodeCard; onDone: () => void }) {
  const copyText = useCopy();
  const [mins] = useState(() => Math.max(0, Math.round((new Date(c.expiresAt).getTime() - Date.now()) / 60000)));
  const copy = async () => {
    const text =
      c.kind === 'parent'
        ? `BS With Leon · parent access\nOpen: ${window.location.origin}/parent/\nChild's name: ${c.child}\nCode: ${c.code}\nThe code lasts a day.`
        : `BS With Leon · student app\nOpen: ${window.location.origin}/student/\nUsername: ${c.username}\nCode: ${c.code}\nThe code lasts a day.`;
    await copyText(text);
  };
  return (
    <div className="card">
      <div className="card-h">
        <h3>{c.kind === 'parent' ? `Parent code · ${c.label} of ${c.child}` : `Code for ${c.name || c.username}`}</h3>
        <span className="hint">Shown once. Nothing can read it back.</span>
      </div>
      <div className="card-b">
        <div style={{ display: 'flex', gap: 26, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <div className="hint">{c.kind === 'parent' ? 'They type this name' : 'Username'}</div>
            <div style={{ fontSize: 21, fontWeight: 700 }}>{c.kind === 'parent' ? c.child : c.username}</div>
          </div>
          <div>
            <div className="hint">One-time code</div>
            <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: 5, fontVariantNumeric: 'tabular-nums' }}>{c.code}</div>
          </div>
        </div>
        <div className="hint" style={{ marginTop: 12 }}>
          Expires in about {mins} minutes.{' '}
          {c.kind === 'parent'
            ? "The parent opens the parent app, types the child's name and this code. It works on more than one phone."
            : 'Give both to the student in person. If it expires or is lost, issue another.'}
        </div>
        <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
          <button className="btn-ghost" onClick={copy}>
            Copy for WhatsApp
          </button>
          <button className="btn-ghost" onClick={onDone}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/* PARENT ACCESS. A parent signs in with their CHILD'S name and a code on the
   parent app. They see fees, attendance and coverage, never the student's
   own topic ratings or paper marks. One row = one parent of one child. */
function ParentAccess({ active, onCode }: { active: { id: number; name: string }[]; onCode: (c: CodeCard) => void }) {
  const { toast, toastError } = useToast();
  const ask = useDialog();
  const { data, error, mutate } = useSWR<{ parents: ParentRow[] }>('/api/staff/parents', fetcher);
  const [sid, setSid] = useState('');
  const [label, setLabel] = useState('Mother');
  const [busy, setBusy] = useState(false);

  // one at a time: a double press would open two parent accounts, or replace the code just shown
  const issue = async (body: { parentId: number } | { studentId: number; label: string }) => {
    if (busy) return;
    setBusy(true);
    try {
      toast('Issuing a code…');
      const r = await post<{ code: string; expiresAt: string; label: string; child: string }>('/api/staff/parents', body);
      mutate();
      onCode({ kind: 'parent', label: r.label, child: r.child, code: r.code, expiresAt: r.expiresAt });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const lock = async (p: ParentRow, on: boolean) => {
    try {
      await patch(`/api/staff/parents/${p.id}`, { locked: on });
      mutate();
      toast(on ? 'Locked' : 'Unlocked');
    } catch (e) {
      toastError(e);
    }
  };

  const remove = async (p: ParentRow) => {
    if (!(await ask.confirm({ title: `Remove ${p.label}'s access to ${p.child}?`, body: 'They will be signed out.', okLabel: 'Remove', danger: true }))) return;
    try {
      await del(`/api/staff/parents/${p.id}`);
      mutate();
      toast(<Ok>Removed</Ok>);
    } catch (e) {
      toastError(e);
    }
  };

  const rows = data?.parents ?? [];
  const pick = sid || String(active[0]?.id ?? '');
  return (
    <div className="card">
      <div className="card-h">
        <h3>Parent access</h3>
        <span className="hint">Fees, attendance and coverage only · the parent app is at /parent/</span>
      </div>
      <div className="card-b">
        <table className="tbl">
          <thead>
            <tr>
              <th>Child</th>
              <th>Parent</th>
              <th>Status</th>
              <th>Last active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((p) => {
                const pending = p.codeExpires && new Date(p.codeExpires) > new Date() && !p.lastActive;
                const st = p.status === 'locked' ? 'Locked' : p.lastActive ? 'Active' : pending ? 'Code issued, not signed in yet' : 'No code yet';
                return (
                  <tr key={p.id}>
                    <td>{p.child}</td>
                    <td>{p.label}</td>
                    <td>{st}</td>
                    <td className="tnum">{p.lastActive ? fmtDate(p.lastActive) : '-'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn-ghost" style={{ padding: '5px 9px' }} onClick={() => issue({ parentId: p.id })} disabled={busy}>
                        New code
                      </button>{' '}
                      <button className="btn-ghost" style={{ padding: '5px 9px' }} onClick={() => lock(p, p.status !== 'locked')}>
                        {p.status === 'locked' ? 'Unlock' : 'Lock'}
                      </button>{' '}
                      <button className="btn-ghost" style={{ padding: '5px 9px' }} onClick={() => remove(p)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={5} className="hint">
                  {data ? 'No parent has access yet.' : error ? `Could not load parent access: ${(error as Error).message}` : 'Loading…'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          <select className="filter" style={{ flex: 1, minWidth: 180 }} value={pick} onChange={(e) => setSid(e.target.value)}>
            {active.length ? (
              active.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))
            ) : (
              <option value="">No active students</option>
            )}
          </select>
          <select className="filter" style={{ minWidth: 120 }} value={label} onChange={(e) => setLabel(e.target.value)}>
            <option>Mother</option>
            <option>Father</option>
            <option>Guardian</option>
            <option>Parent</option>
          </select>
          <button
            className="btn-primary"
            disabled={busy}
            onClick={() => (Number(pick) ? issue({ studentId: Number(pick), label }) : toast('Pick a student.'))}
          >
            Give a parent access
          </button>
        </div>
      </div>
    </div>
  );
}
