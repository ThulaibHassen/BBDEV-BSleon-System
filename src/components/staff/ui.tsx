'use client';

/* Shared staff components — the React versions of the original SECTION 8
   (toast + undo, modals, panel, validation, empty states, KPIs, bar chart,
   count-up). Class names are the original ones, styled by styles/staff.css. */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { lkr } from '@/lib/shared/constants';

/* ─── Toast + Undo (12 s undo window, Ctrl/Cmd+Z runs it) ─────────────── */

type ToastCtx = {
  toast: (msg: ReactNode, ms?: number) => void;
  toastUndo: (msg: ReactNode, undo: () => void | Promise<void>, ms?: number) => void;
  toastError: (e: unknown) => void;
};
const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<ReactNode>(null);
  const [show, setShow] = useState(false);
  const undoRef = useRef<null | (() => void | Promise<void>)>(null);
  const [hasUndo, setHasUndo] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hovered = useRef(false);

  const hide = useCallback(() => {
    setShow(false);
    undoRef.current = null;
    setHasUndo(false);
  }, []);

  const arm = useCallback(
    (ms: number) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(function tick() {
        if (hovered.current) timer.current = setTimeout(tick, 1500);
        else hide();
      }, ms);
    },
    [hide],
  );

  const toast = useCallback(
    (m: ReactNode, ms = 2800) => {
      undoRef.current = null;
      setHasUndo(false);
      setMsg(m);
      setShow(true);
      arm(ms);
    },
    [arm],
  );

  const toastUndo = useCallback(
    (m: ReactNode, fn: () => void | Promise<void>, ms = 12000) => {
      undoRef.current = fn;
      setHasUndo(true);
      setMsg(m);
      setShow(true);
      arm(ms);
    },
    [arm],
  );

  const toastError = useCallback(
    (e: unknown) => toast(<>{(e as Error)?.message || 'Not saved. Check the connection.'}</>, 4200),
    [toast],
  );

  const runUndo = useCallback(async () => {
    const fn = undoRef.current;
    hide();
    if (fn) await fn();
  }, [hide]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toUpperCase();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && undoRef.current && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        runUndo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [runUndo]);

  return (
    <Ctx.Provider value={{ toast, toastUndo, toastError }}>
      {children}
      <div
        className={`toast${show ? ' show' : ''}`}
        role="status"
        aria-live="polite"
        onMouseEnter={() => (hovered.current = true)}
        onMouseLeave={() => {
          hovered.current = false;
          if (show) arm(2000);
        }}
      >
        {msg}
        {hasUndo && (
          <button className="t-act" onClick={runUndo}>
            Undo<span className="sr-only"> the last action, or press Control Z</span>
          </button>
        )}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useToast outside ToastProvider');
  return c;
}

/** Toast text with the check icon, the way every original success toast starts. */
export const Ok = ({ children }: { children: ReactNode }) => (
  <>
    <Icon name="check" strokeWidth={2.6} /> {children}
  </>
);

/* ─── Overlay stack ───────────────────────────────────────────────────────
   Panels, modals and the confirm/prompt dialog can sit on top of each other
   (a "Deactivate?" confirm over the Manage-user modal). Escape closes only the
   top one, and the body scroll lock holds until the last modal closes. */

const escStack: symbol[] = [];
let locks = 0;

function useEscape(open: boolean, onClose: () => void) {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const me = Symbol('overlay');
    escStack.push(me);
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && escStack[escStack.length - 1] === me) close.current();
    };
    window.addEventListener('keydown', k);
    return () => {
      window.removeEventListener('keydown', k);
      escStack.splice(escStack.indexOf(me), 1);
    };
  }, [open]);
}

