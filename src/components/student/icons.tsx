/* The original app's icon set (var I, the dock, the quiz avatars), as JSX.
   Same paths and stroke widths, so the drawings match pixel for pixel. */

type P = { size?: number; className?: string };
const base = (sw: number, size?: number, cap = true) => ({
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: sw,
  ...(cap ? { strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const } : {}),
  ...(size ? { width: size, height: size } : {}),
  'aria-hidden': true,
});

export const Ic = {
  play: ({ size }: P) => (
    <svg {...base(2, size)}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <polygon points="10 9 15 12 10 15 10 9" />
    </svg>
  ),
  check: ({ size }: P) => (
    <svg {...base(2.6, size)}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
  chev: ({ size }: P) => (
    <svg {...base(2, size)}>
      <path d="M9 5l7 7-7 7" />
    </svg>
  ),
  half: ({ size }: P) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={size} height={size} aria-hidden>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" />
    </svg>
  ),
  dash: ({ size }: P) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" width={size} height={size} aria-hidden>
      <path d="M6 12h12" />
    </svg>
  ),
  clock: ({ size }: P) => (
    <svg {...base(1.8, size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  book: ({ size }: P) => (
    <svg {...base(1.8, size)}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15.5H6.5A2.5 2.5 0 0 0 4 21z" />
    </svg>
  ),
  doc: ({ size }: P) => (
    <svg {...base(1.8, size)}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  ),
  bolt: ({ size }: P) => (
    <svg {...base(1.8, size)}>
      <path d="M13 2 4.5 13H11l-.5 9L20 10.5h-6.5z" />
    </svg>
  ),
  cross: ({ size }: P) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" width={size} height={size} aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  ),
  back: ({ size = 20 }: P) => (
    <svg {...base(2, size)}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  ),
  close: ({ size = 20 }: P) => (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  ),
  bulb: ({ size, className }: P) => (
    <svg {...base(1.6, size)} className={className}>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-4 10.5c.8.7 1 1.6 1 2.5h6c0-.9.2-1.8 1-2.5A6 6 0 0 0 12 3z" />
    </svg>
  ),
  bell: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9" />
      <path d="M10.3 20a2 2 0 0 0 3.4 0" />
    </svg>
  ),
  /* dock */
  tToday: () => (
    <svg {...base(1.7)}>
      <path d="M13 2 4.5 13H11l-.5 9L20 10.5h-6.5z" />
    </svg>
  ),
  tLearn: () => (
    <svg {...base(1.7)}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15.5H6.5A2.5 2.5 0 0 0 4 21z" />
      <path d="M9 7.5h6M9 11h4" />
    </svg>
  ),
  tPractice: () => (
    <svg {...base(1.7)}>
      <circle cx="12" cy="12" r="3.2" />
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 1.5v2.6M12 19.9v2.6M22.5 12h-2.6M4.1 12H1.5" />
    </svg>
  ),
  tProgress: () => (
    <svg {...base(1.7)}>
      <path d="M5 20v-6M12 20V4M19 20v-9" />
    </svg>
  ),
  share: () => (
    <svg className="wt-ic" {...base(2)}>
      <path d="M12 16V3" />
      <path d="m8 7 4-4 4 4" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  ),
  plusSq: () => (
    <svg className="wt-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  ),
};

/* the eight quiz marks */
export const AVATARS = ['bulb', 'star', 'bolt', 'leaf', 'moon', 'cube', 'rocket', 'anchor'] as const;
export function Avatar({ k }: { k: string }) {
  const p = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true } as const;
  switch (k) {
    case 'star':
      return (
        <svg {...p} strokeLinejoin="round">
          <polygon points="12 3 14.9 9.2 21.5 10 16.7 14.6 17.9 21 12 17.8 6.1 21 7.3 14.6 2.5 10 9.1 9.2" />
        </svg>
      );
    case 'bolt':
      return (
        <svg {...p} strokeLinejoin="round">
          <polygon points="13 2 4.5 13 11 13 10.5 22 20 10.5 13.5 10.5" />
        </svg>
      );
    case 'leaf':
      return (
        <svg {...p}>
          <path d="M4 20c8 2 16-4 16-16-8 0-16 4-16 16z" />
          <path d="M4 20 14 10" />
        </svg>
      );
    case 'moon':
      return (
        <svg {...p}>
          <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
        </svg>
      );
    case 'cube':
      return (
        <svg {...p} strokeLinejoin="round">
          <path d="M21 16V8l-9-5-9 5v8l9 5z" />
          <path d="M3 8l9 5 9-5M12 13v8" />
        </svg>
      );
    case 'rocket':
      return (
        <svg {...p} strokeLinejoin="round">
          <path d="M12 2c3.5 2.5 5 6 5 10l-3 3h-4l-3-3c0-4 1.5-7.5 5-10z" />
          <path d="M9 18c-1 1.5-1 3-1 4 1.5 0 3-.5 4-1.5M15 18c1 1.5 1 3 1 4-1.5 0-3-.5-4-1.5" />
        </svg>
      );
    case 'anchor':
      return (
        <svg {...p}>
          <circle cx="12" cy="5" r="2" />
          <path d="M12 7v14M5 13a7 7 0 0 0 14 0M8 11H3M21 11h-5" />
        </svg>
      );
    default:
      return (
        <svg {...p}>
          <path d="M9 18h6M10 21h4" />
          <path d="M12 3a6 6 0 0 0-4 10.5c.8.7 1 1.6 1 2.5h6c0-.9.2-1.8 1-2.5A6 6 0 0 0 12 3z" />
        </svg>
      );
  }
}
