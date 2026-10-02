'use client';

/* Team (original §5, renderTeam + STAFFADD). One card per active person:
   records owned, open, won, revenue and close rate; a card opens that
   person's enquiries. Owners also add users and manage logins: change a
   role, deactivate / reactivate, set a temporary password. The server
   refuses to leave the system without an active owner. */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { fetcher, patch, post } from '@/lib/client/api';
import { useStaff } from '@/components/staff/StaffContext';
import { ErrorCard, Loading, Ok, Panel, PanelHead, useToast } from '@/components/staff/ui';
import { Icon } from '@/components/staff/Icon';
import { useCopy, useDialog } from '@/components/staff/Dialog';
import { lkr } from '@/lib/shared/constants';
import { relTime } from '@/lib/shared/dates';
import { roleLabel, type StaffRole } from '@/lib/shared/rbac';

type Person = {
  id: number;
  name: string;
  email?: string;
  role: StaffRole;
  active: boolean;
  lastLoginAt: string | null;
  mustChangePassword: boolean;
  own: number;
  open: number;
  won: number;
  rev: number;
};

const ROLES: [StaffRole, string][] = [
  ['staff', 'Sales · sees their own leads and tasks'],
  ['manager', 'Manager · full access except Customize'],
  ['owner', 'Owner · everything, including adding users'],
];

/* 12 crypto-random characters with no lookalikes, XXXX-XXXX-XXXX, redrawn
   until it carries both letters and digits (the password rule). */
function genPw() {
  const cs = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  for (;;) {
    const a = new Uint32Array(12);
    crypto.getRandomValues(a);
    let out = '';
    for (const n of a) out += cs[n % cs.length];
    if (/\d/.test(out) && /[A-Za-z]/.test(out)) return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
  }
}

