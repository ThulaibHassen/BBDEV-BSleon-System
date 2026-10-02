'use client';

/* MCQ papers and speed drills: one list, one editor, they differ only by
   kind. A paper is either typed questions (text, optional picture, 2–5
   options) or PDF mode: a library PDF plus an answer key, which students
   answer on an in-app bubble sheet. Marking is on the server (server/mcq). */

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { api, fetcher, post, patch, put, del } from '@/lib/client/api';
import { useToast, Ok, Empty, ErrorCard, Loading, Panel, PanelHead, Switch, downloadCsv } from '@/components/staff/ui';
import { Icon } from '@/components/staff/Icon';
import { useDialog } from '@/components/staff/Dialog';
import { cohortLabel, CohortSelect, windowLine, toLocal, fromLocal, mmss, plural, slug, openDoc, Row, PlusIcon } from './common';
import { QuestionList, OptionsEditor, checkOptions, FormCard, TextImageBar, TextImageThumb } from './Questions';
import type { Doc } from './Library';
import { init2 } from '@/lib/shared/constants';

type Kind = 'paper' | 'drill';
type PaperCard = {
  id: number;
  title: string;
  kind: Kind;
  mode: 'questions' | 'pdf';
  documentId: number | null;
  unit: string | null;
  cohort: number | null;
  minutes: number;
  published: boolean;
  shuffle: boolean;
  openFrom: string | null;
  openTo: string | null;
  n: number;
  sat: number;
};
type Paper = Omit<PaperCard, 'n' | 'sat'> & { instructions: string | null };
type McqQ = { id: number; ord: number; q: string; imageMediaId: number | null; opts: string[]; optImages: (number | null)[] | null; answer: number; why: string | null; marks: number };
type Detail = { paper: Paper; questions: McqQ[]; document: { id: number; title: string; pages: number | null } | null; attempts: number };
type Results = {
  attempts: { studentId: number; name: string; correct: number; total: number; marks: number; maxMarks: number; seconds: number | null; finishedAt: string | null; late: boolean }[];
  questions: { id: number; ord: number; q: string; sat: number; gotIt: number }[];
};

const MINUTES = [5, 10, 15, 20, 25, 30, 45, 60, 90, 120];
const word = (kind: Kind, n: number) => (kind === 'drill' ? (n === 1 ? 'drill' : 'drills') : n === 1 ? 'paper' : 'papers');

