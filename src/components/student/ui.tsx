'use client';

import { useRef, type ReactNode } from 'react';
import { Ic } from './icons';
import { useApp } from './ctx';
import { useOverlay } from './overlay';

/* Small shared pieces, with the original's markup and class names. */

export const Chev = () => (
  <span className="chev">
    <Ic.chev />
  </span>
);

export function Empty({ t, s }: { t: string; s: string }) {
  return (
    <div className="empty">
      <div className="ei">
        <Ic.book size={20} />
      </div>
      <h3>{t}</h3>
      <p className="lede" style={{ marginTop: 'var(--s1)' }}>
        {s}
      </p>
    </div>
  );
}

/** A key/value row inside a sheet's list (the original `row()`). */
export function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="rowbtn" style={{ cursor: 'default', minHeight: 48 }}>
      <span className="grow meta">{k}</span>
      <span style={{ fontSize: 'var(--t-sm)', textAlign: 'right' }}>{v}</span>
    </div>
  );
}

/** A two-line row: title, subtitle, optional right side, optional chevron. */
export function Row({
  t,
  w,
  right,
  onClick,
  href,
  bold,
  className = '',
}: {
  t: ReactNode;
  w?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  href?: string;
  bold?: boolean;
  className?: string;
}) {
  const inner = (
    <>
      <span className="grow">
        <span className="tt" style={bold ? { fontWeight: 550 } : undefined}>
          {t}
        </span>
        {w != null && w !== '' && <span className="tw">{w}</span>}
      </span>
      {right}
      {(onClick || href) && !right && <Chev />}
    </>
  );
  if (href)
    return (
      <a className={`rowbtn ${className}`} href={href} target="_blank" rel="noopener">
        {inner}
      </a>
    );
  if (onClick)
    return (
      <button className={`rowbtn ${className}`} onClick={onClick}>
        {inner}
      </button>
    );
  return (
    <div className={`rowbtn ${className}`} style={{ cursor: 'default' }}>
      {inner}
    </div>
  );
}

/** The app's own "are you sure", in the sheet: no browser dialog, so Back,
    Escape and a tap outside all mean the safe answer, as every sheet does. */
export function ConfirmSheet({ title, body, yes, no, onYes }: { title: string; body?: ReactNode; yes: string; no: string; onYes: () => void }) {
  const { closeSheet } = useApp();
  return (
    <>
      <h3 id="sheetTitle">{title}</h3>
      {body != null && <p className="lede">{body}</p>}
      <button
        className="btn btn-primary"
        style={{ width: '100%', marginTop: 'var(--s4)' }}
        onClick={() => {
          closeSheet();
          onYes();
        }}
      >
        {yes}
      </button>
      <button className="btn btn-secondary" style={{ width: '100%', marginTop: 'var(--s2)' }} onClick={closeSheet}>
        {no}
      </button>
    </>
  );
}

/* ── the sheet host: one bottom sheet, content swapped in place ── */
export function SheetHost() {
  const { sheet, closeSheet } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  useOverlay(!!sheet, closeSheet, () => ref.current);
  return (
    <div
      className={`scrim${sheet ? ' on' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) closeSheet();
      }}
    >
      {sheet && (
        <div className="sheet" ref={ref} role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
          <div className="grabber" />
          <div>{sheet}</div>
        </div>
      )}
    </div>
  );
}

export function ToastHost() {
  const { toast, hideToast, live } = useApp();
  return (
    <>
      <div className={`toast${toast?.on ? ' on' : ''}`} role="status" aria-live="polite">
        <span>{toast?.msg}</span>
        <button
          hidden={!toast?.undo}
          onClick={() => {
            toast?.undo?.();
            hideToast();
          }}
        >
          Undo
        </button>
      </div>
      <div className="sr" role="status" aria-live="polite">
        {live}
      </div>
    </>
  );
}
