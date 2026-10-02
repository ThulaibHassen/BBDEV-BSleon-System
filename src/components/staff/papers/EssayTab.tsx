'use client';

/* Essay templates: Leon's model layout for a 10–15 mark answer. Edited as a
   draft with ONE Save, so a half-typed layout is never live. A new template
   starts with headings only: the words must be Leon's own. */

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher, post, patch, del } from '@/lib/client/api';
import { useToast, Ok, Empty, ErrorCard, Loading, Panel, PanelHead, Switch } from '@/components/staff/ui';
import { Icon } from '@/components/staff/Icon';
import { useDialog } from '@/components/staff/Dialog';
import { cohortLabel, CohortSelect, plural, Row, PlusIcon } from './common';

type Part = { h: string; t: string; m: number | null };
type Essay = {
  id: number;
  title: string;
  unit: string | null;
  cohort: number | null;
  marks: number;
  question: string | null;
  parts: Part[];
  notes: string | null;
  published: boolean;
  updatedAt: string;
};

const MARKS = [5, 8, 10, 12, 13, 15, 20, 25];

export function EssayTab() {
  const { toast, toastError } = useToast();
  const ask = useDialog();
  const { data: list, error, mutate } = useSWR<Essay[]>('/api/staff/essays', fetcher);
  const [openId, setOpenId] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);

  const newT = async () => {
    const t = await ask.prompt({ title: 'New essay template', label: 'Name', placeholder: 'Unit 5 · Discuss the advantages of …', okLabel: 'Create', maxLength: 120 });
    if (t === null) return;
    try {
      const row = await post<Essay>('/api/staff/essays', { title: t.slice(0, 120) });
      await mutate();
      setOpenId(row.id);
      toast(<Ok>Template created</Ok>);
    } catch (e) {
      toastError(e);
    }
  };
  const remove = async (t: Essay) => {
    if (!(await ask.confirm({ title: `Delete the essay template "${t.title}"?`, body: 'This cannot be undone.', okLabel: 'Delete', danger: true }))) return;
    try {
      await del(`/api/staff/essays/${t.id}`);
      await mutate();
      toast(<Ok>Deleted</Ok>);
    } catch (e) {
      toastError(e);
    }
  };
  const close = async () => {
    if (dirty && !(await ask.confirm({ title: 'Close without saving your changes?', okLabel: 'Discard', danger: true }))) return;
    setDirty(false);
    setOpenId(null);
  };

  if (error) return <ErrorCard error={error} retry={() => mutate()} />;
  const sel = list?.find((t) => t.id === openId);

  return (
    <>
      <div className="team-bar">
        <span className="hint">{plural(list?.length ?? 0, 'template')}</span>
        <button className="btn-primary" onClick={newT}>
          <PlusIcon /> New essay template
        </button>
      </div>
      {!list ? (
        <Loading />
      ) : !list.length ? (
        <Empty
          icon="doc"
          title="No essay templates yet"
          sub="Lay out how a 10–15 mark answer should be built: the introduction, each point, the conclusion, and what each part earns."
        />
      ) : (
        <div className="qz-grid">
          {list.map((t) => (
            <div className="qz-card" key={t.id}>
              <div>
                <h4>{t.title}</h4>
                <div className="qz-meta" style={{ marginTop: 4 }}>
                  {t.unit ? `Unit ${t.unit} · ` : ''}
                  {cohortLabel(t.cohort)} · {t.marks || 15} marks · {plural(t.parts.length, 'part')}
                </div>
                {t.question && (
                  <div className="qz-meta" style={{ marginTop: 6, fontStyle: 'italic' }}>
                    {t.question.slice(0, 140)}
                    {t.question.length > 140 ? '…' : ''}
                  </div>
                )}
              </div>
              <div>
                <span className={`qz-tag${t.published ? ' on' : ''}`}>{t.published ? 'Published' : 'Draft'}</span>
              </div>
              <div className="qz-acts">
                <button className="btn-ghost" onClick={() => setOpenId(t.id)}>
                  Edit layout
                </button>
                <button className="btn-ghost" onClick={() => remove(t)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Panel open={!!sel} onClose={close}>
        {sel && <EssayEditor key={sel.id} t={sel} dirty={dirty} setDirty={setDirty} onClose={close} onSaved={() => mutate()} />}
      </Panel>
    </>
  );
}

function EssayEditor({ t, dirty, setDirty, onClose, onSaved }: { t: Essay; dirty: boolean; setDirty: (v: boolean) => void; onClose: () => void; onSaved: () => void }) {
  const { toast, toastError } = useToast();
  const [d, setD] = useState<Essay>(() => JSON.parse(JSON.stringify({ ...t, parts: Array.isArray(t.parts) ? t.parts : [] })));
  const [busy, setBusy] = useState(false);
  const upd = (p: Partial<Essay>) => {
    setD((x) => ({ ...x, ...p }));
    setDirty(true);
  };
  const updPart = (i: number, p: Partial<Part>) => upd({ parts: d.parts.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const movePart = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= d.parts.length) return;
    const a = [...d.parts];
    [a[i], a[j]] = [a[j], a[i]];
    upd({ parts: a });
  };

  const sum = d.parts.reduce((s, p) => s + (Number(p.m) || 0), 0);
  const marks = d.marks || 15;

  const save = async () => {
    if (!d.title.trim()) return toast('A template needs a title');
    const parts = d.parts.map((p) => ({ h: (p.h || '').trim().slice(0, 80), t: (p.t || '').trim().slice(0, 800), m: p.m == null ? null : Number(p.m) })).filter((p) => p.h || p.t);
    if (!parts.length) return toast('Add at least one part to the layout');
    setBusy(true);
    try {
      await patch(`/api/staff/essays/${d.id}`, {
        title: d.title.trim(),
        unit: d.unit?.trim() || null,
        cohort: d.cohort,
        marks,
        question: d.question?.trim() || null,
        parts,
        notes: d.notes?.trim() || null,
        published: d.published,
      });
      setDirty(false);
      onSaved();
      toast(<Ok>Saved</Ok>);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const inStyle: React.CSSProperties = { background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 9, padding: '8px 10px', fontSize: 13, color: 'var(--ink)', fontFamily: 'inherit' };

  return (
    <>
      <PanelHead title={d.title || 'Essay template'} sub={`${marks} marks · ${plural(d.parts.length, 'part')}`} onClose={onClose} />
      <div className="pn-body">
        <div className="sec">
          <div className="mq-f">
            <label htmlFor="esTitle">Title</label>
            <input type="text" id="esTitle" maxLength={120} value={d.title} onChange={(e) => upd({ title: e.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div className="mq-f" style={{ flex: '0 0 90px' }}>
              <label htmlFor="esUnit">Unit</label>
              <input type="text" id="esUnit" maxLength={4} value={d.unit ?? ''} onChange={(e) => upd({ unit: e.target.value })} />
            </div>
            <div className="mq-f" style={{ flex: 1, minWidth: 120 }}>
              <label htmlFor="esCoh">Batch</label>
              <CohortSelect id="esCoh" className="" value={d.cohort} onChange={(v) => upd({ cohort: v })} />
            </div>
            <div className="mq-f" style={{ flex: '0 0 110px' }}>
              <label htmlFor="esMarks">Marks</label>
              <select id="esMarks" value={marks} onChange={(e) => upd({ marks: Number(e.target.value) })}>
                {MARKS.map((m) => (
                  <option key={m} value={m}>
                    {m} marks
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mq-f">
            <label htmlFor="esQ">Sample question (optional)</label>
            <textarea
              id="esQ"
              maxLength={600}
              placeholder="The question this layout answers, as it would appear on the paper."
              value={d.question ?? ''}
              onChange={(e) => upd({ question: e.target.value })}
            />
          </div>
          <div style={{ margin: '16px 0 4px', fontSize: 12.5, fontWeight: 700 }}>The layout, in order</div>
          <div className="hint" style={{ marginBottom: 10 }}>
            {sum ? (
              <>
                Parts add up to {sum} of {marks} marks {sum === marks && <Icon name="check" strokeWidth={2.6} />}
              </>
            ) : (
              'Give each part its marks to check they add up'
            )}
          </div>
          {d.parts.map((p, i) => (
            <div className="qz-q" key={i}>
              <div className="qh">
                <div className="qn">{i + 1}</div>
                <input
                  type="text"
                  maxLength={80}
                  value={p.h}
                  placeholder="Heading, e.g. Introduction"
                  onChange={(e) => updPart(i, { h: e.target.value })}
                  style={{ ...inStyle, flex: 1, fontWeight: 650, minWidth: 0 }}
                />
                <input
                  type="number"
                  min={0}
                  max={25}
                  value={p.m == null ? '' : p.m}
                  placeholder="marks"
                  aria-label="Marks for this part"
                  onChange={(e) => updPart(i, { m: e.target.value === '' ? null : Math.max(0, Math.min(25, Number(e.target.value) || 0)) })}
                  style={{ ...inStyle, width: 74 }}
                />
              </div>
              <div className="mq-f" style={{ margin: '8px 0 0 34px' }}>
                <textarea maxLength={800} placeholder="What goes in this part, in marking-scheme words." value={p.t} onChange={(e) => updPart(i, { t: e.target.value })} />
              </div>
              <div className="qz-qfoot">
                <span className="sp" style={{ flex: 1 }} />
                {i > 0 && (
                  <button className="btn-ghost" style={{ padding: '5px 9px' }} title="Move up" onClick={() => movePart(i, -1)}>
                    ↑
                  </button>
                )}
                {i < d.parts.length - 1 && (
                  <button className="btn-ghost" style={{ padding: '5px 9px' }} title="Move down" onClick={() => movePart(i, 1)}>
                    ↓
                  </button>
                )}
                <button className="btn-ghost" style={{ padding: '5px 9px' }} onClick={() => upd({ parts: d.parts.filter((_, j) => j !== i) })}>
                  Remove
                </button>
              </div>
            </div>
          ))}
          <button
            className="btn-ghost"
            style={{ width: '100%', justifyContent: 'center', marginBottom: 14 }}
            onClick={() => upd({ parts: [...d.parts, { h: `Point ${d.parts.length}`, t: '', m: null }] })}
          >
            Add a part
          </button>
          <div className="mq-f">
            <label htmlFor="esNotes">Tips (optional, shown under the layout)</label>
            <textarea
              id="esNotes"
              maxLength={800}
              placeholder="Common mistakes, how long to spend, what examiners look for."
              value={d.notes ?? ''}
              onChange={(e) => upd({ notes: e.target.value })}
            />
          </div>
          <Row t="Published" s="a draft never shows in the student app">
            <span className="sp" style={{ flex: 1 }} />
            <Switch on={d.published} onChange={(v) => upd({ published: v })} label="Published" />
          </Row>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
            <button className="btn-primary" disabled={busy} onClick={save}>
              Save template
            </button>
            <button className="btn-ghost" onClick={onClose}>
              Close
            </button>
            <span className="hint">{dirty ? 'Unsaved changes' : ''}</span>
          </div>
        </div>
      </div>
    </>
  );
}
