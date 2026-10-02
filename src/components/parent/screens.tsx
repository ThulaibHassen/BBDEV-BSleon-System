'use client';

import type { ParentSchedule, ParentView } from '@/server/parent';
import { lkr, topicName } from '@/lib/shared/constants';
import { MN, daysBetween, fmtDateLong, monthLbl, todayISO } from '@/lib/shared/dates';
import { setPMode, type PMode } from './mode';
import type { usePush } from './push';
import { Bell, Chat, Chev } from './icons';

/* Four screens, one painter each, built out of the student app's own
   components: .hero for the thing that matters most on a screen, .pstat for
   a read-out, .list of .rowbtn for detail, .sect-h between them. Nothing here
   invents a component the student app does not already have. */

export type HubData = ParentView & { parent: { label: string }; schedule: ParentSchedule };
type Push = ReturnType<typeof usePush>;

const WA = 'https://wa.me/94771396173';
/* .hero .amt names 'Poppins' alone, which this app never loads, so a phone
   without it falls to the browser's default SERIF. The intended look is the
   system stack the rest of the page uses; it is named here as the fallback. */
const AMT_FONT = "'Poppins',-apple-system,BlinkMacSystemFont,'SF Pro Text','SF Pro Display','Segoe UI',Roboto,Inter,system-ui,sans-serif";
const plain = { cursor: 'default' } as const;

/** '2 Oct' */
const fmtD = (iso?: string | null) => {
  if (!iso) return '';
  const p = String(iso).slice(0, 10).split('-');
  return `${+p[2]} ${MN[+p[1] - 1]}`;
};

/* three states, and the words change with them: a parent should never have
   to work out from a number whether they owe anything */
export function feeState(f: HubData['fee']): 'paid' | 'due' | 'late' {
  if (f.total_owed > 0 && f.months_behind > 0) return 'late';
  if (f.due > 0) return 'due';
  return 'paid';
}

/* ══ FEES ══ the screen this app exists for */
export function Fees({ d, push, go }: { d: HubData; push: Push; go: (sc: 'settings') => void }) {
  const f = d.fee;
  const st = feeState(f);
  const amount = f.due > 0 ? f.due : f.amount;
  const word = { paid: 'Paid', due: 'Due', late: 'Overdue' }[st];
  const say = st === 'paid' ? 'Nothing to pay this month. Thank you.' : 'Payable to Leon at class, or by bank transfer.';
  const hello = `Hello Leon, this is ${d.parent.label || 'a parent'} of ${d.child.name}. `;
  return (
    <>
      <section className="hero fee">
        <div className="top">
          <div className="grow" style={{ flex: 1, minWidth: 0 }}>
            <div className="lbl">{st === 'paid' ? 'Paid this month' : 'To pay this month'}</div>
            <div className="amt" style={{ fontFamily: AMT_FONT }}>
              <span className="cur">LKR</span>
              {Math.round(amount || 0).toLocaleString('en-LK')}
            </div>
          </div>
          <span className={`st ${st}`}>
            <span className="dot" />
            {word}
          </span>
        </div>
        <p className="say">{say}</p>
        {f.total_owed > 0 && (
          <div className="strip">
            <span className="dot" />
            <span>
              <b>
                {f.months_behind} month{f.months_behind === 1 ? '' : 's'} outstanding
              </b>{' '}
              · {lkr(f.total_owed)} in total
            </span>
          </div>
        )}
      </section>

      <div className="ph-grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 'var(--s4)' }}>
        <a className="ph" style={{ textDecoration: 'none' }} href={`${WA}?text=${encodeURIComponent(hello)}`} target="_blank" rel="noopener">
          <Chat />
          <div>
            <div className="l">Message Leon</div>
            <div className="s">About the fee or the class</div>
          </div>
        </a>
        <button className="ph" onClick={() => go('settings')}>
          <Bell />
          <div>
            <div className="l">Fee reminders</div>
            <div className="s">{push.short}</div>
          </div>
        </button>
      </div>

      <div className="sect-h">
        <h2>Payments received</h2>
        <span className="meta num">{d.payments.length} recorded</span>
      </div>
      <div className="list">
        {d.payments.length ? (
          d.payments.map((p) => (
            <div className="rowbtn" style={plain} key={p.month}>
              <span className="grow">
                <span className="tt" style={{ fontWeight: 550 }}>
                  {monthLbl(p.month)}
                </span>
                <span className="tw">{p.paid_at ? `Received ${fmtD(p.paid_at)}` : 'Received'}</span>
              </span>
              <span className="num" style={{ fontWeight: 650 }}>
                {lkr(p.amount)}
              </span>
            </div>
          ))
        ) : (
          <div className="rowbtn" style={plain}>
            <span className="grow">
              <span className="tt" style={{ fontWeight: 550 }}>
                Nothing recorded yet
              </span>
              <span className="tw">A payment appears here once Leon marks it.</span>
            </span>
          </div>
        )}
      </div>
    </>
  );
}

