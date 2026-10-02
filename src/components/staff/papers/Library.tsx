'use client';

/* Library: Leon's PDFs (past papers, marking schemes, tutes, MCQ papers,
   48-hour target papers). Drop the files in, check the details the file
   name already suggested, upload. Phone photos of a paper can be dropped
   too: they become one PDF, a page per picture. Students read published
   ones in the app, through a two-minute ticket; nothing here is ever a
   public link. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { api, fetcher, patch, post, del } from '@/lib/client/api';
import { CFG, DOC_KINDS } from '@/lib/shared/constants';
import { useToast, Ok, Empty, ErrorCard, Loading, Panel, PanelHead, Switch } from '@/components/staff/ui';
import { Icon } from '@/components/staff/Icon';
import { useDialog } from '@/components/staff/Dialog';
import { cohortLabel, CohortSelect, fmtBytes, human, openDoc, toLocal, fromLocal, Row } from './common';

export type Doc = {
  id: number;
  title: string;
  kind: string;
  year: number | null;
  part: string | null;
  lang: string;
  source: string;
  unit: string | null;
  cohort: number | null;
  audience: 'public' | 'students' | 'staff';
  published: boolean;
  availableFrom: string | null;
  availableUntil: string | null;
  pairId: number | null;
  originalName: string | null;
  bytes: number;
  pages: number | null;
  hasText: boolean;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  opens30: number;
  usedBy: number;
};

type Read = { id: number; title: string; kind: string; student_opens: number; students: number; last_open: string | null };

type Meta = {
  title: string;
  kind: string;
  year: string;
  part: string;
  lang: string;
  source: string;
  unit: string;
  cohort: number | null;
  audience: 'public' | 'students' | 'staff';
  published: boolean;
  availableFrom: string; // datetime-local
  availableUntil: string;
  pairId: string; // '' = automatic (upload) / none (edit), 'none' = none
  note: string;
};

type Staged = { key: string; file: File; meta: Meta; titleEdited: boolean; status: 'ready' | 'uploading' | 'done' | 'error'; error?: string };

const KIND_KEYS = Object.keys(DOC_KINDS);

/* Part, language and source are typed, not picked: the usual values are
   offered as suggestions (one <datalist> each, rendered once on the page),
   anything else is accepted. */
const SUGGEST = {
  part: [
    ['I', 'Part I'],
    ['II', 'Part II'],
  ],
  lang: [
    ['en', 'English'],
    ['si', 'Sinhala'],
    ['ta', 'Tamil'],
  ],
  source: [
    ['orig', 'Original state paper scan'],
    ['leon', 'Leon’s typed copy'],
  ],
} as const;
const DL = { part: 'lib-dl-part', lang: 'lib-dl-lang', source: 'lib-dl-source', year: 'lib-dl-year' };

