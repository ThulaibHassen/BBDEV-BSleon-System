'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { api, fetcher, patch } from '@/lib/client/api';
import { lkr } from '@/lib/shared/constants';
import { todayISO } from '@/lib/shared/dates';
import { Icon } from '@/components/staff/Icon';
import { Empty, ErrorCard, Loading, Ok, Panel, useToast } from '@/components/staff/ui';
import { useStaff } from '@/components/staff/StaffContext';
import { EnquiryModal } from '@/components/staff/crm/EnquiryModal';
import { EnquiryPanel } from '@/components/staff/crm/EnquiryPanel';
import { EnrolPanel } from '@/components/staff/crm/EnrolPanel';
import { fieldLabel, isOpenStage, stageLabel, staffName, type Enquiry } from '@/components/staff/crm/types';

/* ENQUIRIES: one page, two readings of the same records (Table / Board).
   Both read the one narrowing function, so they can never disagree. */

type PanelState = { kind: 'record'; id: number } | { kind: 'enrol'; id: number } | null;

export default function RecordsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Records />
    </Suspense>
  );
}

function Records() {
  const { config, isMaster, can, refreshBadges } = useStaff();
  const { toast, toastUndo, toastError } = useToast();
  const router = useRouter();
  const sp = useSearchParams();
  const [view, setView] = useState<'table' | 'board'>('table');
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('all');
  const [owner, setOwner] = useState('all');
  const [panel, setPanel] = useState<PanelState>(null);
  const [modal, setModal] = useState<{ open: boolean; id: number | null }>({ open: false, id: null });

  const key = `/api/staff/records${isMaster && owner !== 'all' ? `?owner=${owner}` : ''}`;
  const { data, error, mutate } = useSWR<{ rows: Enquiry[] }>(key, fetcher);
  const all = useMemo(() => data?.rows ?? [], [data]);
  const refresh = useCallback(() => void mutate(), [mutate]);

  /* ?new=1 (topbar button), ?open=<id> (search, dashboard) and ?owner=<id>
     (a Team card: that person's enquiries): read once per URL during render
     (derived state), then the URL is cleaned so the same link works again. */
  const spKey = sp.toString();
  const [seenKey, setSeenKey] = useState('');
  if (spKey !== seenKey) {
    setSeenKey(spKey);
    const o = Number(sp.get('open'));
    if (sp.get('new') && can('enquiries.write')) setModal({ open: true, id: null });
    if (o) setPanel({ kind: 'record', id: o });
    const ow = sp.get('owner');
    if (ow && isMaster) setOwner(ow);
  }
  useEffect(() => {
    if (sp.get('new') || sp.get('open') || sp.get('owner')) router.replace('/staff/records', { scroll: false });
  }, [sp, router]);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return all
      .filter((r) => view === 'board' || stage === 'all' || r.stage === stage)
      .filter((r) => !t || `${r.name} ${r.co || ''} ${r.phone || ''}`.toLowerCase().includes(t))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  }, [all, q, stage, view]);

  const today = todayISO();
  const isDue = (r: Enquiry) => !!r.followUp && r.followUp <= today && isOpenStage(config, r.stage);
  const current = panel ? all.find((r) => r.id === panel.id) : undefined;
  const editing = modal.id ? (all.find((r) => r.id === modal.id) ?? null) : null;

  const exportRows = async () => {
    try {
      const qs = new URLSearchParams({ owner: isMaster ? owner : 'all', stage: view === 'table' ? stage : 'all', q });
      const res = await api<Response>(`/api/staff/records/export?${qs}`, { raw: true });
      if (!res.ok) throw new Error('Export failed. Try again.');
      const n = Number(res.headers.get('X-Row-Count') || 0);
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'enquiries.csv';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await res.blob());
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 500);
      toast(
        <Ok>
          Exported: {n} row{n === 1 ? '' : 's'} as shown.
        </Ok>,
      );
    } catch (e) {
      toastError(e);
    }
  };

  /* ── board drag ── */
  const dragId = useRef<number | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const drop = async (k: string) => {
    setOver(null);
    const r = all.find((x) => x.id === dragId.current);
    dragId.current = null;
    if (!r || r.stage === k) return;
    const prev = r.stage;
    await mutate({ rows: all.map((x) => (x.id === r.id ? { ...x, stage: k } : x)) }, { revalidate: false });
    try {
      await patch(`/api/staff/records/${r.id}`, { stage: k });
      refresh();
      refreshBadges();
      toastUndo(`${r.name} → ${stageLabel(config, k)}`, async () => {
        await patch(`/api/staff/records/${r.id}`, { stage: prev, undo: true }).then(() => toast(<Ok>Undone</Ok>), toastError);
        refresh();
        refreshBadges();
      });
    } catch (e) {
      refresh();
      toastError(e);
    }
  };

  const plural = config.entity.plural;
  const stageSel = (
    <select className="filter" value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Stage">
      <option value="all">All stages</option>
      {config.stages.map((s) => (
        <option key={s.k} value={s.k}>
          {s.label}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <div className="toolbar">
        <div className="seg-toggle">
          <button className={`segt${view === 'table' ? ' active' : ''}`} onClick={() => setView('table')}>
            Table
          </button>
          <button className={`segt${view === 'board' ? ' active' : ''}`} onClick={() => setView('board')}>
            Board
          </button>
        </div>
        <input className="filter" style={{ minWidth: 150 }} placeholder="Search a name or number" value={q} onChange={(e) => setQ(e.target.value)} />
        {view === 'table' && stageSel}
        {isMaster && (
          <select className="filter" value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner">
            <option value="all">Whole team</option>
            {config.team
              .filter((s) => s.active)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        )}
        <div className="sp" />
        <button className="btn-ghost" onClick={exportRows}>
          <Icon name="download" />
          Export
        </button>
      </div>

      {error ? (
        <ErrorCard error={error} retry={refresh} />
      ) : !data ? (
        <Loading />
      ) : view === 'table' ? (
        <>
          <div className="hint">{rows.length === all.length ? `${rows.length} ${plural.toLowerCase()}` : `${rows.length} of ${all.length} shown`}</div>
          <div className="card">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{fieldLabel(config, 'name')}</th>
                  <th>{fieldLabel(config, 'stage')}</th>
                  <th>{fieldLabel(config, 'owner')}</th>
                  <th>{fieldLabel(config, 'followUp')}</th>
                  <th className="tnum">{fieldLabel(config, 'value')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} onClick={() => setPanel({ kind: 'record', id: r.id })}>
                    <td>
                      <div className="tn">{r.name}</div>
                      <div className="tm">{r.co || ''}</div>
                    </td>
                    <td>
                      <span className="bdg bdg-stage">{stageLabel(config, r.stage)}</span>
                    </td>
                    <td>{staffName(config, r.owner)}</td>
                    <td>{isDue(r) ? <span className="bdg bdg-action">{r.followUp}</span> : r.followUp || <span style={{ color: 'var(--faint)' }}>-</span>}</td>
                    <td className="tnum">{r.value ? lkr(r.value) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && (
              <Empty
                icon="inbox"
                title={`No ${plural.toLowerCase()}`}
                sub="Nothing matches this filter."
                cta={
                  can('enquiries.write') && (
                    <button className="btn-ghost" onClick={() => setModal({ open: true, id: null })}>
                      Add the first one
                    </button>
                  )
                }
              />
            )}
          </div>
        </>
      ) : (
        <>
          <div className="hint" style={{ marginBottom: 10 }}>
            Drag a card to move a student through the stages.
          </div>
          <div className="board">
            {config.stages
              .filter((s) => s.board)
              .map((st) => {
                const cards = rows.filter((r) => r.stage === st.k);
                return (
                  <div
                    key={st.k}
                    className={`col${over === st.k ? ' dragover' : ''}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setOver(st.k);
                    }}
                    onDragLeave={() => setOver((o) => (o === st.k ? null : o))}
                    onDrop={(e) => {
                      e.preventDefault();
                      drop(st.k);
                    }}
                  >
                    <div className="col-h">
                      <span className="ct">
                        <span className="dot" style={{ background: st.color }} />
                        {st.label}
                      </span>
                      <span className="cn">{cards.length}</span>
                    </div>
                    <div className="col-b">
                      {cards.length ? (
                        cards.map((r) => {
                          const own = staffName(config, r.owner);
                          return (
                            <div
                              key={r.id}
                              className="lead-card"
                              draggable={can('enquiries.write')}
                              onDragStart={(e) => {
                                dragId.current = r.id;
                                e.currentTarget.classList.add('dragging');
                                e.dataTransfer.effectAllowed = 'move';
                              }}
                              onDragEnd={(e) => {
                                e.currentTarget.classList.remove('dragging');
                                setOver(null);
                              }}
                              onClick={() => setPanel({ kind: 'record', id: r.id })}
                            >
                              <div className="lc-top">
                                <div>
                                  <div className="lc-nm">{r.name}</div>
                                  <div className="lc-co">{r.co || ''}</div>
                                </div>
                                {isDue(r) && <span className="bdg bdg-action">DUE</span>}
                              </div>
                              <div className="lc-foot">
                                <span className="lc-val">{r.value ? lkr(r.value) : '-'}</span>
                                <span className="lc-own" title={own}>
                                  {own[0]}
                                </span>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="empty" style={{ padding: '18px 8px' }}>
                          <div className="es-ic" style={{ width: 38, height: 38 }}>
                            <Icon name="inbox" />
                          </div>
                          Nothing here yet
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </>
      )}

      <Panel open={!!panel && (panel.kind === 'enrol' || !!current)} onClose={() => setPanel(null)}>
        {panel?.kind === 'record' && current && (
          <EnquiryPanel
            r={current}
            onClose={() => setPanel(null)}
            onEdit={() => setModal({ open: true, id: current.id })}
            onEnrol={() => setPanel({ kind: 'enrol', id: current.id })}
            onChanged={refresh}
            onOpenStudent={(id) => router.push(`/staff/customers?open=${id}`)}
          />
        )}
        {panel?.kind === 'enrol' && (
          <EnrolPanel
            key={panel.id}
            rec={current ?? null}
            onClose={() => setPanel(null)}
            onDone={() => {
              setPanel(null);
              refresh();
              router.push('/staff/customers');
            }}
          />
        )}
      </Panel>
      <EnquiryModal open={modal.open} record={editing} onClose={() => setModal({ open: false, id: null })} onSaved={refresh} />
    </>
  );
}