/* ══ ATTENDANCE ══ the student app's Progress panel, with the register */
export function Attendance({ d }: { d: HubData }) {
  const a = d.attendance;
  const pct = a.marked ? Math.round((a.present / a.marked) * 100) : null;
  if (pct === null) {
    return (
      <article className="card">
        <h2>Nothing marked yet</h2>
        <p className="lede" style={{ marginTop: 'var(--s2)' }}>
          This fills in each week as Leon takes the register.
        </p>
      </article>
    );
  }
  const oldestFirst = a.recent.slice().sort((x, y) => String(x.date).localeCompare(String(y.date)));
  return (
    <>
      <section className="pstat">
        <div className="row">
          <div className="b">
            <div className="n">
              {pct}
              <i>%</i>
            </div>
            <div className="k">of classes attended</div>
          </div>
          <div className="b">
            <div className="n">
              {a.present}
              <i>/{a.marked}</i>
            </div>
            <div className="k">classes so far</div>
          </div>
        </div>
        <div className="track">
          <i style={{ width: `${pct}%` }} />
        </div>
      </section>
      <div className="sect-h">
        <h2>The last eight classes</h2>
      </div>
      <article className="card">
        <div className="att">
          {oldestFirst.map((x) => (
            <span key={x.date} className={x.present ? 'yes' : 'no'} title={fmtD(x.date)}>
              {fmtD(x.date).split(' ')[0]}
            </span>
          ))}
        </div>
        <div className="attkey">
          <span>
            <i className="yes" />
            attended
          </span>
          <span>
            <i className="no" />
            absent
          </span>
          <span>oldest first</span>
        </div>
      </article>
      <div className="list" style={{ marginTop: 'var(--s3)' }}>
        <div className="rowbtn" style={plain}>
          <span className="grow">
            <span className="tt">Marked in class</span>
            <span className="tw">By Leon, on the day. This app never guesses it.</span>
          </span>
        </div>
      </div>
    </>
  );
}