export function McqTab({ kind }: { kind: Kind }) {
  const { toast, toastError } = useToast();
  const ask = useDialog();
  const key = `/api/staff/mcq?kind=${kind}`;
  const { data: list, error, mutate } = useSWR<PaperCard[]>(key, fetcher);
  const [open, setOpen] = useState<{ id: number; view: 'edit' | 'results' } | null>(null);

  const newPaper = async () => {
    const t = await ask.prompt({
      title: kind === 'drill' ? 'New speed drill' : 'New MCQ paper',
      label: 'Name',
      placeholder: kind === 'drill' ? 'Unit 3 · Drill 1' : 'Unit 3 · Term test',
      okLabel: 'Create',
      maxLength: 80,
    });
    if (t === null) return;
    try {
      const row = await post<{ id: number }>('/api/staff/mcq', { title: t.slice(0, 80), kind });
      await mutate();
      setOpen({ id: row.id, view: 'edit' });
      toast(<Ok>{kind === 'drill' ? 'Drill created' : 'Paper created'}</Ok>);
    } catch (e) {
      toastError(e);
    }
  };
  const rename = async (p: PaperCard) => {
    const t = await ask.prompt({ title: p.kind === 'drill' ? 'Rename drill' : 'Rename paper', label: 'Name', value: p.title, okLabel: 'Rename', maxLength: 80 });
    if (t === null || t === p.title) return;
    try {
      await patch(`/api/staff/mcq/${p.id}`, { title: t.slice(0, 80) });
      await mutate();
      toast(<Ok>Renamed</Ok>);
    } catch (e) {
      toastError(e);
    }
  };
  const remove = async (p: PaperCard) => {
    if (
      !(await ask.confirm({
        title: `Delete "${p.title}"?`,
        body: p.n ? `Its ${plural(p.n, 'question')} and every result go with it. This cannot be undone.` : 'This cannot be undone.',
        okLabel: 'Delete',
        danger: true,
      }))
    )
      return;
    try {
      await del(`/api/staff/mcq/${p.id}`);
      await mutate();
      toast(<Ok>Deleted</Ok>);
    } catch (e) {
      toastError(e);
    }
  };

  if (error) return <ErrorCard error={error} retry={() => mutate()} />;

  return (
    <>
      <div className="team-bar">
        <span className="hint">
          {list?.length ?? 0} {word(kind, list?.length ?? 0)}
        </span>
        <button className="btn-primary" onClick={newPaper}>
          <PlusIcon /> {kind === 'drill' ? 'New speed drill' : 'New MCQ paper'}
        </button>
      </div>
      {!list ? (
        <Loading />
      ) : !list.length ? (
        kind === 'drill' ? (
          <Empty icon="doc" title="No speed drills yet" sub="A short set against a ten-minute clock. Twenty quick questions on one unit, sat from the student app." />
        ) : (
          <Empty icon="doc" title="No MCQ papers yet" sub="Build a paper, set the clock, publish it. Students sit it once, from their own app." />
        )
      ) : (
        <div className="qz-grid">
          {list.map((p) => {
            const w = windowLine(p.openFrom, p.openTo);
            return (
              <div className="qz-card" key={p.id}>
                <div>
                  <h4>{p.title}</h4>
                  <div className="qz-meta" style={{ marginTop: 4 }}>
                    {p.unit ? `Unit ${p.unit} · ` : ''}
                    {cohortLabel(p.cohort)} · {plural(p.n, 'question')} · {p.minutes} min
                  </div>
                  {w && (
                    <div className="qz-meta" style={{ marginTop: 3 }}>
                      {w}
                    </div>
                  )}
                </div>
                <div>
                  <span className={`qz-tag${p.published ? ' on' : ''}`}>{p.published ? 'Published' : 'Draft'}</span>
                  {p.shuffle && <span className="qz-tag"> Shuffled</span>}
                  {p.mode === 'pdf' && <span className="qz-tag"> PDF</span>}
                </div>
                <div className="qz-acts">
                  <button className="btn-ghost" onClick={() => setOpen({ id: p.id, view: 'edit' })}>
                    Questions
                  </button>
                  {p.n > 0 && (
                    <button className="btn-ghost" onClick={() => setOpen({ id: p.id, view: 'results' })}>
                      Results
                    </button>
                  )}
                  <button className="btn-ghost" onClick={() => rename(p)}>
                    Rename
                  </button>
                  <button className="btn-ghost" onClick={() => remove(p)}>
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <Panel open={!!open} onClose={() => setOpen(null)}>
        {open?.view === 'edit' && <PaperEditor id={open.id} onClose={() => setOpen(null)} onChanged={() => mutate()} onResults={() => setOpen({ id: open.id, view: 'results' })} />}
        {open?.view === 'results' && <ResultsView id={open.id} onClose={() => setOpen(null)} onBack={() => setOpen({ id: open.id, view: 'edit' })} />}
      </Panel>
    </>
  );
}

/* ─── the paper editor ─── */

type Draft = { id: number | null; q: string; opts: string[]; optImages: (number | null)[]; answer: number; marks: number; why: string; imageMediaId: number | null };
const blank = (): Draft => ({ id: null, q: '', opts: ['', '', '', '', ''], optImages: [null, null, null, null, null], answer: 0, marks: 1, why: '', imageMediaId: null });

function PaperEditor({ id, onClose, onChanged, onResults }: { id: number; onClose: () => void; onChanged: () => void; onResults: () => void }) {
  const { toast, toastError } = useToast();
  const ask = useDialog();
  const { data, error, mutate } = useSWR<Detail>(`/api/staff/mcq/${id}`, fetcher);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [pdfMode, setPdfMode] = useState<boolean | null>(null);

  if (error) return <ErrorCard error={error} retry={() => mutate()} />;
  if (!data) return <Loading />;
  const p = data.paper;
  const qs = data.questions;
  const marks = qs.reduce((t, x) => t + (x.marks || 1), 0);
  const isPdf = pdfMode ?? p.mode === 'pdf';

  const meta = async (body: Record<string, unknown>) => {
    try {
      await patch(`/api/staff/mcq/${id}`, body);
      await mutate();
      onChanged();
      toast(<Ok>{body.published === true ? 'Published — students can see it now' : body.published === false ? 'Moved to draft' : 'Saved'}</Ok>);
    } catch (e) {
      toastError(e);
    }
  };
  const reload = async () => {
    await mutate();
    onChanged();
  };

  const saveQ = async () => {
    if (!edit) return;
    const msg = checkOptions(edit.q, edit.opts, edit.answer, edit.optImages, edit.imageMediaId);
    if (msg) return toast(msg);
    setBusy(true);
    try {
      const body = { q: edit.q, opts: edit.opts, optImages: edit.optImages, answer: edit.answer, marks: edit.marks, why: edit.why || null, imageMediaId: edit.imageMediaId };
      if (edit.id) await patch(`/api/staff/mcq/${id}/questions/${edit.id}`, body);
      else await post(`/api/staff/mcq/${id}/questions`, body);
      setEdit(null);
      await reload();
      toast(<Ok>{edit.id ? 'Saved' : 'Question added'}</Ok>);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const delQ = async (qid: number) => {
    if (!(await ask.confirm({ title: 'Delete this question?', okLabel: 'Delete', danger: true }))) return;
    try {
      await del(`/api/staff/mcq/${id}/questions/${qid}`);
      await reload();
      toast(<Ok>Question deleted</Ok>);
    } catch (e) {
      toastError(e);
    }
  };
  const move = async (qid: number, dir: -1 | 1) => {
    try {
      await post(`/api/staff/mcq/${id}/move`, { qid, dir });
      await mutate();
      toast(<Ok>Moved</Ok>, 1600);
    } catch (e) {
      toastError(e);
    }
  };
  const importCsv = async (f: File | undefined) => {
    if (!f) return;
    try {
      const r = await post<{ added: number }>(`/api/staff/mcq/${id}/import`, { csv: await f.text() });
      await reload();
      toast(<Ok>{plural(r.added, 'question')} added</Ok>);
    } catch (e) {
      toastError(e);
    }
  };
  const leavePdf = async () => {
    if (p.mode !== 'pdf') return setPdfMode(false);
    if (
      !(await ask.confirm({
        title: 'Go back to typed questions?',
        body: 'The answer key is removed and the paper goes back to draft.',
        okLabel: 'Remove answer key',
        danger: true,
      }))
    )
      return;
    try {
      await del(`/api/staff/mcq/${id}/pdf`);
      setPdfMode(false);
      await reload();
      toast(<Ok>Back to typed questions — moved to draft</Ok>);
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <>
      <PanelHead
        title={p.title}
        sub={`${plural(qs.length, 'question')} · ${plural(marks, 'mark')} · ${p.minutes} minutes`}
        actions={
          qs.length > 0 && (
            <button className="btn-ghost" onClick={onResults}>
              Results
            </button>
          )
        }
        onClose={onClose}
      />
      <div className="pn-body">
        <div className="sec">
          <Row t="Type" s="which tab it lives under, here and in the student app" first>
            <select className="filter" value={p.kind} onChange={(e) => meta({ kind: e.target.value })}>
              <option value="paper">MCQ paper</option>
              <option value="drill">Speed drill</option>
            </select>
          </Row>
          <Row t="Batch" s="who may sit it">
            <CohortSelect value={p.cohort} onChange={(v) => meta({ cohort: v })} />
          </Row>
          <Row t="Unit" s="optional, for your own sorting">
            <input type="text" defaultValue={p.unit ?? ''} maxLength={4} style={{ maxWidth: 90 }} onBlur={(e) => e.target.value !== (p.unit ?? '') && meta({ unit: e.target.value })} />
          </Row>
          <Row t="Time limit" s="the clock runs on the server">
            <select className="filter" value={p.minutes} onChange={(e) => meta({ minutes: Number(e.target.value) })}>
              {(MINUTES.includes(p.minutes) ? MINUTES : [...MINUTES, p.minutes].sort((a, b) => a - b)).map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </select>
          </Row>
          <Row t="Shuffle the questions" s="a different order for each student">
            <span className="sp" style={{ flex: 1 }} />
            <Switch on={p.shuffle} onChange={(v) => meta({ shuffle: v })} label="Shuffle the questions" />
          </Row>
          <Row t="Published" s="a draft never shows in the student app">
            <span className="sp" style={{ flex: 1 }} />
            <Switch on={p.published} onChange={(v) => meta({ published: v })} label="Published" />
          </Row>
          <div className="mq-f" style={{ marginTop: 14 }}>
            <label htmlFor="mqIns">Instructions (shown before they start)</label>
            <textarea
              id="mqIns"
              maxLength={400}
              placeholder="Answer all forty. No going back once you submit."
              defaultValue={p.instructions ?? ''}
              onBlur={(e) => e.target.value !== (p.instructions ?? '') && meta({ instructions: e.target.value })}
            />
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div className="mq-f" style={{ flex: 1, minWidth: 150 }}>
              <label htmlFor="mqFrom">Opens (optional)</label>
              <input type="datetime-local" id="mqFrom" key={`f${p.openFrom}`} defaultValue={toLocal(p.openFrom)} onChange={(e) => meta({ openFrom: fromLocal(e.target.value) })} />
            </div>
            <div className="mq-f" style={{ flex: 1, minWidth: 150 }}>
              <label htmlFor="mqTo">Closes (optional)</label>
              <input type="datetime-local" id="mqTo" key={`t${p.openTo}`} defaultValue={toLocal(p.openTo)} onChange={(e) => meta({ openTo: fromLocal(e.target.value) })} />
            </div>
          </div>

          <Row t="How students answer" s="typed questions, or a PDF with an answer sheet">
            <div className="chips">
              <button className={`chip${!isPdf ? ' on' : ''}`} onClick={() => isPdf && leavePdf()}>
                Typed questions
              </button>
              <button
                className={`chip${isPdf ? ' on' : ''}`}
                onClick={async () => {
                  if (isPdf) return;
                  if (
                    qs.length &&
                    !(await ask.confirm({
                      title: 'Switch to a PDF?',
                      body: `The ${plural(qs.length, 'typed question')} are replaced when you save the answer key.`,
                      okLabel: 'Switch',
                    }))
                  )
                    return;
                  setPdfMode(true);
                }}
              >
                PDF + answer sheet
              </button>
            </div>
          </Row>

          {isPdf ? (
            <PdfKey detail={data} onSaved={reload} />
          ) : (
            <>
              <div style={{ margin: '16px 0 10px', fontSize: 12.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                Questions
                <span className="sp" style={{ flex: 1 }} />
                <label className="btn-ghost" style={{ padding: '5px 10px', cursor: 'pointer', fontWeight: 600 }} title="Columns: question, option1–option5, answer (1–5), marks, why">
                  Import questions from CSV
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    hidden
                    onChange={(e) => {
                      void importCsv(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </label>
                <button
                  className="btn-ghost"
                  style={{ padding: '5px 10px' }}
                  title="Download an empty CSV with the right columns"
                  onClick={() =>
                    downloadCsv('mcq-template.csv', ['question', 'option1', 'option2', 'option3', 'option4', 'option5', 'answer', 'marks', 'why'], [
                      ['Which of these is a variable cost?', 'Rent', 'Raw materials', 'Insurance', '', '', 2, 1, 'It changes with output'],
                    ])
                  }
                >
                  <Icon name="download" />
                </button>
              </div>
              <QuestionList
                rows={qs.map((x) => ({
                  id: x.id,
                  q: x.q,
                  opts: x.opts,
                  answer: x.answer,
                  img: x.imageMediaId ? `/api/media/${x.imageMediaId}` : null,
                  optImgs: x.optImages,
                  tags: [plural(x.marks || 1, 'mark'), ...(x.imageMediaId || x.optImages?.some((m) => m) ? ['Picture'] : [])],
                }))}
                empty="No questions yet. Add the first one below."
                onMove={move}
                onEdit={(qid) => {
                  const x = qs.find((y) => y.id === qid);
                  if (!x) return;
                  const opts = [...x.opts];
                  while (opts.length < 5) opts.push('');
                  const optImages = opts.map((_, i) => x.optImages?.[i] ?? null);
                  setEdit({ id: x.id, q: x.q, opts, optImages, answer: x.answer, marks: x.marks, why: x.why ?? '', imageMediaId: x.imageMediaId });
                }}
                onDelete={delQ}
              />
              {edit ? (
                <FormCard>
                  <div className="mq-f">
                    <label htmlFor="mqText">Question</label>
                    <textarea id="mqText" autoFocus maxLength={600} placeholder="Which of these is a variable cost?" value={edit.q} onChange={(e) => setEdit({ ...edit, q: e.target.value })} />
                    <div className="ti-under">
                      <TextImageBar inputId="mqText" hasText={!!edit.q.trim()} image={edit.imageMediaId} onImage={(m) => setEdit((e) => (e ? { ...e, imageMediaId: m } : e))} purpose="mcq" />
                      <span className="hint">Text, a picture (a chart, a table, a cartoon), or both.</span>
                    </div>
                    <TextImageThumb image={edit.imageMediaId} onRemove={() => setEdit({ ...edit, imageMediaId: null })} />
                  </div>
                  <OptionsEditor
                    opts={edit.opts}
                    images={edit.optImages}
                    answer={edit.answer}
                    maxLen={180}
                    purpose="mcq"
                    onOpts={(opts) => setEdit({ ...edit, opts })}
                    onImages={(optImages) => setEdit((e) => (e ? { ...e, optImages } : e))}
                    onAnswer={(answer) => setEdit({ ...edit, answer })}
                  />
                  <div className="mq-f" style={{ maxWidth: 150 }}>
                    <label htmlFor="mqMarks">Marks</label>
                    <select id="mqMarks" value={edit.marks} onChange={(e) => setEdit({ ...edit, marks: Number(e.target.value) })}>
                      {[1, 2, 3, 4, 5].map((m) => (
                        <option key={m} value={m}>
                          {plural(m, 'mark')}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="mq-f">
                    <label htmlFor="mqWhy">Why (shown in the review, optional)</label>
                    <input type="text" id="mqWhy" maxLength={300} value={edit.why} onChange={(e) => setEdit({ ...edit, why: e.target.value })} />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn-primary" disabled={busy} onClick={saveQ}>
                      {edit.id ? 'Save changes' : 'Add question'}
                    </button>
                    <button className="btn-ghost" onClick={() => setEdit(null)}>
                      Cancel
                    </button>
                  </div>
                </FormCard>
              ) : (
                <button className="btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setEdit(blank())}>
                  Add a question
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

/* ─── PDF mode: pick the PDF, set the answer key on a bubble grid ─── */

function PdfKey({ detail, onSaved }: { detail: Detail; onSaved: () => Promise<void> }) {
  const { toast, toastError } = useToast();
  const p = detail.paper;
  const cur = p.mode === 'pdf' ? detail.questions : [];
  const { data: docs, mutate: mutateDocs } = useSWR<Doc[]>('/api/staff/library', fetcher);
  const [docId, setDocId] = useState<number | null>(p.documentId);
  const [options, setOptions] = useState(cur[0]?.opts.length ?? 5);
  const [marks, setMarks] = useState(cur[0]?.marks ?? 1);
  const [answers, setAnswers] = useState<number[]>(cur.length ? cur.map((q) => q.answer) : Array(50).fill(-1));
  const [busy, setBusy] = useState(false);
  const [quick, setQuick] = useState('');

  const choices = useMemo(() => (docs ?? []).filter((d) => d.kind === 'mcq' || d.kind === 'paper' || d.id === docId), [docs, docId]);
  const chosen = (docs ?? []).find((d) => d.id === docId);

  const setCount = (n: number) => {
    const c = Math.max(1, Math.min(100, n || 1));
    setAnswers((a) => (c <= a.length ? a.slice(0, c) : [...a, ...Array(c - a.length).fill(-1)]));
  };
  const setOpts = (n: number) => {
    setOptions(n);
    setAnswers((a) => a.map((x) => (x >= n ? -1 : x)));
  };
  /* "Quick key": type the answers as digits (1–5), spaces optional. */
  const applyQuick = (v: string) => {
    setQuick(v);
    const digits = v.replace(/[^1-5]/g, '').split('').map((d) => Number(d) - 1);
    if (!digits.length) return;
    setAnswers((a) => {
      const out = digits.length > a.length ? [...a, ...Array(digits.length - a.length).fill(-1)] : [...a];
      digits.forEach((d, i) => (out[i] = d < options ? d : -1));
      return out.slice(0, 100);
    });
  };

  const uploadInline = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('title', p.title);
      fd.append('kind', 'mcq');
      fd.append('audience', 'students');
      // students open it while they sit the paper, so it must be readable to them
      fd.append('published', 'true');
      fd.append('cohort', p.cohort == null ? '' : String(p.cohort));
      const row = await api<{ id: number }>('/api/staff/library', { method: 'POST', body: fd });
      await mutateDocs();
      setDocId(row.id);
      toast(<Ok>PDF added to the library</Ok>);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!docId) return toast('Pick the PDF first');
    const gap = answers.findIndex((a) => a < 0 || a >= options);
    if (gap >= 0) return toast(`Question ${gap + 1} has no answer ticked.`);
    setBusy(true);
    try {
      await put(`/api/staff/mcq/${p.id}/pdf`, { documentId: docId, options, marks, answers });
      await onSaved();
      toast(<Ok>Answer key saved</Ok>);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const unread = chosen && (!chosen.published || chosen.audience === 'staff');
  const done = answers.filter((a) => a >= 0 && a < options).length;

  return (
    <div style={{ marginTop: 14 }}>
      <div className="mq-f">
        <label>The paper (a PDF from the library)</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={docId ?? ''} onChange={(e) => setDocId(e.target.value ? Number(e.target.value) : null)} style={{ flex: 1, minWidth: 200 }}>
            <option value="">Choose a PDF…</option>
            {choices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
                {d.published ? '' : ' (draft)'}
              </option>
            ))}
          </select>
          {docId && (
            <button className="btn-ghost" onClick={() => openDoc(docId).catch(toastError)}>
              Open
            </button>
          )}
          <label className="btn-ghost" style={{ cursor: 'pointer' }}>
            <Icon name="upload" /> {busy ? 'Uploading…' : 'Upload a PDF'}
            <input
              type="file"
              accept="application/pdf,.pdf"
              hidden
              onChange={(e) => {
                void uploadInline(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        {unread && (
          <div className="hint" style={{ marginTop: 6, color: 'var(--danger)' }}>
            Students cannot open this PDF yet: publish it to students in the Library.
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <div className="mq-f" style={{ flex: '0 0 120px' }}>
          <label>Questions</label>
          <input type="text" inputMode="numeric" value={answers.length} onChange={(e) => setCount(Number(e.target.value.replace(/\D/g, '')))} />
        </div>
        <div className="mq-f" style={{ flex: '0 0 150px' }}>
          <label>Options per question</label>
          <select value={options} onChange={(e) => setOpts(Number(e.target.value))}>
            {[2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} options
              </option>
            ))}
          </select>
        </div>
        <div className="mq-f" style={{ flex: '0 0 140px' }}>
          <label>Marks each</label>
          <select value={marks} onChange={(e) => setMarks(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((m) => (
              <option key={m} value={m}>
                {plural(m, 'mark')}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="mq-f">
        <label>Quick key (type the answers in order, e.g. 3 1 4 2 5 …)</label>
        <input type="text" value={quick} onChange={(e) => applyQuick(e.target.value)} placeholder="31425…" />
      </div>
      <div className="hint" style={{ margin: '4px 0 8px' }}>
        {done} of {answers.length} answers set · tap a bubble to change one
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', gap: '4px 18px', marginBottom: 14 }}>
        {answers.map((a, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
            <span style={{ width: 28, textAlign: 'right', fontSize: 12, fontWeight: 700, color: a < 0 ? 'var(--danger)' : 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
            {Array.from({ length: options }, (_, j) => (
              <button
                key={j}
                type="button"
                className={`qz-pick${a === j ? ' on' : ''}`}
                style={{ width: 28, height: 28, borderRadius: 99 }}
                aria-label={`Question ${i + 1}, answer ${j + 1}`}
                aria-pressed={a === j}
                onClick={() => setAnswers((x) => x.map((v, k) => (k === i ? j : v)))}
              >
                {j + 1}
              </button>
            ))}
          </div>
        ))}
      </div>
      <button className="btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy} onClick={save}>
        Save the answer key
      </button>
      {detail.attempts > 0 && (
        <div className="hint" style={{ marginTop: 8 }}>
          {plural(detail.attempts, 'student')} already started. Papers already submitted keep their marks.
        </div>
      )}
    </div>
  );
}

/* ─── results ─── */

function ResultsView({ id, onClose, onBack }: { id: number; onClose: () => void; onBack: () => void }) {
  const { toast, toastError } = useToast();
  const ask = useDialog();
  const { data: detail } = useSWR<Detail>(`/api/staff/mcq/${id}`, fetcher);
  const { data: r, error, mutate } = useSWR<Results>(`/api/staff/mcq/${id}/results`, fetcher);
  if (error) return <ErrorCard error={error} retry={() => mutate()} />;
  if (!r) return <Loading />;
  const title = detail?.paper.title ?? '';
  const done = r.attempts.filter((a) => a.finishedAt);
  const avg = done.length ? Math.round((done.reduce((t, a) => t + (a.maxMarks ? a.marks / a.maxMarks : 0), 0) / done.length) * 100) : 0;
  const avgT = done.length ? Math.round(done.reduce((t, a) => t + (a.seconds || 0), 0) / done.length) : 0;

  const retake = async (a: Results['attempts'][number]) => {
    if (!(await ask.confirm({ title: `Clear ${a.name || 'this student'}’s attempt so they can sit the paper again?`, okLabel: 'Clear attempt', danger: true }))) return;
    try {
      await post(`/api/staff/mcq/${id}/retake`, { studentId: a.studentId, name: a.name });
      await mutate();
      toast(<Ok>They can sit it again</Ok>);
    } catch (e) {
      toastError(e);
    }
  };
  const exportCsv = () =>
    downloadCsv(
      `mcq-${slug(title)}.csv`,
      ['Student', 'Marks', 'Out of', 'Correct', 'Questions', 'Time', 'Over time', 'Submitted'],
      r.attempts.map((a) => [
        a.name || `#${a.studentId}`,
        a.marks,
        a.maxMarks,
        a.correct,
        a.total,
        mmss(a.seconds),
        a.late ? 'yes' : '',
        a.finishedAt ? toLocal(a.finishedAt).replace('T', ' ') : 'not submitted',
      ]),
    );

  return (
    <>
      <PanelHead title={title} sub="Results" onClose={onClose} />
      <div className="pn-body">
        <div className="sec">
          <div className="tp-stats" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
            <div className="tp-stat">
              <div className="v">{done.length}</div>
              <div className="l">Sat</div>
            </div>
            <div className="tp-stat">
              <div className="v">{avg}%</div>
              <div className="l">Average</div>
            </div>
            <div className="tp-stat">
              <div className="v">{mmss(avgT)}</div>
              <div className="l">Avg time</div>
            </div>
          </div>
          {r.attempts.length ? (
            <>
              <div style={{ margin: '16px 0 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700 }}>Students</span>
                <span className="sp" style={{ flex: 1 }} />
                <button className="btn-ghost" style={{ padding: '5px 10px' }} onClick={exportCsv}>
                  Export CSV
                </button>
              </div>
              {r.attempts.map((a) => {
                const pct = a.maxMarks ? Math.round((a.marks / a.maxMarks) * 100) : 0;
                return (
                  <div className="mq-row" key={a.studentId}>
                    <div className="pr-av">{init2(a.name || '?')}</div>
                    <div className="pr-main">
                      <div className="pr-nm">{a.name || `Student ${a.studentId}`}</div>
                      <div className="pr-mt">
                        {a.finishedAt
                          ? `${a.marks}/${a.maxMarks} · ${a.correct}/${a.total} right · ${mmss(a.seconds)}${a.late ? ' · over time' : ''}`
                          : 'started, not submitted'}
                      </div>
                    </div>
                    {a.finishedAt ? <span className={`qz-tag${pct >= 50 ? ' on' : ''}`}>{pct}%</span> : <span className="qz-tag">open</span>}
                    <button className="btn-ghost" style={{ padding: '5px 9px' }} onClick={() => retake(a)}>
                      Retake
                    </button>
                  </div>
                );
              })}
            </>
          ) : (
            <div className="hint" style={{ marginTop: 14 }}>
              Nobody has sat this paper yet.
            </div>
          )}
          {r.questions.length > 0 && (
            <>
              <div style={{ margin: '18px 0 8px', fontSize: 12.5, fontWeight: 700 }}>Question by question</div>
              {r.questions.map((q, i) => {
                const pct = q.sat ? Math.round((q.gotIt / q.sat) * 100) : 0;
                return (
                  <div className="mq-qstat" key={q.id}>
                    <div className="n">{i + 1}</div>
                    <div className="b">
                      <div className="t">{q.q || 'Picture question'}</div>
                      <div className="bar">
                        <i style={{ width: `${pct}%` }} className={pct < 40 ? 'bad' : pct < 70 ? 'mid' : ''} />
                      </div>
                    </div>
                    <div className="p">{pct}%</div>
                  </div>
                );
              })}
            </>
          )}
          <div style={{ marginTop: 16 }}>
            <button className="btn-ghost" onClick={onBack}>
              Back to the questions
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
