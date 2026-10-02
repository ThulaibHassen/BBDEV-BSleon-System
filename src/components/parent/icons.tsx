/* The parent app's icons, verbatim from the original markup. */

const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const Chev = () => (
  <svg {...base} strokeWidth={2}>
    <path d="M9 5l7 7-7 7" />
  </svg>
);

export const Chat = () => (
  <svg {...base} strokeWidth={1.8}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

export const Bell = () => (
  <svg {...base} strokeWidth={1.8}>
    <path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9" />
    <path d="M10.3 20a2 2 0 0 0 3.4 0" />
  </svg>
);

export const Bulb = () => (
  <svg className="mark" {...base} strokeWidth={1.6} aria-hidden="true">
    <path d="M9 18h6M10 21h4" />
    <path d="M12 3a6 6 0 0 0-4 10.5c.8.7 1 1.6 1 2.5h6c0-.9.2-1.8 1-2.5A6 6 0 0 0 12 3z" />
  </svg>
);

export const TabIcon = ({ k }: { k: 'fees' | 'att' | 'class' | 'settings' }) => (
  <svg {...base} strokeWidth={1.7}>
    {k === 'fees' && (
      <>
        <line x1="12" y1="2" x2="12" y2="22" />
        <path d="M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </>
    )}
    {k === 'att' && (
      <>
        <rect x="3" y="4.5" width="18" height="17" rx="2.5" />
        <path d="M8 2.5v4M16 2.5v4M3 10h18" />
      </>
    )}
    {k === 'class' && (
      <>
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15.5H6.5A2.5 2.5 0 0 0 4 21z" />
        <path d="M9 7.5h6M9 11h4" />
      </>
    )}
    {k === 'settings' && (
      <>
        <circle cx="12" cy="12" r="3.2" />
        <path d="M19.9 15a1.7 1.7 0 0 0 .34 1.87 2 2 0 1 1-2.83 2.83 1.7 1.7 0 0 0-2.87 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.93-1.15 2 2 0 1 1-2.83-2.83A1.7 1.7 0 0 0 3.1 14a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.15-2.93 2 2 0 1 1 2.83-2.83A1.7 1.7 0 0 0 10 3.1a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.93 1.15 2 2 0 1 1 2.83 2.83A1.7 1.7 0 0 0 20.9 10a2 2 0 1 1 0 4 1.7 1.7 0 0 0-1 1z" />
      </>
    )}
  </svg>
);