/* ══ CLASS ══ what the class covered, Leon's read, and (#3) when it meets */
export function ClassTab({ d }: { d: HubData }) {
  const c = d.child,
    s = d.syllabus,
    sch = d.schedule;
  const read = ({ good: 'Strong', bad: 'Needs work' } as Record<string, string>)[c.read] || 'Steady';
  const toExam = sch.examDate ? daysBetween(todayISO(), sch.examDate) : null;
  return (
    <>
      <div className="list">
        <div className="rowbtn" style={plain}>
          <span className="grow">
            <span className="tt">Topics covered so far</span>
            <span className="tw">Across the whole syllabus</span>
          </span>
          <span className="num" style={{ fontWeight: 650 }}>
            {s.covered || 0}
          </span>
        </div>
        {s.last_class && (
          <div className="rowbtn" style={plain}>
            <span className="grow">
              <span className="tt">Last class</span>
              {/* topic ids ('4.2') mean nothing to a parent; the names do */}
              <span className="tw">{(s.last_class.topics || []).map(topicName).join(', ') || 'No topics noted'}</span>
            </span>
            <span className="tw" style={{ flex: 'none' }}>
              {fmtD(s.last_class.date)}
            </span>
          </div>
        )}
        <div className="rowbtn" style={plain}>
          <span className="grow">
            <span className="tt">Leon&rsquo;s read</span>
            <span className="tw">Set by Leon in class, not worked out by this app</span>
          </span>
          <span className="pill">{read}</span>
        </div>
        <div className="rowbtn" style={plain}>
          <span className="grow">
            <span className="tt">Programme</span>
            <span className="tw">{c.class || ''}</span>
          </span>
          <span className="tw" style={{ flex: 'none' }}>
            {c.program || '—'}
          </span>
        </div>
      </div>

      <div className="sect-h">
        <h2>When class meets</h2>
        {c.class && <span className="meta">{c.class}</span>}
      </div>
      <div className="list">
        {sch.classes.length ? (
          sch.classes.map((k, i) => (
            <div className="rowbtn" style={plain} key={i}>
              <span className="grow">
                <span className="tt">{k.day}</span>
                {k.note && <span className="tw">{k.note}</span>}
              </span>
              <span className="tw num" style={{ flex: 'none' }}>
                {k.time}
              </span>
            </div>
          ))
        ) : (
          <div className="rowbtn" style={plain}>
            <span className="grow">
              <span className="tt">Times not set yet</span>
              <span className="tw">Leon adds them here once the timetable is fixed.</span>
            </span>
          </div>
        )}
        {toExam !== null && (
          <div className="rowbtn" style={plain}>
            <span className="grow">
              <span className="tt">The A/L exam</span>
              <span className="tw">
                {toExam > 1 ? `${toExam} days from today` : toExam === 1 ? 'Tomorrow' : toExam === 0 ? 'Today' : 'Already sat'}
              </span>
            </span>
            <span className="tw" style={{ flex: 'none' }}>
              {fmtDateLong(sch.examDate)}
            </span>
          </div>
        )}
      </div>

      <article className="card" style={{ marginTop: 'var(--s4)' }}>
        <h3>What is not here</h3>
        <p className="lede" style={{ marginTop: 'var(--s2)' }}>
          Marks, and the topics your child rates for themselves, are deliberately left out. A student who knows every attempt is
          watched stops logging honest ones, and then the app teaches nobody anything.
        </p>
      </article>
    </>
  );
}

/* ══ SETTINGS ══ */
export function Settings({ d, mode, push, signOut }: { d: HubData; mode: PMode; push: Push; signOut: () => void }) {
  const c = d.child;
  return (
    <>
      <article className="card">
        <h3>Appearance</h3>
        <p className="lede" style={{ marginTop: 'var(--s2)' }}>
          Auto follows your phone. Pick one if you would rather it stayed put.
        </p>
        <div className="seg" data-seg="mode" role="tablist" aria-label="Appearance" style={{ marginTop: 'var(--s3)' }}>
          {(
            [
              ['', 'Auto'],
              ['light', 'Light'],
              ['dark', 'Dark'],
            ] as [PMode, string][]
          ).map(([m, l]) => (
            <button key={l} role="tab" data-m={m} aria-selected={mode === m} onClick={() => setPMode(m)}>
              {l}
            </button>
          ))}
        </div>
      </article>
      <article className="card" style={{ marginTop: 'var(--s3)' }}>
        <h3>Fee reminder</h3>
        <p className="lede" style={{ marginTop: 'var(--s2)' }}>
          {push.line}
        </p>
        <button className="btn btn-secondary" style={{ marginTop: 'var(--s4)', width: '100%' }} onClick={push.toggle}>
          {push.state === 'on' ? 'Turn off reminders' : 'Turn on reminders'}
        </button>
      </article>
      <div className="sect-h">
        <h2>You</h2>
      </div>
      <div className="list">
        <div className="rowbtn" style={plain}>
          <span className="grow">
            <span className="tt">Signed in as</span>
            <span className="tw">
              {d.parent.label || 'Parent'} of {c.name}
            </span>
          </span>
        </div>
        <a className="rowbtn" href={WA} target="_blank" rel="noopener">
          <span className="grow">
            <span className="tt">Questions about the fee or the class</span>
            <span className="tw">Leon replies on WhatsApp</span>
          </span>
          <span className="chev">
            <Chev />
          </span>
        </a>
        <button className="rowbtn" onClick={signOut}>
          <span className="grow">
            <span className="tt">Sign out</span>
            <span className="tw">{c.name}</span>
          </span>
          <span className="chev">
            <Chev />
          </span>
        </button>
      </div>
    </>
  );
}
