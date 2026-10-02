'use client';

import { useEffect, useRef, useState } from 'react';
import { post } from '@/lib/client/api';
import { useApp, type Ctx } from './ctx';
import { Ic } from './icons';
import { useOverlay } from './overlay';
import { Chev, Empty, KV } from './ui';
import { CTA, IB_TYPES, fmtD } from './model';

/* ══ UPDATES. Leon's messages, newest first. Opening one marks it read ON
   THE SERVER (the original only marked it on the phone, so it came back
   unread on every reload). Payment messages only ever say that a payment
   was recorded; nothing here states a balance. ══ */

function markRead(c: Ctx, id: number) {
  const msg = c.m?.inbox.find((x) => x.id === id);
  if (!msg || msg.read) return;
  c.write(
    (b) => ({ ...b, inbox: b.inbox.map((x) => (x.id === id ? { ...x, read: true } : x)) }),
    () => post(`/api/student/messages/${id}/read`),
  );
  c.say('Marked as read');
}

function register(c: Ctx, id: number, on: boolean) {
  c.write(
    (b) => ({ ...b, inbox: b.inbox.map((x) => (x.id === id ? { ...x, registered: on } : x)) }),
    () => post(`/api/student/messages/${id}/register`, { on }),
  );
}

export function MsgSheet({ id }: { id: number }) {
  const c = useApp();
  const m = c.m?.inbox.find((x) => x.id === id);
  useEffect(() => {
    markRead(c, id);
    // marking read is a one-off when the sheet opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (!m) return null;
  const go = (where: string) => {
    c.closeSheet();
    c.setInboxOpen(false);
    if (where === 'papers') c.show('learn', 'papers');
    else if (where === 'learn') c.show('learn', 'syllabus');
    else c.show('next');
  };
  let extra: React.ReactNode = null;
  if (m.courier) {
    const k = m.courier;
    extra = (
      <>
        <div className="list" style={{ marginTop: 'var(--s4)' }}>
          <KV k="Courier" v={k.co} />
          <KV k="Tracking number" v={k.no} />
          {k.note && <KV k="Note" v={k.note} />}
        </div>
        <button
          className="btn btn-primary"
          style={{ marginTop: 'var(--s4)' }}
          onClick={() => {
            try {
              navigator.clipboard.writeText(k.no);
            } catch {}
            c.showToast('Tracking number copied.');
          }}
        >
          Copy the tracking number
        </button>
      </>
    );
  } else if (m.type === 'seminar') {
    extra = (
      <>
        <div className="list" style={{ marginTop: 'var(--s4)' }}>
          <KV k="Your place" v={m.registered ? 'Registered' : 'Not registered yet'} />
        </div>
        {m.registered ? (
          <div className="banner" style={{ marginTop: 'var(--s4)' }}>
            You are registered. It goes on Leon’s list.
          </div>
        ) : (
          <button
            className="btn btn-primary"
            style={{ marginTop: 'var(--s4)' }}
            onClick={() => {
              register(c, id, true);
              c.closeSheet();
              c.showToast('Registered. Leon’s list has your name.', () => register(c, id, false));
            }}
          >
            Register
          </button>
        )}
      </>
    );
  } else if (m.type === 'payment') {
    extra = (
      <p className="meta" style={{ marginTop: 'var(--s3)' }}>
        Questions about a payment go to Leon directly, never through the app.
      </p>
    );
  } else {
    const cta = CTA[m.type];
    if (cta && cta.go !== 'courier' && cta.go !== 'seminar' && cta.go !== 'receipt')
      extra = (
        <button className="btn btn-primary" style={{ marginTop: 'var(--s4)' }} onClick={() => go(cta.go)}>
          {cta.label}
        </button>
      );
  }
  return (
    <>
      <h3 id="sheetTitle">{m.title}</h3>
      <p className="lede" style={{ whiteSpace: 'pre-line' }}>
        {m.body}
      </p>
      <p className="meta" style={{ marginTop: 'var(--s2)' }}>
        {IB_TYPES[m.type] || 'General'} · {fmtD(m.date)}
      </p>
      {extra}
    </>
  );
}

export function Inbox() {
  const c = useApp();
  const [f, setF] = useState('all');
  const ref = useRef<HTMLDivElement>(null);
  const close = () => c.setInboxOpen(false);
  useOverlay(c.inboxOpen, close, () => ref.current);
  const inbox = c.m?.inbox ?? [];
  const list = inbox.filter((x) => f === 'all' || x.type === f).sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : y.id - x.id));
  return (
    <div className={`inboxw${c.inboxOpen ? ' on' : ''}`} ref={ref} role="dialog" aria-modal="true" aria-label="Updates">
      <div className="ib-top">
        <button
          className="ic-btn"
          style={{ width: 40, height: 40, borderRadius: 'var(--r-pill)', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          aria-label="Back"
          onClick={close}
        >
          <Ic.back />
        </button>
        <h2 style={{ flex: 1 }}>Updates</h2>
      </div>
      <div className="ib-body">
        <div className="chipbar" role="group" aria-label="Filter updates">
          {Object.keys(IB_TYPES).map((k) => {
            const n = k === 'all' ? inbox.length : inbox.filter((x) => x.type === k).length;
            if (k !== 'all' && !n) return null;
            return (
              <button key={k} className="chip" aria-pressed={f === k} onClick={() => setF(k)}>
                {IB_TYPES[k]}
                <span className="num" style={{ opacity: 0.6 }}>
                  {n}
                </span>
              </button>
            );
          })}
        </div>
        <div style={{ marginTop: 'var(--s3)' }}>
          {list.length ? (
            list.map((x) => (
              <button key={x.id} className={`msg${x.read ? ' read' : ''}`} onClick={() => c.openSheet(<MsgSheet id={x.id} />)}>
                <span className="dotu" aria-hidden="true" />
                <span className="grow" style={{ flex: 1, minWidth: 0 }}>
                  <span className="m-t" style={{ display: 'block' }}>
                    {x.title}
                  </span>
                  <span className="m-b" style={{ display: 'block' }}>
                    {x.body}
                  </span>
                  <span className="m-m">
                    <span className="pill">{IB_TYPES[x.type] || 'General'}</span>
                    {fmtD(x.date)}
                    {x.read ? '' : ' · new'}
                  </span>
                </span>
                <Chev />
              </button>
            ))
          ) : (
            <Empty t="Nothing here yet" s="Updates from Leon arrive in this list." />
          )}
        </div>
      </div>
    </div>
  );
}