/* ─── Modal ───────────────────────────────────────────────────────────── */

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  width,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEscape(open, onClose);
  useEffect(() => {
    if (!open) return;
    if (locks++ === 0) document.body.classList.add('sheet-open');
    return () => {
      if (--locks === 0) document.body.classList.remove('sheet-open');
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="modal-ov open" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" style={width ? { width } : undefined}>
        <div className="modal-h">
          <h3>{title}</h3>
          <button className="pn-close" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

/* ─── Panel (right side sheet) ────────────────────────────────────────── */

export function Panel({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEscape(open, onClose);
  return (
    <>
      <div className={`overlay${open ? ' open' : ''}`} onClick={onClose} />
      <div className={`panel${open ? ' open' : ''}`} role="dialog" aria-modal="true" aria-hidden={!open}>
        {open && children}
      </div>
    </>
  );
}

export function PanelHead({ title, sub, badges, actions, onClose }: { title: ReactNode; sub?: ReactNode; badges?: ReactNode; actions?: ReactNode; onClose: () => void }) {
  return (
    <div className="pn-head">
      <button className="pn-close" onClick={onClose} aria-label="Close">
        <Icon name="x" />
      </button>
      <div className="pn-nm">{title}</div>
      {sub && <div className="pn-co">{sub}</div>}
      {badges && <div className="pn-badges">{badges}</div>}
      {actions && <div className="pn-actions">{actions}</div>}
    </div>
  );
}

/* ─── Form field with the original validation look ────────────────────── */

export function Field({ label, error, children, id }: { label: ReactNode; error?: string | false | null; children: ReactNode; id?: string }) {
  return (
    <div className={`fld${error ? ' invalid' : ''}`} id={id}>
      <label>{label}</label>
      {children}
      {error ? <div className="err">{error}</div> : null}
    </div>
  );
}

/* ─── Empty state ─────────────────────────────────────────────────────── */

export function Empty({ icon = 'inbox', title, sub, cta }: { icon?: string; title: ReactNode; sub?: ReactNode; cta?: ReactNode }) {
  return (
    <div className="empty">
      <div className="es-ic">
        <Icon name={icon} />
      </div>
      <div className="es-t">{title}</div>
      {sub && <div className="es-s">{sub}</div>}
      {cta && <div className="es-cta">{cta}</div>}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="empty" aria-busy="true">
      <div className="es-s">{label}</div>
    </div>
  );
}

export function ErrorCard({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="card">
      <div className="card-b">
        <Empty
          icon="warn"
          title="This view hit a problem"
          sub={
            <>
              Your data is safe: the rest of the system keeps working.
              <br />
              <span style={{ color: 'var(--faint)' }}>{String((error as Error)?.message || error).slice(0, 120)}</span>
            </>
          }
          cta={
            retry && (
              <button className="btn-ghost" onClick={retry}>
                Try again
              </button>
            )
          }
        />
      </div>
    </div>
  );
}

/* ─── Count-up (data-to animation, 780 ms ease-out-cubic) ─────────────── */

export function fmtNum(v: number, fmt?: 'int' | 'lkr' | 'pct' | 'm') {
  if (fmt === 'm') return `LKR ${(v / 1e6).toFixed(2)}M`;
  if (fmt === 'pct') return `${Math.round(v)}%`;
  if (fmt === 'lkr') return lkr(v);
  return Math.round(v).toLocaleString();
}

export function CountUp({ to, from = 0, fmt }: { to: number; from?: number; fmt?: 'int' | 'lkr' | 'pct' | 'm' }) {
  const [v, setV] = useState(from);
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setV(to);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 780);
      const e = 1 - Math.pow(1 - k, 3);
      setV(from + (to - from) * e);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, from]);
  return <>{fmtNum(v, fmt)}</>;
}

/* ─── Bar chart (inline SVG, width 720, bars grow over .7 s) ──────────── */

export type Bar = { label: string; v: number; top: string; full?: string; hi?: boolean };

export function BarChart({ data, h = 140 }: { data: Bar[]; h?: number }) {
  const W = 720;
  const TOP = 24;
  const max = Math.max(1, ...data.map((d) => d.v));
  const gap = W / Math.max(1, data.length);
  const bw = Math.min(48, gap * 0.5);
  return (
    <svg viewBox={`0 ${-TOP} ${W} ${h + 30 + TOP}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Bar chart">
      {data.map((d, i) => {
        const bh = Math.max(3, (d.v / max) * h);
        const cx = i * gap + gap / 2;
        const x = cx - bw / 2;
        return (
          <g key={i} className={`bcol${d.hi ? ' on' : ''}`}>
            <title>{`${d.label}: ${d.full || d.top}`}</title>
            <rect className="bhit" x={cx - gap / 2} y={-TOP} width={gap} height={h + TOP} fill="transparent" />
            <rect className="bbar" x={x} y={h - bh} width={bw} height={bh} rx={6} fill={d.hi ? 'var(--brand)' : 'var(--line)'}>
              <animate attributeName="height" from="0" to={bh} dur="0.7s" fill="freeze" />
              <animate attributeName="y" from={h} to={h - bh} dur="0.7s" fill="freeze" />
            </rect>
            <text className="bval" x={cx} y={h - bh - 9} textAnchor="middle" fontSize={14} fontWeight={700} fill={d.hi ? 'var(--brand)' : 'var(--ink)'}>
              {d.top}
            </text>
            <text x={cx} y={h + 22} textAnchor="middle" fontSize={14} fill="var(--muted)">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ─── Small helpers ───────────────────────────────────────────────────── */

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: [T, ReactNode][] }) {
  return (
    <div className="tabbar" role="tablist">
      {tabs.map(([k, l]) => (
        <button key={k} role="tab" aria-selected={value === k} className={`tab${value === k ? ' active' : ''}`} onClick={() => onChange(k)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" className={`sw${on ? ' on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />
  );
}

/** Download a CSV built in the browser (UTF-8 BOM so Excel opens Sinhala names correctly). */
export function downloadCsv(name: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (v: unknown) => {
    let s = v == null ? '' : String(v);
    // a text cell starting = + - @ is run as a formula by Excel: keep it plain text
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name.endsWith('.csv') ? name : `${name}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}
