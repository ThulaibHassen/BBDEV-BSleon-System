'use client';

/* Small pieces shared by the Library and Papers pages: batch labels, the
   original's date wording, the picture shrinker + upload, and the eight
   quiz avatars (the same set the student app shows). */

import { api } from '@/lib/client/api';
import { CFG } from '@/lib/shared/constants';
import { MN } from '@/lib/shared/dates';

export const cohortLabel = (c: number | null | undefined) => (c == null ? 'Any batch' : CFG.cohorts[c] ?? `Batch ${c}`);

export function CohortSelect({ value, onChange, id, className = 'filter' }: { value: number | null; onChange: (v: number | null) => void; id?: string; className?: string }) {
  return (
    <select id={id} className={className} value={value == null ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
      <option value="">Any batch</option>
      {CFG.cohorts.map((c, i) => (
        <option key={c} value={i}>
          {c}
        </option>
      ))}
    </select>
  );
}

/** "12 Aug 4.30pm", the original card wording (browser local time). */
export function human(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const hh = d.getHours();
  return `${d.getDate()} ${MN[d.getMonth()]} ${hh % 12 || 12}.${String(d.getMinutes()).padStart(2, '0')}${hh < 12 ? 'am' : 'pm'}`;
}

/** datetime-local wants local time with no zone. */
export function toLocal(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);

export function windowLine(from: string | null, to: string | null) {
  const f = human(from);
  const t = human(to);
  if (f && t) return `Open ${f} → ${t}`;
  if (f) return `Opens ${f}`;
  if (t) return `Closes ${t}`;
  return '';
}

export const mmss = (s: number | null | undefined) => {
  const n = Math.max(0, Math.round(s || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};

export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const letter = (i: number) => String.fromCharCode(65 + i);
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'paper';

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/* Shrink a picture in the browser (max 1200 px wide, JPEG 0.82) before it
   goes up. Forty full-size phone photos is a paper no phone will open. */
function shrink(file: File, max = 1200): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / img.naturalWidth);
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      const g = c.getContext('2d');
      if (!g) return reject(new Error('Could not read that image'));
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read that image'))), 'image/jpeg', 0.82);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image'));
    };
    img.src = url;
  });
}

export async function uploadPicture(file: File, purpose: 'mcq' | 'quiz' = 'mcq') {
  const blob = await shrink(file);
  const fd = new FormData();
  fd.append('file', new File([blob], 'picture.jpg', { type: 'image/jpeg' }));
  fd.append('purpose', purpose);
  return api<{ id: number; url: string }>('/api/staff/media', { method: 'POST', body: fd });
}

/** Open a library PDF through a fresh 2-minute staff ticket. */
export async function openDoc(id: number) {
  // open the tab inside the click so pop-up blockers allow it, then point it at the ticket
  const w = window.open('about:blank', '_blank');
  try {
    const t = await api<{ url: string }>(`/api/staff/library/${id}/open`, { method: 'POST' });
    if (w) w.location.href = t.url;
    else window.location.href = t.url;
  } catch (e) {
    w?.close();
    throw e;
  }
}

/* the eight avatars, line icons, no emoji */
const AV: Record<string, React.ReactNode> = {
  bulb: (
    <>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-4 10.5c.8.7 1 1.6 1 2.5h6c0-.9.2-1.8 1-2.5A6 6 0 0 0 12 3z" />
    </>
  ),
  star: <polygon strokeLinejoin="round" points="12 3 14.9 9.2 21.5 10 16.7 14.6 17.9 21 12 17.8 6.1 21 7.3 14.6 2.5 10 9.1 9.2" />,
  bolt: <polygon strokeLinejoin="round" points="13 2 4.5 13 11 13 10.5 22 20 10.5 13.5 10.5" />,
  leaf: (
    <>
      <path d="M4 20c8 2 16-4 16-16-8 0-16 4-16 16z" />
      <path d="M4 20 14 10" />
    </>
  ),
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />,
  cube: (
    <>
      <path strokeLinejoin="round" d="M21 16V8l-9-5-9 5v8l9 5z" />
      <path strokeLinejoin="round" d="M3 8l9 5 9-5M12 13v8" />
    </>
  ),
  rocket: (
    <>
      <path strokeLinejoin="round" d="M12 2c3.5 2.5 5 6 5 10l-3 3h-4l-3-3c0-4 1.5-7.5 5-10z" />
      <path strokeLinejoin="round" d="M9 18c-1 1.5-1 3-1 4 1.5 0 3-.5 4-1.5M15 18c1 1.5 1 3 1 4-1.5 0-3-.5-4-1.5" />
    </>
  ),
  anchor: (
    <>
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7v14M5 13a7 7 0 0 0 14 0M8 11H3M21 11h-5" />
    </>
  ),
};

export function Avatar({ k }: { k: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      {AV[k] ?? AV.bulb}
    </svg>
  );
}

/** Settings row in a panel, the original `stu-row`. */
export function Row({ t, s, children, first }: { t: string; s?: string; children: React.ReactNode; first?: boolean }) {
  return (
    <div className="stu-row" style={first ? { paddingTop: 0 } : undefined}>
      <div className="sr-l">
        <div className="t">{t}</div>
        {s && <div className="s">{s}</div>}
      </div>
      {children}
    </div>
  );
}

export const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
