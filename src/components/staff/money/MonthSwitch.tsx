'use client';

import { monthLbl } from '@/lib/shared/dates';

/* The original month switcher (.mo-switch): ‹ Month YYYY › */
export function MonthSwitch({ ym, onShift, prevDisabled, nextDisabled }: { ym: string; onShift: (n: number) => void; prevDisabled?: boolean; nextDisabled?: boolean }) {
  return (
    <div className="mo-switch">
      <button aria-label="Previous month" disabled={prevDisabled} onClick={() => onShift(-1)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <span className="mo-lbl">{monthLbl(ym)}</span>
      <button aria-label="Next month" disabled={nextDisabled} onClick={() => onShift(1)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </div>
  );
}
