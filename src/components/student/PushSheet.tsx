'use client';

import { useEffect, useState } from 'react';
import { useApp } from './ctx';
import { Ic } from './icons';
import { PUSH_LINE, isIOS, onPushChange, pushDisable, pushEnable, pushState } from './push';

/* The Reminders sheet: from Progress any time, and once, as `first`, after a
   student's first sign-in on this phone (the only time the app asks). */
export function PushSheet({ first = false }: { first?: boolean }) {
  const c = useApp();
  const [, bump] = useState(0);
  useEffect(() => onPushChange(() => bump((n) => n + 1)), []);
  const st = pushState();

  const enable = async () => {
    const msg = await pushEnable();
    if (msg === 'install') return;
    if (msg === 'Reminders on') c.closeSheet();
    c.showToast(first && msg === 'Reminders on' ? 'Reminders are on' : msg);
  };
  const later = () => c.closeSheet();

  let body: React.ReactNode;
  if (st === 'install')
    body = (
      <>
        <p className="lede">iPhone only sends reminders to apps on the home screen.</p>
        <ol className="wt-ol" style={{ marginTop: 'var(--s3)' }}>
          <li>
            <span className="wt-n">1</span>
            <Ic.share />
            <span>Tap Share, at the bottom of Safari</span>
          </li>
          <li>
            <span className="wt-n">2</span>
            <Ic.plusSq />
            <span>Choose &quot;Add to Home Screen&quot;</span>
          </li>
          <li>
            <span className="wt-n">3</span>
            <span style={{ width: 18 }} />
            <span>Open it from the home screen, then come back here and tap Turn on</span>
          </li>
        </ol>
        <p className="meta" style={{ marginTop: 'var(--s3)' }}>
          Needs iOS 16.4 or newer.
        </p>
        <button className="btn btn-secondary" style={{ width: '100%', marginTop: 'var(--s4)' }} onClick={later}>
          Not now
        </button>
      </>
    );
  else if (st === 'denied')
    body = (
      <>
        <p className="lede">Notifications are blocked for this app.</p>
        <p className="meta" style={{ marginTop: 'var(--s2)' }}>
          {isIOS()
            ? 'Open Settings, then Notifications, find BS With Leon and allow them.'
            : 'Tap the lock next to the address, or open your phone Settings, Apps, then allow notifications for this app.'}{' '}
          Then come back and tap Turn on.
        </p>
        <button className="btn btn-primary" style={{ width: '100%', marginTop: 'var(--s4)' }} onClick={enable}>
          Try again
        </button>
        {first && (
          <button className="btn btn-secondary" style={{ width: '100%', marginTop: 'var(--s2)' }} onClick={later}>
            Not now
          </button>
        )}
      </>
    );
  else if (st === 'unsupported') body = <p className="lede">{PUSH_LINE.unsupported}</p>;
  else
    body = (
      <>
        <p className="lede">A short nudge on your phone, even when the app is closed:</p>
        <ul className="meta" style={{ margin: 'var(--s3) 0 0 var(--s4)', lineHeight: 1.7 }}>
          <li>a class recording you missed is about to close</li>
          <li>a tute is waiting or needs a fix</li>
          <li>your monthly check-in is due</li>
          <li>big exam countdown days</li>
        </ul>
        <p className="meta" style={{ marginTop: 'var(--s3)' }}>
          {first ? 'Leon sets how many a day. You can change this any time in Progress.' : 'Leon sets how many a day. You can switch them off here any time.'}
        </p>
        {st === 'on' ? (
          <button
            className="btn btn-secondary"
            style={{ width: '100%', marginTop: 'var(--s4)' }}
            onClick={async () => {
              await pushDisable();
              c.closeSheet();
              c.showToast('Reminders off');
            }}
          >
            Turn off on this phone
          </button>
        ) : (
          <>
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 'var(--s4)' }} onClick={enable}>
              {first ? 'Turn on reminders' : 'Turn on'}
            </button>
            <button className="btn btn-secondary" style={{ width: '100%', marginTop: 'var(--s2)' }} onClick={later}>
              Not now
            </button>
          </>
        )}
      </>
    );
  return (
    <>
      <h3 id="sheetTitle">Reminders</h3>
      {body}
    </>
  );
}