export default function TeamPage() {
  const { me, config, can, refreshConfig } = useStaff();
  const router = useRouter();
  const { data, error, mutate } = useSWR<{ people: Person[]; canManage: boolean }>('/api/staff/team', fetcher);
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState<Person | null>(null);

  if (error && !data) return <ErrorCard error={error} retry={() => mutate()} />;
  if (!data) return <Loading />;
  const active = data.people.filter((p) => p.active);
  const inactive = data.people.filter((p) => !p.active);
  const isOwner = can('team.manage');

  return (
    <>
      <div className="team-bar">
        <span className="hint">
          {active.length} {active.length === 1 ? 'person' : 'people'} on the team
        </span>
        {isOwner && (
          <button className="btn-primary" onClick={() => setAdding(true)}>
            <Icon name="plus" className="" size={14} strokeWidth={2.5} /> Add user
          </button>
        )}
      </div>

      <div className="team-grid">
        {active.map((s) => {
          const conv = s.own ? Math.round((s.won / s.own) * 100) : 0;
          const mine = s.id === me.id;
          return (
            <div
              key={s.id}
              className={`tp-card${mine ? ' tp-me' : ''}`}
              role="link"
              tabIndex={0}
              onClick={() => router.push(`/staff/records?owner=${s.id}`)}
              onKeyDown={(e) => e.key === 'Enter' && router.push(`/staff/records?owner=${s.id}`)}
            >
              <div className="tp-head">
                <div className="tp-av">{s.name[0]}</div>
                <div>
                  <div className="tp-nm">
                    {s.name}
                    {mine && <span className="tp-you">You</span>}
                  </div>
                  <div className="tp-rl">{roleLabel(s.role)}</div>
                </div>
                <span className="tp-pill">{conv}% close</span>
              </div>
              <div className="tp-stats">
                <div className="tp-stat">
                  <div className="v">{s.own}</div>
                  <div className="l">{config.entity.plural}</div>
                </div>
                <div className="tp-stat">
                  <div className="v">{s.open}</div>
                  <div className="l">Open</div>
                </div>
                <div className="tp-stat">
                  <div className="v">{s.won}</div>
                  <div className="l">Won</div>
                </div>
                <div className="tp-stat">
                  <div className="v" style={{ fontSize: 12.5, paddingTop: 3 }}>
                    {s.rev ? lkr(s.rev) : '-'}
                  </div>
                  <div className="l">Revenue</div>
                </div>
              </div>
              {isOwner && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, gap: 8 }}>
                  <span className="hint">{s.lastLoginAt ? `Signed in ${relTime(s.lastLoginAt)}` : 'Never signed in'}</span>
                  <button
                    className="btn-ghost"
                    style={{ padding: '6px 11px' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setManaging(s);
                    }}
                  >
                    <Icon name="settings" /> Manage
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isOwner && inactive.length > 0 && (
        <div className="card" style={{ marginTop: 20 }}>
          <div className="card-h">
            <h3>Deactivated</h3>
            <span className="hint">cannot sign in · their records keep their name</span>
          </div>
          <div className="card-b">
            {inactive.map((s) => (
              <div className="chase-row" key={s.id} style={{ padding: '11px 0' }}>
                <div className="grow">
                  <div className="tn">{s.name}</div>
                  <div className="hint">
                    {roleLabel(s.role)} · {s.email}
                  </div>
                </div>
                <button className="btn-ghost" onClick={() => setManaging(s)}>
                  Manage
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <Panel open={adding} onClose={() => setAdding(false)}>
        {adding && (
          <AddUser
            onClose={() => setAdding(false)}
            onDone={() => {
              mutate();
              // the owner / assignee pickers everywhere read the team from the config
              refreshConfig();
            }}
          />
        )}
      </Panel>
      <Panel open={!!managing} onClose={() => setManaging(null)}>
        {managing && (
          <ManageUser
            key={managing.id}
            person={managing}
            isMe={managing.id === me.id}
            onClose={() => setManaging(null)}
            onChanged={async () => {
              const r = await mutate();
              refreshConfig();
              const fresh = r?.people.find((p) => p.id === managing.id);
              if (fresh) setManaging(fresh);
            }}
          />
        )}
      </Panel>
    </>
  );
}

function AddUser({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const ask = useDialog();
  const copyText = useCopy();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRole>('staff');
  const [pw, setPw] = useState(genPw);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ name: string; role: StaffRole; email: string; pw: string } | null>(null);

  const save = async () => {
    setErr('');
    const n = name.trim().replace(/\s+/g, ' ');
    const e = email.trim().toLowerCase();
    if (!n) return setErr('Give them a name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return setErr('That email does not look right.');
    if (!ROLES.some((r) => r[0] === role)) return setErr('Pick a role.');
    if (pw.length < 10 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return setErr('The password needs at least 10 characters, with letters and numbers.');
    if (role === 'owner' && !(await ask.confirm({ title: `Make ${n} an OWNER?`, body: 'Owners can see everything, change settings and add or remove users.', okLabel: 'Make owner' }))) return;
    setBusy(true);
    try {
      await post('/api/staff/team', { name: n, email: e, role, password: pw });
      setDone({ name: n, role, email: e, pw });
      onDone();
      toast(
        <Ok>
          {n} added as {roleLabel(role)}.
        </Ok>,
      );
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const details = done ? `BS With Leon staff system\nEmail: ${done.email}\nPassword: ${done.pw}\nSign in: ${location.origin}/staff/login` : '';

  return (
    <>
      <PanelHead title="Add a user" sub="They sign in to this system with the email and password below" onClose={onClose} />
      <div className="pn-body">
        <div className="sec">
          {done ? (
            <>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{done.name} can sign in now</div>
              <div className="hint" style={{ marginBottom: 10 }}>
                Pass these on privately. They sign in with this email and password and choose their own password straight away. This password is not shown again.
              </div>
              <div className="su-done">
                <div className="r">
                  <span>Role</span>
                  <b>{roleLabel(done.role)}</b>
                </div>
                <div className="r">
                  <span>Email</span>
                  <b>{done.email}</b>
                </div>
                <div className="r">
                  <span>Password</span>
                  <b>{done.pw}</b>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-ghost" onClick={() => copyText(details)}>
                  Copy details
                </button>
                <button className="btn-primary" onClick={onClose}>
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="su-f">
                <label className="hint" htmlFor="suName">
                  Name
                </label>
                <input className="filter" id="suName" maxLength={60} placeholder="Full name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </div>
              <div className="su-f">
                <label className="hint" htmlFor="suEmail">
                  Email
                </label>
                <input className="filter" id="suEmail" type="email" maxLength={120} placeholder="name@example.com" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="su-f">
                <label className="hint" htmlFor="suRole">
                  Role
                </label>
                <select className="filter" id="suRole" value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
                  {ROLES.map(([r]) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </select>
                <div className="hint" style={{ marginTop: 6 }}>
                  {ROLES.find((r) => r[0] === role)?.[1]}
                </div>
              </div>
              <div className="su-f">
                <label className="hint" htmlFor="suPw">
                  Starting password
                </label>
                <div className="su-pw">
                  <input className="filter" id="suPw" type="text" maxLength={72} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
                  <button className="btn-ghost" type="button" onClick={() => setPw(genPw())}>
                    New
                  </button>
                </div>
                <div className="hint" style={{ marginTop: 6 }}>
                  At least 10 characters, with letters and numbers. You will see it once more after saving, to pass on.
                </div>
              </div>
              <div className="su-err" role="alert">
                {err}
              </div>
              <button className="btn-primary" disabled={busy} onClick={save}>
                {busy ? 'Creating' : 'Create user'}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function ManageUser({ person, isMe, onClose, onChanged }: { person: Person; isMe: boolean; onClose: () => void; onChanged: () => Promise<void> }) {
  const { toast, toastUndo, toastError } = useToast();
  const ask = useDialog();
  const copyText = useCopy();
  const [role, setRole] = useState<StaffRole>(person.role);
  const [pw, setPw] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const url = `/api/staff/team/${person.id}`;

  const run = async (fn: () => Promise<void>) => {
    setErr('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveRole = () =>
    run(async () => {
      if (role === 'owner' && !(await ask.confirm({ title: `Make ${person.name} an OWNER?`, body: 'Owners can see everything, change settings and add or remove users.', okLabel: 'Make owner' }))) return;
      const prev = person.role;
      await patch(url, { role });
      await onChanged();
      toastUndo(
        <Ok>
          {person.name} is now {roleLabel(role)}
        </Ok>,
        async () => {
          try {
            await patch(url, { role: prev });
            await onChanged();
            toast(<Ok>Undone</Ok>);
          } catch (e) {
            toastError(e);
          }
        },
      );
    });

  const toggleActive = () =>
    run(async () => {
      const next = !person.active;
      if (
        !next &&
        !(await ask.confirm({
          title: `Deactivate ${person.name}?`,
          body: 'They are signed out everywhere and cannot sign in until reactivated. Their records stay.',
          okLabel: 'Deactivate',
          danger: true,
        }))
      )
        return;
      await patch(url, { active: next });
      await onChanged();
      toastUndo(<Ok>{next ? `${person.name} reactivated` : `${person.name} deactivated`}</Ok>, async () => {
        try {
          await patch(url, { active: !next });
          await onChanged();
          toast(<Ok>Undone</Ok>);
        } catch (e) {
          toastError(e);
        }
      });
    });

  const resetPw = () =>
    run(async () => {
      if (!pw) return;
      await patch(url, { password: pw });
      setShown(pw);
      setPw(null);
      await onChanged();
      toast(<Ok>Temporary password set for {person.name}</Ok>);
    });

  return (
    <>
      <PanelHead
        title={person.name}
        sub={`${roleLabel(person.role)} · ${person.email ?? ''}`}
        badges={
          <>
            <span className={`bdg ${person.active ? 'bdg-green' : 'bdg-grey'}`}>{person.active ? 'Active' : 'Deactivated'}</span>
            {person.mustChangePassword && <span className="bdg bdg-amber">Temporary password</span>}
          </>
        }
        onClose={onClose}
      />
      <div className="pn-body">
        <div className="sec">
          <div className="sec-t">Role</div>
          <div className="su-f">
            <select className="filter" value={role} onChange={(e) => setRole(e.target.value as StaffRole)} aria-label="Role">
              {ROLES.map(([r]) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
            <div className="hint" style={{ marginTop: 6 }}>
              {ROLES.find((r) => r[0] === role)?.[1]}
            </div>
          </div>
          <button className="btn-primary" disabled={busy || role === person.role} onClick={saveRole}>
            Save role
          </button>
        </div>

        {!isMe && (
          <div className="sec">
            <div className="sec-t">Password</div>
            {shown ? (
              <>
                <div className="hint" style={{ marginBottom: 10 }}>
                  Pass this on privately. They are signed out everywhere and choose their own password at the next sign-in. It is not shown again.
                </div>
                <div className="su-done">
                  <div className="r">
                    <span>Email</span>
                    <b>{person.email}</b>
                  </div>
                  <div className="r">
                    <span>Password</span>
                    <b>{shown}</b>
                  </div>
                </div>
                <button className="btn-ghost" onClick={() => copyText(`BS With Leon staff system\nEmail: ${person.email}\nPassword: ${shown}\nSign in: ${location.origin}/staff/login`)}>
                  Copy details
                </button>
              </>
            ) : pw === null ? (
              <button className="btn-ghost" onClick={() => setPw(genPw())}>
                <Icon name="lock" /> Set a temporary password
              </button>
            ) : (
              <>
                <div className="su-f">
                  <div className="su-pw">
                    <input className="filter" type="text" maxLength={72} value={pw} onChange={(e) => setPw(e.target.value)} aria-label="Temporary password" />
                    <button className="btn-ghost" type="button" onClick={() => setPw(genPw())}>
                      New
                    </button>
                  </div>
                  <div className="hint" style={{ marginTop: 6 }}>
                    At least 10 characters, with letters and numbers.
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-ghost" onClick={() => setPw(null)}>
                    Cancel
                  </button>
                  <button className="btn-primary" disabled={busy} onClick={resetPw}>
                    Set password
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        <div className="sec">
          <div className="sec-t">Access</div>
          <div className="hint" style={{ marginBottom: 10 }}>
            {person.active ? 'Deactivating signs them out everywhere at once. Nothing they did is deleted.' : 'They can sign in again with their existing password.'}
          </div>
          <button className={person.active ? 'btn-danger' : 'btn-primary'} disabled={busy} onClick={toggleActive}>
            {person.active ? 'Deactivate' : 'Reactivate'}
          </button>
        </div>
        {err && (
          <div className="su-err" role="alert" style={{ padding: '0 20px 16px' }}>
            {err}
          </div>
        )}
      </div>
    </>
  );
}
