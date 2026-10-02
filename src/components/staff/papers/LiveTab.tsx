'use client';

/* Live class quiz: question sets. Make one, add ten questions, mark it
   "Ready to play", then host it on the class screen. Students join from
   their own app with the 6-digit code. */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { fetcher, post, patch, del } from '@/lib/client/api';
import { useToast, Ok, Empty, ErrorCard, Loading, Panel, PanelHead, Switch } from '@/components/staff/ui';
import { useDialog } from '@/components/staff/Dialog';
import { cohortLabel, CohortSelect, plural, Row, PlusIcon } from './common';
import { QuestionList, OptionsEditor, checkOptions, FormCard, TextImageBar, TextImageThumb } from './Questions';

type SetCard = { id: number; title: string; unit: string | null; cohort: number | null; note: string | null; published: boolean; n: number };
type QQ = { id: number; ord: number; q: string; imageMediaId: number | null; opts: string[]; optImages: (number | null)[] | null; answer: number; seconds: number; pointsX: number; why: string | null };
type Detail = { quiz: Omit<SetCard, 'n'>; questions: QQ[] };

const SECONDS = [10, 15, 20, 30, 45, 60];

export function LiveTab() {
  const router = useRouter();
  const { toast, toastError } = useToast();
  const ask = useDialog();
  const { data: list, error, mutate } = useSWR<SetCard[]>('/api/staff/quiz', fetcher);
  const [openId, setOpenId] = useState<number | null>(null);
  const [hosting, setHosting] = useState(false);

  const newSet = async () => {
    const t = await ask.prompt({ title: 'New question set', label: 'Name', placeholder: 'Unit 4 · Management', okLabel: 'Create', maxLength: 80 });
    if (t === null) return;
    try {
      const row = await post<{ id: number }>('/api/staff/quiz', { title: t.slice(0, 80) });
      await mutate();
      setOpenId(row.id);
      toast(<Ok>Question set created</Ok>);
    } catch (e) {
      toastError(e);
    }
  };
  const rename = async (s: SetCard) => {
    const t = await ask.prompt({ title: 'Rename set', label: 'Name', value: s.title, okLabel: 'Rename', maxLength: 80 });
    if (t === null || t === s.title) return;
    try {
      await patch(`/api/staff/quiz/${s.id}`, { title: t.slice(0, 80) });
      await mutate();
      toast(<Ok>Renamed</Ok>);
    } catch (e) {
      toastError(e);
    }
  };
  const remove = async (s: SetCard) => {
    if (!(await ask.confirm({ title: `Delete "${s.title}"?`, body: s.n ? `Its ${plural(s.n, 'question')} go with it. This cannot be undone.` : 'This cannot be undone.', okLabel: 'Delete', danger: true }))) return;
    try {
      await del(`/api/staff/quiz/${s.id}`);
      await mutate();
      toast(<Ok>Deleted</Ok>);
    } catch (e) {
      toastError(e);
    }
  };
  const host = async (s: SetCard) => {
    if (hosting) return;
    setHosting(true);
    try {
      const g = await post<{ gameId: number }>(`/api/staff/quiz/${s.id}/host`);
      router.push(`/staff/quizzes/host/${g.gameId}`);
    } catch (e) {
      setHosting(false);
      toastError(e);
    }
  };

  if (error) return <ErrorCard error={error} retry={() => mutate()} />;

  return (
    <>
      <div className="team-bar">
        <span className="hint">{plural(list?.length ?? 0, 'question set')}</span>
        <button className="btn-primary" onClick={newSet}>
          <PlusIcon /> New question set
        </button>
      </div>
      {!list ? (
        <Loading />
      ) : !list.length ? (
        <Empty icon="doc" title="No question sets yet" sub="Make one, add ten questions, then host it in class. Students join from their own app." />
      ) : (
        <div className="qz-grid">
          {list.map((s) => (
            <div className="qz-card" key={s.id}>
              <div>
                <h4>{s.title}</h4>
                <div className="qz-meta" style={{ marginTop: 4 }}>
                  {s.unit ? `Unit ${s.unit} · ` : ''}
                  {cohortLabel(s.cohort)} · {plural(s.n, 'question')}
                </div>
              </div>
              <div>
                <span className={`qz-tag${s.published ? ' on' : ''}`}>{s.published ? 'Ready' : 'Draft'}</span>
              </div>
              <div className="qz-acts">
                {s.published && s.n > 0 && (
                  <button className="btn-primary" disabled={hosting} onClick={() => host(s)}>
                    Host game
                  </button>
                )}
                <button className="btn-ghost" onClick={() => setOpenId(s.id)}>
                  Questions
                </button>
                <button className="btn-ghost" onClick={() => rename(s)}>
                  Rename
                </button>
                <button className="btn-ghost" onClick={() => remove(s)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Panel open={!!openId} onClose={() => setOpenId(null)}>
        {openId && <SetEditor id={openId} onClose={() => setOpenId(null)} onChanged={() => mutate()} />}
      </Panel>
    </>
  );
}

type Draft = { id: number | null; q: string; imageMediaId: number | null; opts: string[]; optImages: (number | null)[]; answer: number; seconds: number; pointsX: number; why: string };
const blank = (): Draft => ({ id: null, q: '', imageMediaId: null, opts: ['', '', '', ''], optImages: [null, null, null, null], answer: 0, seconds: 20, pointsX: 1, why: '' });

function SetEditor({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { toast, toastError } = useToast();
  const ask = useDialog();
  const { data, error, mutate } = useSWR<Detail>(`/api/staff/quiz/${id}`, fetcher);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorCard error={error} retry={() => mutate()} />;
  if (!data) return <Loading />;
  const { quiz, questions: qs } = data;
  const mins = Math.max(1, Math.round((qs.reduce((t, x) => t + x.seconds, 0) + qs.length * 8) / 60));

  const reload = async () => {
    await mutate();
    onChanged();
  };
  const meta = async (body: Record<string, unknown>) => {
    try {
      await patch(`/api/staff/quiz/${id}`, body);
      await reload();
      toast(<Ok>{body.published === true ? 'Ready to play' : body.published === false ? 'Moved to draft' : 'Saved'}</Ok>);
    } catch (e) {
      toastError(e);
    }
  };
  const saveQ = async () => {
    if (!edit) return;
    const msg = checkOptions(edit.q, edit.opts, edit.answer, edit.optImages, edit.imageMediaId);
    if (msg) return toast(msg);
    setBusy(true);
    try {
      const body = { q: edit.q, imageMediaId: edit.imageMediaId, opts: edit.opts, optImages: edit.optImages, answer: edit.answer, seconds: edit.seconds, pointsX: edit.pointsX, why: edit.why || null };
      if (edit.id) await patch(`/api/staff/quiz/${id}/questions/${edit.id}`, body);
      else await post(`/api/staff/quiz/${id}/questions`, body);
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
      await del(`/api/staff/quiz/${id}/questions/${qid}`);
      await reload();
      toast(<Ok>Question deleted</Ok>);
    } catch (e) {
      toastError(e);
    }
  };
  const move = async (qid: number, dir: -1 | 1) => {
    try {
      await post(`/api/staff/quiz/${id}/move`, { qid, dir });
      await mutate();
      toast(<Ok>Moved</Ok>, 1600);
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <>
      <PanelHead title={quiz.title} sub={`${plural(qs.length, 'question')} · about ${mins} min in class`} onClose={onClose} />
      <div className="pn-body">
        <div className="sec">
          <Row t="Batch" s="who this set is for" first>
            <CohortSelect value={quiz.cohort} onChange={(v) => meta({ cohort: v })} />
          </Row>
          <Row t="Unit" s="optional, for your own sorting">
            <input type="text" defaultValue={quiz.unit ?? ''} maxLength={4} style={{ maxWidth: 90 }} onBlur={(e) => e.target.value !== (quiz.unit ?? '') && meta({ unit: e.target.value })} />
          </Row>
          <Row t="Note" s="for you, never shown to the class">
            <input type="text" defaultValue={quiz.note ?? ''} maxLength={400} onBlur={(e) => e.target.value !== (quiz.note ?? '') && meta({ note: e.target.value })} />
          </Row>
          <Row t="Ready to play" s="a draft never appears when hosting">
            <span className="sp" style={{ flex: 1 }} />
            <Switch on={quiz.published} onChange={(v) => meta({ published: v })} label="Ready to play" />
          </Row>
          <div style={{ margin: '16px 0 10px', fontSize: 12.5, fontWeight: 700 }}>Questions</div>
          <QuestionList
            rows={qs.map((x) => ({
              id: x.id,
              q: x.q,
              opts: x.opts,
              answer: x.answer,
              img: x.imageMediaId ? `/api/media/${x.imageMediaId}` : null,
              optImgs: x.optImages,
              tags: [`${x.seconds}s`, ...(x.pointsX > 1 ? ['Double points'] : []), ...(x.imageMediaId || x.optImages?.some((m) => m) ? ['Picture'] : [])],
            }))}
            empty="No questions yet. Ten is a good game."
            onMove={move}
            onEdit={(qid) => {
              const x = qs.find((y) => y.id === qid);
              if (!x) return;
              const opts = [...x.opts];
              while (opts.length < 4) opts.push('');
              const optImages = opts.map((_, i) => x.optImages?.[i] ?? null);
              setEdit({ id: x.id, q: x.q, imageMediaId: x.imageMediaId, opts, optImages, answer: x.answer, seconds: x.seconds, pointsX: x.pointsX, why: x.why ?? '' });
            }}
            onDelete={delQ}
          />
          {edit ? (
            <FormCard>
              <div className="qz-f">
                <label htmlFor="qzText">Question</label>
                <textarea id="qzText" autoFocus maxLength={300} placeholder="Delegation means a manager passes down..." value={edit.q} onChange={(e) => setEdit({ ...edit, q: e.target.value })} />
                <div className="ti-under">
                  <TextImageBar inputId="qzText" hasText={!!edit.q.trim()} image={edit.imageMediaId} onImage={(m) => setEdit((e) => (e ? { ...e, imageMediaId: m } : e))} purpose="quiz" />
                  <span className="hint">Text, a picture, or both.</span>
                </div>
                <TextImageThumb image={edit.imageMediaId} onRemove={() => setEdit({ ...edit, imageMediaId: null })} />
              </div>
              <OptionsEditor
                opts={edit.opts}
                images={edit.optImages}
                answer={edit.answer}
                maxLen={120}
                purpose="quiz"
                onOpts={(opts) => setEdit({ ...edit, opts })}
                onImages={(optImages) => setEdit((e) => (e ? { ...e, optImages } : e))}
                onAnswer={(answer) => setEdit({ ...edit, answer })}
              />
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div className="qz-f" style={{ flex: '0 0 140px' }}>
                  <label htmlFor="qzSec">Seconds</label>
                  <select id="qzSec" value={edit.seconds} onChange={(e) => setEdit({ ...edit, seconds: Number(e.target.value) })}>
                    {SECONDS.map((s) => (
                      <option key={s} value={s}>
                        {s} seconds
                      </option>
                    ))}
                  </select>
                </div>
                <div className="qz-f" style={{ flex: '0 0 140px' }}>
                  <label htmlFor="qzPts">Points</label>
                  <select id="qzPts" value={edit.pointsX} onChange={(e) => setEdit({ ...edit, pointsX: Number(e.target.value) })}>
                    <option value={1}>Normal</option>
                    <option value={2}>Double</option>
                  </select>
                </div>
              </div>
              <div className="qz-f">
                <label htmlFor="qzWhy">Why (shown after the answer, optional)</label>
                <input type="text" id="qzWhy" maxLength={200} value={edit.why} onChange={(e) => setEdit({ ...edit, why: e.target.value })} />
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
        </div>
      </div>
    </>
  );
}