function Suggestions() {
  const thisYear = new Date().getFullYear();
  return (
    <>
      {(['part', 'lang', 'source'] as const).map((k) => (
        <datalist key={k} id={DL[k]}>
          {SUGGEST[k].map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </datalist>
      ))}
      <datalist id={DL.year}>
        {Array.from({ length: 16 }, (_, i) => thisYear - i).map((y) => (
          <option key={y} value={y} />
        ))}
      </datalist>
    </>
  );
}

const low = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
const langName = (l: string) => ({ en: 'English', si: 'Sinhala', ta: 'Tamil' })[low(l)] ?? l;
const sourceName = (s: string) => ({ orig: 'original scan', leon: 'typed by Leon' })[low(s)] ?? s;

/** The original naming rule: "2022 Part I — question paper (Sinhala)". */
export function suggestTitle(m: Pick<Meta, 'kind' | 'year' | 'part' | 'lang'>, fallback: string) {
  if (!m.year) return fallback;
  const part = m.part.trim() ? ` Part ${m.part.trim()}` : '';
  const what = m.kind === 'paper' ? 'question paper' : m.kind === 'scheme' ? 'marking scheme' : (DOC_KINDS[m.kind] ?? 'document').toLowerCase();
  const lang = low(m.lang) === 'si' ? ' (Sinhala)' : low(m.lang) === 'ta' ? ' (Tamil)' : '';
  return `${m.year}${part} — ${what}${lang}`;
}

const blankMeta = (): Meta => ({
  title: '',
  kind: 'paper',
  year: '',
  part: '',
  lang: 'en',
  source: 'orig',
  unit: '',
  cohort: null,
  audience: 'students',
  published: false,
  availableFrom: '',
  availableUntil: '',
  pairId: '',
  note: '',
});

/* Read what we can from the file name. The library's own convention is
   {year}-p{1|2}-{paper|scheme}-{en|si|ta}-{orig|leon}.pdf; looser names
   still give up a year, a part or "scheme". */
function guessFromName(name: string): Meta {
  const n = name.toLowerCase();
  const stem = name.replace(/\.pdf$/i, '');
  const year = n.match(/\b(19[89]\d|20\d\d)\b/)?.[1] ?? '';
  const part = n.match(/(?:^|[^a-z])p(?:art)?[\s_-]*(1|2|ii|i)(?![a-z0-9])/)?.[1];
  const kind = /scheme|marking|\bms\b/.test(n)
    ? 'scheme'
    : /\bmcq\b/.test(n)
      ? 'mcq'
      : /tute/.test(n)
        ? 'tute'
        : /target/.test(n)
          ? 'target'
          : /guide/.test(n)
            ? 'guide'
            : year
              ? 'paper'
              : 'other';
  const m: Meta = {
    ...blankMeta(),
    kind,
    year,
    part: part === '1' || part === 'i' ? 'I' : part === '2' || part === 'ii' ? 'II' : '',
    lang: /(?:^|[^a-z])(si|sinhala)(?![a-z])/.test(n) ? 'si' : /(?:^|[^a-z])(ta|tamil)(?![a-z])/.test(n) ? 'ta' : 'en',
    source: /(?:^|[^a-z])leon(?![a-z])/.test(n) ? 'leon' : 'orig',
  };
  m.title = suggestTitle(m, stem);
  return m;
}

function metaOf(d: Doc): Meta {
  return {
    title: d.title,
    kind: d.kind,
    year: d.year ? String(d.year) : '',
    part: d.part ?? '',
    lang: d.lang,
    source: d.source,
    unit: d.unit ?? '',
    cohort: d.cohort,
    audience: d.audience,
    published: d.published,
    availableFrom: toLocal(d.availableFrom),
    availableUntil: toLocal(d.availableUntil),
    pairId: d.pairId ? String(d.pairId) : 'none',
    note: d.note ?? '',
  };
}

const nowLocal = (plusH = 0) => toLocal(new Date(Date.now() + plusH * 3600_000).toISOString());

export function docLine(d: Pick<Doc, 'kind' | 'year' | 'part' | 'lang' | 'source' | 'pages' | 'bytes'>) {
  const part = d.part ? `Part ${d.part}` : '';
  return [
    DOC_KINDS[d.kind] ?? d.kind,
    [d.year, part].filter(Boolean).join(' ') || null,
    langName(d.lang),
    sourceName(d.source),
    d.pages ? `${d.pages} page${d.pages === 1 ? '' : 's'}` : null,
    fmtBytes(d.bytes),
  ]
    .filter(Boolean)
    .join(' · ');
}

/* ─── the details form, shared by staged uploads and the edit panel ─── */

function MetaForm({ m, set, docs, selfId, upload }: { m: Meta; set: (p: Partial<Meta>) => void; docs: Doc[]; selfId?: number; upload?: boolean }) {
  const partners = docs.filter((d) => d.id !== selfId && (m.kind === 'paper' ? d.kind === 'scheme' : m.kind === 'scheme' ? d.kind === 'paper' : true));
  const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: 10 };
  return (
    <>
      <div className="mq-f">
        <label>Title</label>
        <input type="text" maxLength={160} value={m.title} onChange={(e) => set({ title: e.target.value })} />
      </div>
      <div style={grid}>
        <div className="mq-f">
          <label>Kind</label>
          <select value={m.kind} onChange={(e) => set({ kind: e.target.value })}>
            {KIND_KEYS.map((k) => (
              <option key={k} value={k}>
                {DOC_KINDS[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="mq-f">
          <label>Year</label>
          <input type="text" inputMode="numeric" maxLength={4} placeholder="2022" list={DL.year} value={m.year} onChange={(e) => set({ year: e.target.value.replace(/\D/g, '') })} />
        </div>
        <div className="mq-f">
          <label>Part</label>
          <input type="text" maxLength={20} placeholder="I, II …" list={DL.part} value={m.part} onChange={(e) => set({ part: e.target.value })} />
        </div>
        <div className="mq-f">
          <label>Language</label>
          <input type="text" maxLength={20} placeholder="en, si, ta" list={DL.lang} value={m.lang} onChange={(e) => set({ lang: e.target.value })} />
        </div>
        <div className="mq-f">
          <label>Source</label>
          <input type="text" maxLength={20} placeholder="orig, leon" list={DL.source} value={m.source} onChange={(e) => set({ source: e.target.value })} />
        </div>
        <div className="mq-f">
          <label>Unit</label>
          <input type="text" maxLength={8} placeholder="optional" value={m.unit} onChange={(e) => set({ unit: e.target.value })} />
        </div>
        <div className="mq-f">
          <label>Batch</label>
          <CohortSelect className="" value={m.cohort} onChange={(v) => set({ cohort: v })} />
        </div>
        <div className="mq-f">
          <label>Who can see it</label>
          <select value={m.audience} onChange={(e) => set({ audience: e.target.value as Meta['audience'] })}>
            <option value="students">Students</option>
            <option value="public">Everyone signed in</option>
            <option value="staff">Staff only</option>
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="mq-f" style={{ flex: 1, minWidth: 170 }}>
          <label>Shows from (optional)</label>
          <input type="datetime-local" value={m.availableFrom} onChange={(e) => set({ availableFrom: e.target.value })} />
        </div>
        <div className="mq-f" style={{ flex: 1, minWidth: 170 }}>
          <label>Hidden after (optional)</label>
          <input type="datetime-local" value={m.availableUntil} onChange={(e) => set({ availableUntil: e.target.value })} />
        </div>
        <div className="mq-f" style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="btn-ghost" title="Visible from now for 48 hours" onClick={() => set({ availableFrom: nowLocal(), availableUntil: nowLocal(48), kind: m.kind === 'other' ? 'target' : m.kind })}>
            48-hour target paper
          </button>
          {(m.availableFrom || m.availableUntil) && (
            <button type="button" className="btn-ghost" onClick={() => set({ availableFrom: '', availableUntil: '' })}>
              No window
            </button>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <div className="mq-f" style={{ flex: 2, minWidth: 200 }}>
          <label>{m.kind === 'paper' ? 'Its marking scheme' : m.kind === 'scheme' ? 'The paper it marks' : 'Paired with'}</label>
          <select value={m.pairId} onChange={(e) => set({ pairId: e.target.value })}>
            {upload && <option value="">Pair automatically (same year, part, language)</option>}
            <option value="none">Not paired</option>
            {partners.map((d) => (
              <option key={d.id} value={String(d.id)}>
                {d.title}
              </option>
            ))}
          </select>
        </div>
        <div className="mq-f" style={{ flex: 3, minWidth: 200 }}>
          <label>Note (shown to students, optional)</label>
          <input type="text" maxLength={500} value={m.note} onChange={(e) => set({ note: e.target.value })} />
        </div>
      </div>
      <Row t="Published" s="a draft never shows in the student app">
        <span className="sp" style={{ flex: 1 }} />
        <Switch on={m.published} onChange={(v) => set({ published: v })} label="Published" />
      </Row>
    </>
  );
}

/** What the form cannot send as is; null when it is fine. */
function metaProblem(m: Meta, what = 'Every PDF') {
  if (!m.title.trim()) return `${what} needs a title`;
  if (m.year && (Number(m.year) < 1990 || Number(m.year) > 2100)) return 'Year must be between 1990 and 2100';
  if (!m.lang.trim()) return 'Type a language (en, si, ta …)';
  if (!m.source.trim()) return 'Type a source (orig, leon …)';
  return null;
}

function metaToForm(m: Meta, fd: FormData) {
  fd.append('title', m.title.trim());
  fd.append('kind', m.kind);
  fd.append('year', m.year);
  fd.append('part', m.part.trim());
  fd.append('lang', m.lang.trim());
  fd.append('source', m.source.trim());
  fd.append('unit', m.unit.trim());
  fd.append('cohort', m.cohort == null ? '' : String(m.cohort));
  fd.append('audience', m.audience);
  fd.append('published', String(m.published));
  fd.append('availableFrom', m.availableFrom ? fromLocal(m.availableFrom)! : '');
  fd.append('availableUntil', m.availableUntil ? fromLocal(m.availableUntil)! : '');
  if (m.pairId) fd.append('pairId', m.pairId === 'none' ? '' : m.pairId);
  fd.append('note', m.note.trim());
}

function metaToJson(m: Meta) {
  return {
    title: m.title.trim(),
    kind: m.kind,
    year: m.year.trim() || null,
    part: m.part.trim() || null,
    lang: m.lang.trim(),
    source: m.source.trim(),
    unit: m.unit.trim() || null,
    cohort: m.cohort,
    audience: m.audience,
    published: m.published,
    availableFrom: fromLocal(m.availableFrom),
    availableUntil: fromLocal(m.availableUntil),
    pairId: m.pairId && m.pairId !== 'none' ? Number(m.pairId) : null,
    note: m.note.trim() || null,
  };
}

/* ─── pictures → JPEG pages ───

   Every picture is redrawn on a canvas as a JPEG, long edge at most 2200 px:
   that reads WebP and PNG alike, and turns a 12 MB phone photo into a page
   the server (3 MB a picture) and a student's phone can both take. */

const MAX_PICS = 60;
const PIC_BYTES = 3 * 1024 * 1024;
const isPic = (f: File) => /^image\/(jpeg|png|webp)$/.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name);

function toJpeg(file: File, longEdge = 2200): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, longEdge / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k));
      c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const g = c.getContext('2d');
      if (!g) return reject(new Error(`Could not read ${file.name}`));
      g.fillStyle = '#fff'; // transparent PNG areas become paper white, not black
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      // step the quality down until the page fits under the server's cap
      for (const q of [0.85, 0.72, 0.6, 0.48]) {
        const b = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', q));
        if (!b) break;
        if (b.size <= PIC_BYTES) return resolve(b);
      }
      reject(new Error(`${file.name} is too detailed to fit in 3 MB`));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read ${file.name}`));
    };
    img.src = url;
  });
}

async function picsForm(files: File[], onStep: (i: number) => void) {
  const fd = new FormData();
  for (const [i, f] of files.entries()) {
    onStep(i + 1);
    fd.append('file', new File([await toJpeg(f)], `page-${i + 1}.jpg`, { type: 'image/jpeg' }));
  }
  return fd;
}

/* ─── the upload card: PDFs, or pictures made into one PDF ─── */

function Uploader({ docs, onDone }: { docs: Doc[]; onDone: () => void }) {
  const [mode, setMode] = useState<'pdf' | 'images'>('pdf');
  return (
    <div className="card" style={{ marginBottom: 'var(--sp-5)' }}>
      <div className="card-h">
        <h3>Add PDFs</h3>
        <span className="hint">
          {mode === 'pdf' ? 'Past papers, marking schemes, tutes, MCQ papers. Up to 40 MB each.' : `Photos of a paper, up to ${MAX_PICS}, one page each.`}
        </span>
      </div>
      <div className="card-b">
        <div className="tabbar lib-mode" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'pdf'} className={`tab${mode === 'pdf' ? ' active' : ''}`} onClick={() => setMode('pdf')}>
            PDF files
          </button>
          <button type="button" role="tab" aria-selected={mode === 'images'} className={`tab${mode === 'images' ? ' active' : ''}`} onClick={() => setMode('images')}>
            Images → one PDF
          </button>
        </div>
        {/* both stay mounted so switching tabs never loses what was staged */}
        <div hidden={mode !== 'pdf'}>
          <PdfUploader docs={docs} onDone={onDone} />
        </div>
        <div hidden={mode !== 'images'}>
          <ImagesUploader docs={docs} onDone={onDone} />
        </div>
      </div>
    </div>
  );
}

function DropZone({ label, accept, onFiles }: { label: string; accept: string; onFiles: (f: FileList) => void }) {
  const [drag, setDrag] = useState(false);
  return (
    <label
      className="mq-up"
      style={{ display: 'flex', justifyContent: 'center', padding: '26px 16px', width: '100%', textAlign: 'center', ...(drag ? { borderColor: 'var(--brand)', color: 'var(--brand)' } : {}) }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
      }}
    >
      <Icon name="upload" /> {label}
      <input
        type="file"
        accept={accept}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) onFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </label>
  );
}

function PdfUploader({ docs, onDone }: { docs: Doc[]; onDone: () => void }) {
  const { toast, toastError } = useToast();
  const [staged, setStaged] = useState<Staged[]>([]);
  const [busy, setBusy] = useState(false);

  const add = (files: FileList | File[]) => {
    const list = Array.from(files);
    const pdfs = list.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (pdfs.length < list.length) toast('Only PDFs here. For photos of a paper, use “Images → one PDF”.', 4200);
    setStaged((s) => [
      ...s,
      ...pdfs.map((file) => ({ key: `${file.name}-${file.size}-${Math.random()}`, file, meta: guessFromName(file.name), titleEdited: false, status: 'ready' as const })),
    ]);
  };

  const setMeta = (key: string, p: Partial<Meta>) =>
    setStaged((s) =>
      s.map((x) => {
        if (x.key !== key) return x;
        const titleEdited = x.titleEdited || p.title !== undefined;
        const meta = { ...x.meta, ...p };
        // keep the suggested title in step until the user types their own
        if (!titleEdited) meta.title = suggestTitle(meta, x.file.name.replace(/\.pdf$/i, ''));
        return { ...x, meta, titleEdited, status: x.status === 'error' ? 'ready' : x.status };
      }),
    );

  const uploadAll = async () => {
    const todo = staged.filter((s) => s.status === 'ready' || s.status === 'error');
    if (!todo.length) return;
    const bad = todo.map((s) => metaProblem(s.meta)).find(Boolean);
    if (bad) return toast(bad);
    setBusy(true);
    let ok = 0;
    for (const s of todo) {
      setStaged((all) => all.map((x) => (x.key === s.key ? { ...x, status: 'uploading', error: undefined } : x)));
      try {
        const fd = new FormData();
        fd.append('file', s.file);
        metaToForm(s.meta, fd);
        await api('/api/staff/library', { method: 'POST', body: fd });
        ok++;
        setStaged((all) => all.map((x) => (x.key === s.key ? { ...x, status: 'done' } : x)));
      } catch (e) {
        setStaged((all) => all.map((x) => (x.key === s.key ? { ...x, status: 'error', error: (e as Error).message } : x)));
      }
    }
    setBusy(false);
    onDone();
    if (ok) {
      toast(<Ok>{ok === 1 ? 'PDF uploaded' : `${ok} PDFs uploaded`}</Ok>);
      // uploaded rows leave the list after a moment; failures stay to be fixed
      setTimeout(() => setStaged((all) => all.filter((x) => x.status !== 'done')), 1500);
    } else if (todo.length) toastError(new Error('Nothing was uploaded. See the message under each file.'));
  };

  const waiting = staged.filter((s) => s.status === 'ready' || s.status === 'error').length;

  return (
    <>
      <DropZone label="Drop PDFs here, or choose files" accept="application/pdf,.pdf" onFiles={add} />
      <div className="hint" style={{ marginTop: 6 }}>
        Named like <b>2022-p1-paper-si-orig.pdf</b>? The year, part, kind and language fill themselves in.
      </div>

      {staged.map((s) => (
        <div key={s.key} className="qz-q" style={{ marginTop: 14 }}>
          <div className="qh" style={{ marginBottom: 10 }}>
            <div className="qn">
              <Icon name="file" />
            </div>
            <div className="qt">
              {s.file.name}
              <div className="qz-meta" style={{ fontWeight: 400 }}>
                {fmtBytes(s.file.size)}
                {s.status === 'uploading' && ' · Uploading…'}
                {s.status === 'done' && ' · Uploaded'}
              </div>
            </div>
            {s.status !== 'uploading' && s.status !== 'done' && (
              <button className="btn-ghost" style={{ padding: '5px 9px' }} onClick={() => setStaged((all) => all.filter((x) => x.key !== s.key))}>
                Remove
              </button>
            )}
          </div>
          {s.error && (
            <div className="hint" style={{ color: 'var(--danger)', marginBottom: 8 }}>
              {s.error}
            </div>
          )}
          {s.status !== 'done' && <MetaForm m={s.meta} set={(p) => setMeta(s.key, p)} docs={docs} upload />}
        </div>
      ))}

      {(waiting > 0 || busy) && (
        <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn-primary" disabled={busy || !waiting} onClick={uploadAll}>
            <Icon name="upload" /> {busy ? 'Uploading…' : waiting === 1 ? 'Upload 1 PDF' : `Upload ${waiting} PDFs`}
          </button>
          {!busy && (
            <button className="btn-ghost" onClick={() => setStaged([])}>
              Clear
            </button>
          )}
        </div>
      )}
    </>
  );
}

type Pic = { key: string; file: File; url: string };

/** Picked pictures with thumbnails, in page order; reorder by drag or the arrows. */
function usePics() {
  const { toast } = useToast();
  const [pics, setPics] = useState<Pic[]>([]);
  const live = useRef<Pic[]>([]);
  useEffect(() => {
    live.current = pics;
  }, [pics]);
  // thumbnails are object URLs; hand them back when the page goes
  useEffect(() => () => live.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const add = (files: FileList | File[]) => {
    const list = Array.from(files);
    const ok = list.filter(isPic);
    if (ok.length < list.length) toast('Only JPEG, PNG or WebP pictures. The other files were left out.', 4200);
    const room = MAX_PICS - live.current.length;
    if (ok.length > room) toast(`At most ${MAX_PICS} pictures make one PDF.`, 4200);
    const next = ok.slice(0, Math.max(0, room)).map((file) => ({ key: `${file.name}-${file.size}-${Math.random()}`, file, url: URL.createObjectURL(file) }));
    setPics((p) => [...p, ...next]);
  };
  const remove = (key: string) =>
    setPics((p) => {
      const gone = p.find((x) => x.key === key);
      if (gone) URL.revokeObjectURL(gone.url);
      return p.filter((x) => x.key !== key);
    });
  const move = (from: number, to: number) =>
    setPics((p) => {
      if (to < 0 || to >= p.length || from === to) return p;
      const n = [...p];
      const [x] = n.splice(from, 1);
      n.splice(to, 0, x);
      return n;
    });
  const clear = () =>
    setPics((p) => {
      p.forEach((x) => URL.revokeObjectURL(x.url));
      return [];
    });
  return { pics, add, remove, move, clear };
}

function PicStrip({ pics, move, remove, disabled }: { pics: Pic[]; move: (a: number, b: number) => void; remove: (k: string) => void; disabled?: boolean }) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  if (!pics.length) return null;
  return (
    <div className="lib-pics">
      {pics.map((p, i) => (
        <div
          key={p.key}
          className={`lib-pic${over === i && dragFrom !== null && dragFrom !== i ? ' over' : ''}${dragFrom === i ? ' dragging' : ''}`}
          draggable={!disabled}
          onDragStart={(e) => {
            setDragFrom(i);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(i));
          }}
          onDragOver={(e) => {
            if (dragFrom === null) return;
            e.preventDefault();
            setOver(i);
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragFrom !== null) move(dragFrom, i);
            setDragFrom(null);
            setOver(null);
          }}
          onDragEnd={() => {
            setDragFrom(null);
            setOver(null);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, nothing for next/image to optimise */}
          <img src={p.url} alt={`Page ${i + 1}`} />
          <span className="n">{i + 1}</span>
          <div className="ctl">
            <button type="button" disabled={disabled || i === 0} onClick={() => move(i, i - 1)} aria-label={`Move page ${i + 1} earlier`} title="Earlier">
              ‹
            </button>
            <button type="button" disabled={disabled || i === pics.length - 1} onClick={() => move(i, i + 1)} aria-label={`Move page ${i + 1} later`} title="Later">
              ›
            </button>
            <button type="button" disabled={disabled} onClick={() => remove(p.key)} aria-label={`Remove page ${i + 1}`} title="Remove">
              <Icon name="x" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ImagesUploader({ docs, onDone }: { docs: Doc[]; onDone: () => void }) {
  const { toast, toastError } = useToast();
  const { pics, add, remove, move, clear } = usePics();
  const [meta, setMetaState] = useState<Meta>(blankMeta);
  const [titleEdited, setTitleEdited] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const fallback = `${pics.length} image${pics.length === 1 ? '' : 's'}`;
  // until the user types a title, it follows the details (or the picture count)
  const shown: Meta = titleEdited ? meta : { ...meta, title: suggestTitle(meta, pics.length ? fallback : '') };

  const set = (p: Partial<Meta>) => {
    if (p.title !== undefined) setTitleEdited(true);
    setMetaState((m) => ({ ...m, ...p }));
  };

  const upload = async () => {
    if (!pics.length) return;
    const bad = metaProblem(shown, 'The PDF');
    if (bad) return toast(bad);
    try {
      const fd = await picsForm(
        pics.map((p) => p.file),
        (i) => setStep(`Preparing ${i} of ${pics.length}…`),
      );
      metaToForm(shown, fd);
      setStep('Uploading…');
      const row = await api<{ title: string; pages: number | null }>('/api/staff/library/images', { method: 'POST', body: fd });
      toast(<Ok>{`“${row.title}” made from ${pics.length} picture${pics.length === 1 ? '' : 's'}`}</Ok>);
      clear();
      setMetaState(blankMeta());
      setTitleEdited(false);
      onDone();
    } catch (e) {
      toastError(e);
    } finally {
      setStep(null);
    }
  };

  return (
    <>
      <DropZone label="Drop pictures here, or choose them" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onFiles={add} />
      <div className="hint" style={{ marginTop: 6 }}>
        Each picture becomes one A4 page, in the order shown. Drag a picture, or use the arrows, to change the order.
      </div>
      <PicStrip pics={pics} move={move} remove={remove} disabled={!!step} />
      {pics.length > 0 && (
        <div className="qz-q" style={{ marginTop: 14 }}>
          <MetaForm m={shown} set={set} docs={docs} upload />
          <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn-primary" disabled={!!step} onClick={upload}>
              <Icon name="upload" /> {step ?? `Make one PDF of ${pics.length} page${pics.length === 1 ? '' : 's'}`}
            </button>
            {!step && (
              <button className="btn-ghost" onClick={clear}>
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* ─── edit panel ─── */

function EditPanel({ doc, docs, onClose, onSaved }: { doc: Doc; docs: Doc[]; onClose: () => void; onSaved: () => void }) {
  const { toast, toastError } = useToast();
  const ask = useDialog();
  const [m, setM] = useState<Meta>(() => metaOf(doc));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const pair = docs.find((d) => d.id === doc.pairId);

  const close = async () => {
    if (dirty && !(await ask.confirm({ title: 'Close without saving your changes?', okLabel: 'Discard', danger: true }))) return;
    onClose();
  };
  const save = async () => {
    const bad = metaProblem(m, 'A document');
    if (bad) return toast(bad);
    setBusy(true);
    try {
      await patch(`/api/staff/library/${doc.id}`, metaToJson(m));
      setDirty(false);
      onSaved();
      toast(<Ok>Saved</Ok>);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const replace = async (f: File | undefined) => {
    if (!f) return;
    if (!(await ask.confirm({ title: `Replace the PDF of "${doc.title}"?`, body: `${f.name} takes its place. Students get the new file from now on.`, okLabel: 'Replace' }))) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      await api(`/api/staff/library/${doc.id}`, { method: 'PUT', body: fd });
      onSaved();
      toast(<Ok>File replaced</Ok>);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  /* Photos of missing pages go on the end of the existing PDF. */
  const addPages = async (list: FileList | null) => {
    const files = Array.from(list ?? []).filter(isPic);
    if (!files.length) return;
    if (files.length > MAX_PICS) return toast(`At most ${MAX_PICS} pictures at a time.`);
    const n = files.length;
    if (
      !(await ask.confirm({
        title: `Add ${n} page${n === 1 ? '' : 's'} to "${doc.title}"?`,
        body: `${n === 1 ? 'The picture goes' : 'The pictures go'} at the end of the PDF, one page each, in the order chosen. Students get the longer file from now on.`,
        okLabel: 'Add pages',
      }))
    )
      return;
    setBusy(true);
    try {
      const fd = await picsForm(files, (i) => setStep(`Preparing ${i} of ${n}…`));
      setStep('Adding pages…');
      const out = await api<{ pages: number }>(`/api/staff/library/${doc.id}/images`, { method: 'POST', body: fd });
      onSaved();
      toast(<Ok>{`${n} page${n === 1 ? '' : 's'} added · ${out.pages} in all`}</Ok>);
    } catch (e) {
      toastError(e);
    } finally {
      setStep(null);
      setBusy(false);
    }
  };

  return (
    <>
      <PanelHead
        title={doc.title}
        sub={docLine(doc)}
        badges={
          <>
            <span className={`qz-tag${doc.published ? ' on' : ''}`}>{doc.published ? 'Published' : 'Draft'}</span>
            {doc.hasText && <span className="qz-tag">Searchable text</span>}
          </>
        }
        onClose={close}
      />
      <div className="pn-body">
        <div className="sec">
          <MetaForm
            m={m}
            set={(p) => {
              setM((x) => ({ ...x, ...p }));
              setDirty(true);
            }}
            docs={docs}
            selfId={doc.id}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
            <button className="btn-primary" disabled={busy} onClick={save}>
              Save changes
            </button>
            <button className="btn-ghost" onClick={() => openDoc(doc.id).catch(toastError)}>
              <Icon name="eye" /> Open
            </button>
            <label className="btn-ghost" style={{ cursor: 'pointer' }} aria-disabled={busy}>
              <Icon name="upload" /> Replace file
              <input
                type="file"
                accept="application/pdf,.pdf"
                hidden
                disabled={busy}
                onChange={(e) => {
                  void replace(e.target.files?.[0]);
                  // cleared, so the same file can be picked again after a cancelled confirm
                  e.target.value = '';
                }}
              />
            </label>
            <label className="btn-ghost" style={{ cursor: 'pointer' }} aria-disabled={busy} title="Photos of extra pages go at the end of this PDF">
              <Icon name="imgph" /> {step ?? 'Add pages from images'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                multiple
                hidden
                disabled={busy}
                onChange={(e) => {
                  void addPages(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
            <span className="hint">{dirty ? 'Unsaved changes' : ''}</span>
          </div>
        </div>
        <div className="sec">
          <div className="tp-stats" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
            <div className="tp-stat">
              <div className="v">{doc.opens30}</div>
              <div className="l">Opens, 30 days</div>
            </div>
            <div className="tp-stat">
              <div className="v">{doc.pages ?? '–'}</div>
              <div className="l">Pages</div>
            </div>
            <div className="tp-stat">
              <div className="v">{doc.usedBy}</div>
              <div className="l">MCQ papers</div>
            </div>
          </div>
          <div className="hint" style={{ marginTop: 10 }}>
            File: {doc.originalName ?? '–'} · {fmtBytes(doc.bytes)} · added {human(doc.createdAt)}
            {pair ? ` · paired with "${pair.title}"` : ''}
            {doc.cohort != null ? ` · ${cohortLabel(doc.cohort)}` : ''}
          </div>
        </div>
      </div>
    </>
  );
}

/* ─── the list's checkboxes ─── */

type BulkAction = 'publish' | 'unpublish' | 'cohort' | 'delete';
type BulkOut = { done: number; skipped: { id: number; title: string; reason: string }[] };

function CheckAll({ shown, picked, setPicked }: { shown: Doc[]; picked: Set<number>; setPicked: (s: Set<number>) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const n = shown.filter((d) => picked.has(d.id)).length;
  const all = shown.length > 0 && n === shown.length;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = n > 0 && !all;
  }, [n, all]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="lib-ck"
      checked={all}
      aria-label={all ? 'Clear the selection' : 'Select every document shown'}
      onChange={() => {
        const next = new Set(picked);
        for (const d of shown) {
          if (all) next.delete(d.id);
          else next.add(d.id);
        }
        setPicked(next);
      }}
    />
  );
}

/* ─── the page ─── */

export function LibraryPage() {
  const { toast, toastError } = useToast();
  const ask = useDialog();
  const [kind, setKind] = useState('');
  const [year, setYear] = useState('');
  const [pub, setPub] = useState('');
  const [q, setQ] = useState('');
  const { data: all, error, mutate } = useSWR<Doc[]>('/api/staff/library', fetcher);
  const { data: reads, mutate: mutateReads } = useSWR<Read[]>('/api/staff/library/reads?days=30', fetcher);
  const [openId, setOpenId] = useState<number | null>(null);
  const [pickedRaw, setPicked] = useState<Set<number>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const refresh = useCallback(() => {
    void mutate();
    void mutateReads();
  }, [mutate, mutateReads]);

  const years = useMemo(() => Array.from(new Set((all ?? []).map((d) => d.year).filter(Boolean) as number[])).sort((a, b) => b - a), [all]);
  const rows = useMemo(
    () =>
      (all ?? []).filter(
        (d) =>
          (!kind || d.kind === kind) &&
          (!year || String(d.year) === year) &&
          (!pub || String(d.published) === pub) &&
          (!q || d.title.toLowerCase().includes(q.toLowerCase())),
      ),
    [all, kind, year, pub, q],
  );
  const byId = useMemo(() => new Map((all ?? []).map((d) => [d.id, d])), [all]);
  const sel = openId ? byId.get(openId) : undefined;
  // a ticked document that has since been deleted simply drops out
  const picked = useMemo(() => new Set([...pickedRaw].filter((id) => byId.has(id))), [pickedRaw, byId]);
  const pickedDocs = [...picked].map((id) => byId.get(id)!);
  const togglePick = (id: number) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  const togglePub = async (d: Doc) => {
    try {
      await patch(`/api/staff/library/${d.id}`, { published: !d.published });
      refresh();
      toast(<Ok>{d.published ? 'Back to draft' : 'Published to the student app'}</Ok>);
    } catch (e) {
      toastError(e);
    }
  };
  const remove = async (d: Doc) => {
    if (!(await ask.confirm({ title: `Delete "${d.title}"?`, body: 'The PDF is removed from storage too. This cannot be undone.', okLabel: 'Delete', danger: true }))) return;
    try {
      await del(`/api/staff/library/${d.id}`);
      if (openId === d.id) setOpenId(null);
      refresh();
      toast(<Ok>Deleted</Ok>);
    } catch (e) {
      toastError(e);
    }
  };

  const runBulk = async (action: BulkAction, cohort?: number | null) => {
    const ids = [...picked];
    if (!ids.length) return;
    const n = ids.length;
    const docs = `${n} document${n === 1 ? '' : 's'}`;
    if (action === 'delete') {
      const inUse = pickedDocs.filter((d) => d.usedBy > 0).length;
      const ok = await ask.confirm({
        title: `Delete ${docs}?`,
        body: (
          <>
            Their PDFs are removed from storage too. This cannot be undone.
            {inUse > 0 && (
              <>
                {' '}
                {inUse === 1 ? 'One of them is' : `${inUse} of them are`} used by an MCQ paper and will be kept.
              </>
            )}
          </>
        ),
        okLabel: `Delete ${n}`,
        danger: true,
      });
      if (!ok) return;
    }
    setBulkBusy(true);
    try {
      const out = await post<BulkOut>('/api/staff/library/bulk', { ids, action, ...(action === 'cohort' ? { cohort: cohort ?? null } : {}) });
      const did = `${out.done} document${out.done === 1 ? '' : 's'}`;
      const msg =
        action === 'publish'
          ? `${did} published`
          : action === 'unpublish'
            ? `${did} back to draft`
            : action === 'cohort'
              ? `${did} set to ${cohortLabel(cohort ?? null).toLowerCase()}`
              : `${did} deleted`;
      if (out.skipped.length) {
        // one toast, so the count and the refusals are read together
        const kept = `Kept ${out.skipped.length}: ${out.skipped.map((s) => `“${s.title}” (${s.reason})`).join('; ')}`;
        toast(out.done ? `${msg}. ${kept}` : kept, 7000);
        setPicked(new Set(out.skipped.map((s) => s.id)));
      } else {
        if (out.done) toast(<Ok>{msg}</Ok>);
        if (action === 'delete') setPicked(new Set());
      }
      if (action === 'delete' && openId && ids.includes(openId) && !out.skipped.some((s) => s.id === openId)) setOpenId(null);
      refresh();
    } catch (e) {
      toastError(e);
    } finally {
      setBulkBusy(false);
    }
  };

  if (error) return <ErrorCard error={error} retry={() => mutate()} />;

  const live = (all ?? []).filter((d) => d.published).length;
  const opens = (reads ?? []).reduce((t, r) => t + r.student_opens, 0);
  const top = (reads ?? []).filter((r) => r.student_opens > 0).slice(0, 8);
  const hiddenPicked = pickedDocs.filter((d) => !rows.includes(d)).length;

  return (
    <div className="page active">
      <Suggestions />
      <div className="kpi-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 'var(--sp-5)' }}>
        <div className="kpi">
          <div className="lbl">In the library</div>
          <div className="val">{all?.length ?? '–'}</div>
        </div>
        <div className="kpi">
          <div className="lbl">Published</div>
          <div className="val">{all ? live : '–'}</div>
        </div>
        <div className="kpi">
          <div className="lbl">Student opens, 30 days</div>
          <div className="val">{reads ? opens : '–'}</div>
        </div>
      </div>

      <Uploader docs={all ?? []} onDone={refresh} />

      <div className="card" style={{ marginBottom: 'var(--sp-5)' }}>
        <div className="card-h">
          <h3>Library</h3>
          <span className="hint">{rows.length === (all?.length ?? 0) ? `${rows.length} documents` : `${rows.length} of ${all?.length ?? 0} documents`}</span>
        </div>
        <div className="card-b">
          <div className="toolbar" style={{ marginBottom: 12 }}>
            <div className="chips">
              <button className={`chip${!kind ? ' on' : ''}`} onClick={() => setKind('')}>
                All
              </button>
              {Object.entries(DOC_KINDS).map(([k, l]) => (
                <button key={k} className={`chip${kind === k ? ' on' : ''}`} onClick={() => setKind(kind === k ? '' : k)}>
                  {l}
                </button>
              ))}
            </div>
            <span className="sp" />
            <select className="filter" value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year">
              <option value="">Every year</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <select className="filter" value={pub} onChange={(e) => setPub(e.target.value)} aria-label="Status">
              <option value="">Published and drafts</option>
              <option value="true">Published</option>
              <option value="false">Drafts</option>
            </select>
            <input className="filter" type="search" placeholder="Search titles" value={q} onChange={(e) => setQ(e.target.value)} style={{ cursor: 'text' }} />
          </div>

          {picked.size > 0 && (
            <div className="lib-bulk" role="toolbar" aria-label="Selected documents">
              <b>{picked.size} selected</b>
              {hiddenPicked > 0 && <span className="hint">({hiddenPicked} hidden by the filters)</span>}
              <span className="sp" />
              <button className="btn-ghost" disabled={bulkBusy} onClick={() => runBulk('publish')}>
                Publish
              </button>
              <button className="btn-ghost" disabled={bulkBusy} onClick={() => runBulk('unpublish')}>
                Unpublish
              </button>
              <select
                className="filter"
                value=""
                disabled={bulkBusy}
                aria-label="Set batch"
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) void runBulk('cohort', v === 'all' ? null : Number(v));
                }}
              >
                <option value="">Set batch…</option>
                <option value="all">All batches</option>
                {CFG.cohorts.map((c, i) => (
                  <option key={c} value={i}>
                    {c}
                  </option>
                ))}
              </select>
              <button className="btn-danger" disabled={bulkBusy} onClick={() => runBulk('delete')}>
                <Icon name="trash" /> Delete
              </button>
              <button className="btn-ghost" disabled={bulkBusy} onClick={() => setPicked(new Set())}>
                Clear
              </button>
            </div>
          )}

          {!all ? (
            <Loading />
          ) : !rows.length ? (
            <Empty
              icon="book"
              title={all.length ? 'Nothing matches those filters' : 'No PDFs yet'}
              sub={all.length ? 'Clear a filter to see more.' : 'Drop the first past paper in above. It stays a draft until you publish it.'}
            />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl lib-tbl">
                <thead>
                  <tr>
                    <th className="ckc">
                      <CheckAll shown={rows} picked={picked} setPicked={setPicked} />
                    </th>
                    <th>Document</th>
                    <th>Who</th>
                    <th className="tnum">Opens</th>
                    <th>Published</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => {
                    const pair = d.pairId ? byId.get(d.pairId) : undefined;
                    const expired = d.availableUntil && new Date(d.availableUntil) < new Date();
                    const on = picked.has(d.id);
                    return (
                      <tr key={d.id} className={on ? 'picked' : undefined} onClick={() => setOpenId(d.id)}>
                        <td className="ckc" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" className="lib-ck" checked={on} onChange={() => togglePick(d.id)} aria-label={`Select ${d.title}`} />
                        </td>
                        <td>
                          <div className="tn">{d.title}</div>
                          <div className="tm">{docLine(d)}</div>
                          {(d.availableFrom || d.availableUntil) && (
                            <div className="tm" style={expired ? undefined : { color: 'var(--urgent, var(--amber))' }}>
                              {expired ? 'Window over' : d.availableFrom && new Date(d.availableFrom) > new Date() ? `Shows ${human(d.availableFrom)}` : 'Showing'}
                              {d.availableUntil ? ` until ${human(d.availableUntil)}` : ''}
                            </div>
                          )}
                          {pair && <div className="tm">Paired with {pair.title}</div>}
                        </td>
                        <td>
                          <div>{d.audience === 'staff' ? 'Staff only' : d.audience === 'public' ? 'Everyone' : 'Students'}</div>
                          <div className="tm">{cohortLabel(d.cohort)}</div>
                        </td>
                        <td className="tnum" style={{ textAlign: 'right' }}>
                          {d.opens30}
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <Switch on={d.published} onChange={() => togglePub(d)} label={`Published: ${d.title}`} />
                        </td>
                        <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                          <button className="btn-ghost" style={{ padding: '5px 9px' }} onClick={() => openDoc(d.id).catch(toastError)}>
                            Open
                          </button>{' '}
                          <button className="btn-ghost" style={{ padding: '5px 9px' }} onClick={() => setOpenId(d.id)}>
                            Edit
                          </button>{' '}
                          <button className="btn-ghost" style={{ padding: '5px 9px' }} onClick={() => remove(d)}>
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <h3>Most opened</h3>
          <span className="hint">Student opens in the last 30 days</span>
        </div>
        <div className="card-b">
          {!reads ? (
            <Loading />
          ) : !top.length ? (
            <div className="hint">No student has opened a PDF in the last 30 days.</div>
          ) : (
            top.map((r, i) => (
              <div key={r.id} className="mq-qstat">
                <div className="n">{i + 1}</div>
                <div className="b">
                  <div className="t">{r.title}</div>
                  <div className="bar">
                    <i style={{ width: `${Math.round((r.student_opens / top[0].student_opens) * 100)}%` }} />
                  </div>
                </div>
                <div className="p" style={{ width: 'auto', whiteSpace: 'nowrap' }}>
                  {r.student_opens} · {r.students} student{r.students === 1 ? '' : 's'}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <Panel open={!!sel} onClose={() => setOpenId(null)}>
        {sel && <EditPanel key={`${sel.id}-${sel.updatedAt}`} doc={sel} docs={all ?? []} onClose={() => setOpenId(null)} onSaved={refresh} />}
      </Panel>
    </div>
  );
}
