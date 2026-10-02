'use client';

/* Activity (original §16): the activity log and the sign-in audit,
   newest first, 100 at a time with "Show older". */

import { useState } from 'react';
import useSWRInfinite from 'swr/infinite';
import { fetcher } from '@/lib/client/api';
import { Empty, ErrorCard, Loading, Tabs } from '@/components/staff/ui';
import { Icon } from '@/components/staff/Icon';
import { feedStamp } from '@/lib/shared/dates';
import { roleLabel, type StaffRole } from '@/lib/shared/rbac';

type FeedRow = { id: number; t: string; m: string; at: string; who: string | null };
type LoginRow = { id: number; realm: string; name: string; role: string; device: string; ok: boolean; at: string };
type Page<T> = { rows: T[]; more: boolean };
type Realm = 'all' | 'staff' | 'student' | 'parent';

function useFeed<T extends { id: number }>(base: string) {
  const r = useSWRInfinite<Page<T>>(
    (i, prev) => {
      if (i === 0) return base;
      if (!prev?.more) return null;
      return `${base}&before=${prev.rows[prev.rows.length - 1].id}`;
    },
    fetcher,
  );
  const rows = (r.data ?? []).flatMap((p) => p.rows);
  const more = !!r.data?.[r.data.length - 1]?.more;
  return { ...r, rows, more };
}

const roleBadge = (role: string) => (role === 'owner' ? 'bdg-stage' : role === 'manager' ? 'bdg-blue' : 'bdg-grey');
const roleText = (role: string) => (role === 'owner' || role === 'manager' || role === 'staff' ? roleLabel(role as StaffRole) : role === 'student' ? 'Student' : role === 'parent' ? 'Parent' : role);

export default function ActivityPage() {
  const [tab, setTab] = useState<'feed' | 'login'>('feed');
  return (
    <>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ['feed', 'Activity log'],
          ['login', 'Login audit'],
        ]}
      />
      {tab === 'feed' ? <Feed /> : <Logins />}
    </>
  );
}

function Feed() {
  const f = useFeed<FeedRow>('/api/staff/activity?tab=feed');
  if (f.error && !f.data) return <ErrorCard error={f.error} retry={() => f.mutate()} />;
  return (
    <div className="card">
      <div className="card-h">
        <h3>What happened</h3>
        <span className="hint">Every action, newest first</span>
      </div>
      <div className="card-b">
        {!f.data ? (
          <Loading />
        ) : f.rows.length ? (
          <>
            {f.rows.map((a) => (
              <div className="feed-item" key={a.id}>
                <div className="feed-ic">
                  <Icon name="check" className="" />
                </div>
                <div className="feed-main">
                  <div className="feed-t">{a.t}</div>
                  <div className="feed-m">
                    {a.m}
                    {a.m ? ' · ' : ''}
                    {a.who ?? 'System'}
                  </div>
                </div>
                <div className="feed-when">{feedStamp(a.at)}</div>
              </div>
            ))}
            {f.more && (
              <div style={{ textAlign: 'center', padding: '12px 0' }}>
                <button className="btn-ghost" disabled={f.isValidating} onClick={() => f.setSize(f.size + 1)}>
                  {f.isValidating ? 'Loading…' : 'Show older'}
                </button>
              </div>
            )}
          </>
        ) : (
          <Empty icon="doc" title="No activity yet" sub="Actions across the system show up here." />
        )}
      </div>
    </div>
  );
}

function Logins() {
  const [realm, setRealm] = useState<Realm>('staff');
  const f = useFeed<LoginRow>(`/api/staff/activity?tab=login${realm === 'all' ? '' : `&realm=${realm}`}`);
  if (f.error && !f.data) return <ErrorCard error={f.error} retry={() => f.mutate()} />;
  return (
    <div className="card">
      <div className="card-h" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h3>Sign-ins</h3>
          <span className="hint">Who signed in, where and when</span>
        </div>
        <div className="pay-chips" style={{ margin: 0 }}>
          {(
            [
              ['staff', 'Team'],
              ['student', 'Students'],
              ['parent', 'Parents'],
              ['all', 'Everyone'],
            ] as [Realm, string][]
          ).map(([k, l]) => (
            <button key={k} className={`chip${realm === k ? ' on' : ''}`} aria-pressed={realm === k} onClick={() => setRealm(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Device</th>
              <th>Result</th>
              <th className="tnum">Signed in</th>
            </tr>
          </thead>
          <tbody>
            {!f.data ? (
              <tr>
                <td colSpan={5}>
                  <Loading />
                </td>
              </tr>
            ) : f.rows.length ? (
              f.rows.map((a) => (
                <tr key={a.id}>
                  <td className="tn">{a.name}</td>
                  <td>
                    <span className={`bdg ${roleBadge(a.role)}`}>{roleText(a.role)}</span>
                  </td>
                  <td className="tm">{a.device}</td>
                  <td>{a.ok ? <span className="bdg bdg-green">Signed in</span> : <span className="bdg bdg-action">Failed</span>}</td>
                  <td className="tnum" style={{ fontWeight: 500, color: 'var(--muted)' }}>
                    {feedStamp(a.at)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} style={{ padding: 0 }}>
                  <Empty icon="lock" title="No sign-ins yet" sub="Each sign-in, and each failed attempt, is recorded here." />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {f.more && (
        <div style={{ textAlign: 'center', padding: '12px 0' }}>
          <button className="btn-ghost" disabled={f.isValidating} onClick={() => f.setSize(f.size + 1)}>
            {f.isValidating ? 'Loading…' : 'Show older'}
          </button>
        </div>
      )}
    </div>
  );
}
