'use client';

/* The question list and the options editor shared by MCQ papers (A–E) and
   live-quiz sets (A–D). The draft lives in React state, so ticking the
   answer never wipes what was typed (the original needed grab() for that).
   Every question and option takes text, a picture, or both: the small
   T / picture icons beside each field. */

import { useState, type ReactNode } from 'react';
import { Icon } from '@/components/staff/Icon';
import { useToast } from '@/components/staff/ui';
import { letter, uploadPicture } from './common';

export type QRow = { id: number; q: string; opts: string[]; answer: number; tags: string[]; img?: string | null; optImgs?: (number | null)[] | null };

/** The T / picture icon pair. T jumps to the text box; the picture icon uploads (or replaces) the picture. */
export function TextImageBar({ inputId, hasText, image, onImage, purpose }: { inputId: string; hasText: boolean; image: number | null; onImage: (id: number | null) => void; purpose: 'mcq' | 'quiz' }) {
  const { toastError } = useToast();
  const [busy, setBusy] = useState(false);
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      onImage((await uploadPicture(f, purpose)).id);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ti-bar">
      <button type="button" className={`ti-btn${hasText ? ' on' : ''}`} title="Text" aria-label="Text" onClick={() => document.getElementById(inputId)?.focus()}>
        T
      </button>
      <label className={`ti-btn${image ? ' on' : ''}${busy ? ' busy' : ''}`} title={busy ? 'Uploading…' : image ? 'Replace the picture' : 'Add a picture'} aria-label="Picture">
        <Icon name="imgph" />
        <input
          type="file"
          accept="image/*"
          hidden
          disabled={busy}
          onChange={(e) => {
            void pick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </label>
    </div>
  );
}

/** A picked picture with its remove (×) button. */
export function TextImageThumb({ image, onRemove, small }: { image: number | null; onRemove: () => void; small?: boolean }) {
  if (!image) return null;
  return (
    <div className={`ti-thumb${small ? ' sm' : ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/media/${image}`} alt="" loading="lazy" />
      <button type="button" title="Remove the picture" aria-label="Remove the picture" onClick={onRemove}>
        <Icon name="x" strokeWidth={2.6} />
      </button>
    </div>
  );
}

export function QuestionList({
  rows,
  empty,
  onMove,
  onEdit,
  onDelete,
}: {
  rows: QRow[];
  empty: string;
  onMove: (id: number, dir: -1 | 1) => void;
  onEdit: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  if (!rows.length)
    return (
      <div className="hint" style={{ marginBottom: 12 }}>
        {empty}
      </div>
    );
  return (
    <>
      {rows.map((x, i) => (
        <div className="qz-q" key={x.id}>
          <div className="qh">
            <div className="qn">{i + 1}</div>
            <div className="qt">{x.q}</div>
          </div>
          {x.img && (
            <div style={{ margin: '8px 0 0 34px' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={x.img} alt="" className="mq-thumb" />
            </div>
          )}
          <div className="qz-opts">
            {x.opts.map((o, j) => (
              <div key={j} className={`qz-opt${j === x.answer ? ' ok' : ''}`}>
                {j === x.answer && <Icon name="check" strokeWidth={2.6} />}
                {x.optImgs?.[j] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/media/${x.optImgs[j]}`} alt="" loading="lazy" className="ti-oimg" />
                ) : null}
                {o}
              </div>
            ))}
          </div>
          <div className="qz-qfoot">
            {x.tags.map((t) => (
              <span key={t} className="qz-tag">
                {t}
              </span>
            ))}
            <span className="sp" style={{ flex: 1 }} />
            {i > 0 && (
              <button className="btn-ghost" style={{ padding: '5px 9px' }} title="Move up" onClick={() => onMove(x.id, -1)}>
                ↑
              </button>
            )}
            {i < rows.length - 1 && (
              <button className="btn-ghost" style={{ padding: '5px 9px' }} title="Move down" onClick={() => onMove(x.id, 1)}>
                ↓
              </button>
            )}
            <button className="btn-ghost" style={{ padding: '5px 9px' }} onClick={() => onEdit(x.id)}>
              Edit
            </button>
            <button className="btn-ghost" style={{ padding: '5px 9px' }} onClick={() => onDelete(x.id)}>
              Delete
            </button>
          </div>
        </div>
      ))}
    </>
  );
}

export function OptionsEditor({
  opts,
  images,
  answer,
  maxLen,
  purpose,
  onOpts,
  onImages,
  onAnswer,
}: {
  opts: string[];
  images: (number | null)[];
  answer: number;
  maxLen: number;
  purpose: 'mcq' | 'quiz';
  onOpts: (o: string[]) => void;
  onImages: (m: (number | null)[]) => void;
  onAnswer: (i: number) => void;
}) {
  const setImg = (i: number, m: number | null) => onImages(opts.map((_, j) => (j === i ? m : images[j] ?? null)));
  return (
    <div className="mq-f">
      <label>Options · tap the tick to mark the right one</label>
      {opts.map((o, i) => (
        <div key={i} style={{ marginBottom: 8 }}>
          <div className="qz-orow" style={{ marginBottom: 0 }}>
            <button type="button" className={`qz-pick${answer === i ? ' on' : ''}`} title="Mark as the right answer" onClick={() => onAnswer(i)}>
              {answer === i ? <Icon name="check" strokeWidth={2.6} /> : letter(i)}
            </button>
            <input
              type="text"
              id={`${purpose}Opt${i}`}
              maxLength={maxLen}
              placeholder={i < 2 ? `Option ${i + 1}` : `Option ${i + 1} (optional)`}
              value={o}
              onChange={(e) => onOpts(opts.map((x, j) => (j === i ? e.target.value : x)))}
              style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', fontSize: 13.5, color: 'var(--ink)', fontFamily: 'inherit' }}
            />
            <TextImageBar inputId={`${purpose}Opt${i}`} hasText={!!o.trim()} image={images[i] ?? null} onImage={(m) => setImg(i, m)} purpose={purpose} />
          </div>
          <div style={{ marginLeft: 42 }}>
            <TextImageThumb small image={images[i] ?? null} onRemove={() => setImg(i, null)} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Client-side copy of the save rule, so the message shows before a round trip.
    An option counts if it has words or a picture. */
export function checkOptions(q: string, opts: string[], answer: number, images: (number | null)[] = [], qImage: number | null = null): string | null {
  if (!q.trim() && !qImage) return 'The question needs some words.';
  const filled = (i: number) => !!opts[i]?.trim() || !!images[i];
  const kept = opts.filter((_, i) => filled(i));
  if (kept.length < 2) return 'Give at least two options.';
  if (!filled(answer)) return 'The option you ticked is empty. Tick the right one.';
  return null;
}

export function FormCard({ children }: { children: ReactNode }) {
  return (
    <div className="card" style={{ marginTop: 6 }}>
      <div className="card-b">{children}</div>
    </div>
  );
}
