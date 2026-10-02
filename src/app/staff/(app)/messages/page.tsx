'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { fetcher, post, del } from '@/lib/client/api';
import { Empty, ErrorCard, Loading, Ok, useToast } from '@/components/staff/ui';
import type { MsgPage } from '@/components/staff/teach/types';
import { MSG_TYPES, PROG_LABEL } from '@/lib/shared/constants';
import { dateToColombo, feedStamp, monthLbl, ymNow, dPlus, todayISO } from '@/lib/shared/dates';
import { first, pl } from '@/components/staff/teach/util';

/* Messages to the student app. Debt wording never reaches a student (the
   privacy wall below, enforced again on the server). Sending takes two
   presses: the first one states the reach. */

const DEBT = /owe|owing|outstanding|overdue|arrears|balance|pay immediately|last warning/i;
const LABEL: Record<string, string> = {
  all: 'Whole academy',
  c0: '2027 Batch',
  c1: '2028 Batch',
  'loc:Kings': 'Kings · Nugegoda',
  'loc:JMC': 'JMC · Kiribathgoda',
  'loc:Sasik': 'Sasik · Gampaha',
  'loc:Residence': 'Residence',
  'mode:online': 'Everyone taught online',
  'mode:physical': 'Everyone taught in a hall',
  'prog:Theory': PROG_LABEL.Theory,
  'prog:Revision': PROG_LABEL.Revision,
  'prog:Combined': PROG_LABEL.Combined,
};

type Page = MsgPage & { to: { id: number; name: string; status: string } | null };

export default function MessagesRoute() {
  return (
    <Suspense fallback={<Loading />}>
      <MessagesPage />
    </Suspense>
  );
}

function MessagesPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const toId = Number(sp.get('to')) || 0;
  const draft = sp.get('draft');
  const { data, error, mutate } = useSWR<Page>(`/api/staff/messages${toId ? `?to=${toId}` : ''}`, fetcher, { keepPreviousData: true });
  const { toast, toastError } = useToast();

  const [type, setType] = useState('class');
  const [aud, setAud] = useState('all');
  const [co, setCo] = useState('');
  const [no, setNo] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [later, setLater] = useState(false);
  const [when, setWhen] = useState(`${dPlus(todayISO(), 1)}T09:00`);
  // armed = the exact form that was reviewed; any edit changes the signature and disarms it
  const [armedSig, setArmedSig] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  // the per-student lock survives only the jump from a student's record
  const toStudent = toId && data?.to?.id === toId ? data.to : null;
  const drafted = useRef(false);
  useEffect(() => {
    if (!toStudent) return;
    titleRef.current?.focus();
    if (draft === 'payment' && !drafted.current) {
      drafted.current = true;
      setType('payment');
      setTitle(`${monthLbl(ymNow())} payment recorded`);
      setBody('Thank you. Your receipt is ready to view.');
      toast(<Ok>Drafted for {first(toStudent.name)}. Check it, then send.</Ok>);
    }
  }, [toStudent, draft, toast]);

  if (error && !data) return <ErrorCard error={error} retry={() => mutate()} />;
  if (!data) return <Loading />;

  const target = toStudent ? `student:${toStudent.id}` : aud;
  const n = toStudent ? (toStudent.status === 'active' ? 1 : 0) : (data.counts[aud] ?? 0);
  const debt = DEBT.test(`${title} ${body}`);
  const sig = JSON.stringify([type, target, co, no, title, body, later, when]);
  const armed = armedSig === sig;
  const setArmed = (on: boolean) => setArmedSig(on ? sig : null);

  const clearStudent = () => router.replace('/staff/messages');

  const send = async () => {
    const t = title.trim();
    const b = body.trim();
    if (!t || !b) return toast('A message needs a title and a body.');
    if (debt) return toast('Blocked: debt wording never goes to a student app.');
    if (n === 0) return toast('That audience has no active students.');
    if (!armed) return setArmed(true);
    if (type === 'delivery' && !no.trim()) return toast('A courier dispatch needs the tracking number in its own field, not in the message.');
    setBusy(true);
    try {
      const r = await post<{ sent: number; scheduled: boolean }>('/api/staff/messages', {
        type,
        aud: target,
        title: t,
        body: b,
        courier: type === 'delivery' ? { co: co.trim(), no: no.trim() } : null,
        schedFor: later ? when.replace('T', ' ') : null,
      });
      setTitle('');
      setBody('');
      setCo('');
      setNo('');
      setArmed(false);
      if (toStudent) router.replace('/staff/messages');
      mutate();
      toast(
        <Ok>
          {r.scheduled ? `Scheduled for ${when.replace('T', ' ')}. It goes out on the hour after.` : `Sent to ${pl(r.sent, 'student')}. It is in their app now.`}
        </Ok>,
      );
    } catch (e) {
      setArmed(false);
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id: number) => {
    try {
      await del(`/api/staff/messages/${id}`);
      mutate();
      toast(<Ok>Scheduled message cancelled.</Ok>);
    } catch (e) {
      toastError(e);
    }
  };

  const k = data.kpis;
  const rsvpBy = new Map<string, MsgPage['rsvps']>();
  for (const r of data.rsvps) rsvpBy.set(r.seminar, [...(rsvpBy.get(r.seminar) ?? []), r]);

  return (
    <>
      <div className="kpi-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 'var(--sp-5)' }}>
        {(
          [
            ['Sent this month', k.sentThisMonth],
            ['Scheduled', k.scheduled],
            ['Read rate', k.readRate == null ? '–' : `${k.readRate}%`],
          ] as const
        ).map(([l, v]) => (
          <div key={l} className="card" style={{ margin: 0, padding: '14px 16px' }}>
            <div className="hint">{l}</div>
            <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-h">
          <h3>Send an update</h3>
          <span className="hint">It lands in each student&rsquo;s app, on their dashboard when it matters</span>
        </div>
        <div className="card-b">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label className="hint" htmlFor="msgType">
                Type
              </label>
              <select className="filter" id="msgType" style={{ width: '100%' }} value={type} onChange={(e) => setType(e.target.value)}>
                {Object.entries(MSG_TYPES).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="hint" htmlFor="msgAud">
                Send to
              </label>
              <select className="filter" id="msgAud" style={{ width: '100%' }} value={aud} disabled={!!toStudent} onChange={(e) => setAud(e.target.value)}>
                <option value="all">Whole academy</option>
                <option value="c0">2027 Batch</option>
                <option value="c1">2028 Batch</option>
                <option value="loc:Kings">Kings, Nugegoda</option>
                <option value="loc:JMC">JMC, Kiribathgoda</option>
                <option value="loc:Sasik">Sasik, Gampaha</option>
                <option value="loc:Residence">Residence</option>
                <optgroup label="How they attend">
                  <option value="mode:online">Online students</option>
                  <option value="mode:physical">Physical students</option>
                </optgroup>
                <optgroup label="What they take">
                  <option value="prog:Theory">Theory Only</option>
                  <option value="prog:Revision">Revision Only</option>
                  <option value="prog:Combined">Theory and Revision</option>
                </optgroup>
              </select>
            </div>
          </div>
          {type === 'delivery' && (
            <div style={{ display: 'grid', marginTop: 10, gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label className="hint" htmlFor="msgCourierCo">
                  Courier
                </label>
                <input className="filter" id="msgCourierCo" style={{ width: '100%' }} maxLength={40} placeholder="Fardar Express" value={co} onChange={(e) => setCo(e.target.value)} />
              </div>
              <div>
                <label className="hint" htmlFor="msgCourierNo">
                  Tracking number
                </label>
                <input className="filter" id="msgCourierNo" style={{ width: '100%' }} maxLength={30} placeholder="FD1284563" value={no} onChange={(e) => setNo(e.target.value)} />
              </div>
            </div>
          )}
          <div style={{ marginTop: 10 }}>
            <label className="hint" htmlFor="msgTitle">
              Title
            </label>
            <input
              ref={titleRef}
              className="filter"
              id="msgTitle"
              style={{ width: '100%' }}
              maxLength={80}
              placeholder="Saturday class starts at 9.00"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div style={{ marginTop: 10 }}>
            <label className="hint" htmlFor="msgBody">
              Message
            </label>
            <textarea
              className="filter"
              id="msgBody"
              style={{ width: '100%', minHeight: 74, resize: 'vertical' }}
              maxLength={400}
              placeholder="Short and clear. Students read this on a phone."
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
            <label className="hint" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={later} onChange={(e) => setLater(e.target.checked)} /> Send later
            </label>
            {later && (
              <input
                type="datetime-local"
                className="filter"
                value={when}
                min={dateToColombo(new Date()).replace(' ', 'T')}
                onChange={(e) => setWhen(e.target.value)}
                aria-label="Send at (Sri Lanka time)"
              />
            )}
            {later && <span className="hint">Sri Lanka time · goes out on the hour after</span>}
          </div>
          <div className="hint" style={{ marginTop: 10 }}>
            Reaches {pl(n, 'active student')} ·{' '}
            {toStudent ? (
              <>
                {toStudent.name} only ·{' '}
                <button className="hint" style={{ textDecoration: 'underline' }} onClick={clearStudent}>
                  clear
                </button>
              </>
            ) : (
              LABEL[aud]
            )}
          </div>
          <div className="hint" style={{ marginTop: 6, fontWeight: 700 }}>
            {debt ? 'This reads like a payment demand. Debt wording never goes to a student. Use the Fees screen for parent-facing reminders.' : ''}
          </div>
          <button className="btn-primary" style={{ marginTop: 12 }} onClick={send} disabled={busy}>
            {armed ? `${later ? 'Schedule for' : 'Send to'} ${pl(n, 'student')}?` : 'Review and send'}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <h3>Who is coming</h3>
          <span className="hint">
            {rsvpBy.size ? `${data.rsvps.length} registered across ${pl(rsvpBy.size, 'seminar')}` : 'nobody yet'}
          </span>
        </div>
        <div className="card-b">
          {rsvpBy.size ? (
            [...rsvpBy.entries()].map(([sem, rs]) => (
              <div key={sem} style={{ padding: '8px 0' }}>
                <b style={{ fontSize: 13.5 }}>{sem}</b>
                <span className="hint"> · {rs.length} registered</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {rs.map((r, i) => (
                    <span className="chip" key={i} style={{ cursor: 'default' }}>
                      {r.student}
                      <span className="hint"> {r.batch}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="hint">Nobody has registered yet. Registrations appear here as students tap Register in the app.</div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <h3>Sent and scheduled</h3>
          <span className="hint">Opened counts come from the student app, as each student reads it</span>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Message</th>
              <th>Audience</th>
              <th className="tnum">Sent to</th>
              <th className="tnum">Opened</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.messages.length ? (
              data.messages.map((m) => (
                <tr key={m.id}>
                  <td>
                    <b>{m.title}</b>
                    <div className="hint">
                      {m.body.slice(0, 60)}
                      {m.body.length > 60 ? '…' : ''}
                    </div>
                    {m.courier && (
                      <div className="hint">
                        {m.courier.co} · {m.courier.no}
                      </div>
                    )}
                    {m.type === 'seminar' && m.registered != null && <div className="hint">{m.registered} registered</div>}
                  </td>
                  <td>{m.aud}</td>
                  <td className="tnum">{m.status === 'sent' ? m.sent || '–' : '–'}</td>
                  <td className="tnum">{m.status === 'sent' ? m.opened : '–'}</td>
                  <td>
                    {m.status === 'scheduled' ? (
                      <>
                        <span className="hint">Scheduled · {m.schedFor ? feedStamp(m.schedFor) : ''}</span>{' '}
                        <button className="hint" style={{ textDecoration: 'underline' }} onClick={() => cancel(m.id)}>
                          cancel
                        </button>
                      </>
                    ) : (
                      <>
                        Sent
                        {m.sentAt && <div className="hint">{feedStamp(m.sentAt)}</div>}
                      </>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} style={{ padding: 0 }}>
                  <Empty icon="inbox" title="No messages yet" sub="Announcements you send to a class or a single student appear here, with what was opened." />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
