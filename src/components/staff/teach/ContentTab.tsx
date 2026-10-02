'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { fetcher, patch, post, put } from '@/lib/client/api';
import { ErrorCard, Loading, Ok, Switch, useToast } from '@/components/staff/ui';
import { BSWL_SYLLABUS, LOC_LABEL, COHORT_SHORT, type AppConfig } from '@/lib/shared/constants';
import { MN_FULL } from '@/lib/shared/dates';

/* CONTENT: what the student app says. Unit weightage (#10), the exam date
   and class times (#3), the glossary (#8), the new-student guide (#11),
   "what to expect" (#12), splash lines, the commitment and help wording. */

type W = { unit: string; band: 'high' | 'medium' | 'low'; share: number | null; note: string; published: boolean };
type Klass = AppConfig['schedule']['classes'][number];
type Term = AppConfig['pages']['glossary'][number];

function useOp(reload: () => void) {
  const { toast, toastError } = useToast();
  return async (body: Record<string, unknown>, ok?: ReactNode) => {
    try {
      const r = await patch<{ version?: number }>('/api/staff/app', body);
      reload();
      if (ok) toast(ok);
      return r;
    } catch (e) {
      toastError(e);
      return null;
    }
  };
}

export function ContentTab({ cfg, reload }: { cfg: AppConfig; reload: () => void }) {
  const { toast } = useToast();
  const op = useOp(reload);
  const [line, setLine] = useState('');
  const [oath, setOath] = useState(cfg.oath.text);
  const [help, setHelp] = useState(cfg.support.help);

  const addLine = async () => {
    const v = line.trim();
    if (!v || v.length > 90) return toast('One line, under 90 characters.');
    if (/lazy|shame|stupid|fail(ure)?s?\b|excuse/i.test(v)) return toast('Not that tone. Useful and calm, never shaming.');
    if (await op({ op: 'splashAdd', line: v }, <Ok>Line added</Ok>)) setLine('');
  };

  return (
    <>
      <div className="card">
        <div className="card-h">
          <h3>Past papers</h3>
          <span className="hint">The library students see</span>
        </div>
        <div className="card-b">
          <div className="hint">
            Past papers, marking schemes and tutes are uploaded and published in the <Link href="/staff/library">Library</Link>.
          </div>
        </div>
      </div>

      <Weights />
      <Schedule cfg={cfg} op={op} />

      <div className="card">
        <div className="card-h">
          <h3>Splash lines</h3>
          <span className="hint">One shows each morning. Short, useful, never preachy and never shaming.</span>
        </div>
        <div className="card-b">
          {cfg.splash.map((l, i) => (
            <div key={`${i}:${l}`} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--hair)' }}>
              <span style={{ flex: 1, fontSize: 12.5 }}>{l}</span>
              <button
                className="btn-ghost"
                style={{ fontSize: 11 }}
                onClick={() => (cfg.splash.length <= 3 ? toast('Keep at least three lines in rotation.') : op({ op: 'splashDel', i }, <Ok>Line removed</Ok>))}
              >
                Remove
              </button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <input className="filter" placeholder="A new line, under 90 characters" style={{ flex: 1 }} value={line} onChange={(e) => setLine(e.target.value)} />
            <button className="btn-primary" onClick={addLine}>
              Add
            </button>
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            Lines rotate by date, one per day, the same line for the whole batch. Shaming language is refused automatically.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <h3>Student commitment</h3>
          <span className="hint">Every student signs this on day one</span>
        </div>
        <div className="card-b">
          <textarea className="filter" style={{ width: '100%', minHeight: 84, resize: 'vertical' }} value={oath} maxLength={600} onChange={(e) => setOath(e.target.value)} />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8 }}>
            <button
              className="btn-primary"
              onClick={async () => {
                if (!oath.trim()) return toast('The commitment cannot be empty.');
                const r = await op({ op: 'oath', text: oath.trim() });
                if (r) toast(<Ok>{r.version ? `Published as version ${r.version}. New students sign this one.` : 'Saved'}</Ok>);
              }}
            >
              Publish
            </button>
            <span className="hint">
              Version {cfg.oath.version} · in force since {cfg.oath.since}
            </span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <h3>Help wording</h3>
          <span className="hint">Shown when a student is stuck or locked out</span>
        </div>
        <div className="card-b">
          <textarea className="filter" style={{ width: '100%', minHeight: 64, resize: 'vertical' }} value={help} maxLength={400} onChange={(e) => setHelp(e.target.value)} />
          <button className="btn-primary" style={{ marginTop: 8 }} onClick={() => op({ op: 'help', help: help.trim() }, <Ok>Saved.</Ok>)}>
            Save
          </button>
        </div>
      </div>

      <Glossary cfg={cfg} op={op} />
      <Pages cfg={cfg} op={op} />
    </>
  );
}

/* ── Unit weightage: all units written together, one switch publishes all ── */
function Weights() {
  const { toast, toastError } = useToast();
  const { data, error, mutate } = useSWR<{ rows: W[] }>('/api/staff/weights', fetcher);
  // null = no unsaved edits: show what is stored
  const [draft, setRows] = useState<W[] | null>(null);

  if (error && !data) return <ErrorCard error={error} retry={() => mutate()} />;
  if (!data) {
    return (
      <div className="card">
        <div className="card-h">
          <h3>Unit weightage</h3>
        </div>
        <div className="card-b">
          <Loading />
        </div>
      </div>
    );
  }
  const rows = draft ?? data.rows;
  const on = data.rows.some((r) => r.published);
  const tot = rows.reduce((a, r) => a + (r.share ?? 0), 0);
  const set = (u: string, k: keyof W, v: unknown) => setRows(rows.map((r) => (r.unit === u ? { ...r, [k]: v } : r)));

  const save = async () => {
    try {
      await put('/api/staff/weights', { rows: rows.map((r) => ({ unit: r.unit, band: r.band, share: r.share, note: r.note?.trim() || null })) });
      await mutate();
      setRows(null);
      toast(<Ok>Weightage saved</Ok>);
    } catch (e) {
      toastError(e);
    }
  };
  const publish = async (v: boolean) => {
    try {
      await post('/api/staff/weights', { published: v });
      mutate();
      toast(v ? <Ok>Students can see the map</Ok> : 'Hidden from students');
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div className="card">
      <div className="card-h">
        <h3>Unit weightage</h3>
        <span className="hint">Where the marks are. Students see it on the syllabus, with your name on it.</span>
      </div>
      <div className="card-b">
        <div className="uw-head">
          <div className="uw-u">Unit</div>
          <div className="uw-b">Weight</div>
          <div className="uw-s">Share</div>
          <div className="uw-n">What tends to come up</div>
        </div>
        {BSWL_SYLLABUS.map((u) => {
          const r = rows.find((x) => x.unit === u.u) ?? { unit: u.u, band: 'medium' as const, share: null, note: '', published: false };
          return (
            <div key={u.u} className={`uw-row${r.band === 'high' ? ' hi' : ''}`}>
              <div className="uw-u">
                <b>{u.u}</b>
                <span>{u.name}</span>
              </div>
              <div className="uw-b">
                <select className="filter" value={r.band} onChange={(e) => set(u.u, 'band', e.target.value)}>
                  <option value="high">High yield</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <div className="uw-s">
                <input
                  className="filter"
                  type="text"
                  inputMode="numeric"
                  maxLength={3}
                  placeholder="–"
                  aria-label={`Share of the paper, unit ${u.u}`}
                  value={r.share ?? ''}
                  onChange={(e) => {
                    const n = e.target.value.replace(/[^0-9]/g, '');
                    set(u.u, 'share', n === '' ? null : Math.min(100, parseInt(n, 10)));
                  }}
                />
                <span className="pc">%</span>
              </div>
              <div className="uw-n">
                <input
                  className="filter"
                  type="text"
                  maxLength={160}
                  placeholder="Optional. One line a student can act on."
                  aria-label={`Note for unit ${u.u}`}
                  value={r.note ?? ''}
                  onChange={(e) => set(u.u, 'note', e.target.value)}
                />
              </div>
            </div>
          );
        })}
        <div className="uw-foot">
          <span className="hint">
            Shares add up to <b style={tot > 100 ? { color: 'var(--amber)' } : undefined}>{tot}%</b>
            {tot > 100 ? ' — that is more than a whole paper.' : tot && tot < 100 ? ' — the rest is unassigned, which is fine.' : ''}
          </span>
          <span className="sp" style={{ flex: 1 }} />
          <button className="btn-ghost" onClick={() => setRows(null)}>
            Discard changes
          </button>
          <button className="btn-primary" onClick={save}>
            Save
          </button>
        </div>
        <div className="stu-row" style={{ borderTop: '1px solid var(--line)', marginTop: 12, paddingTop: 14 }}>
          <div className="sr-l">
            <div className="t">Show it to students</div>
            <div className="s">All eight units at once. Half a map reads as &ldquo;the rest are worth nothing&rdquo;.</div>
          </div>
          <span className="sp" style={{ flex: 1 }} />
          <Switch on={on} onChange={publish} label="Show the weightage map to students" />
        </div>
      </div>
    </div>
  );
}

type Op = ReturnType<typeof useOp>;

/* ── #3 exam date and class times per location ── */
function Schedule({ cfg, op }: { cfg: AppConfig; op: Op }) {
  const [exam, setExam] = useState(cfg.schedule.examDate);
  const [rows, setRows] = useState<Klass[]>(cfg.schedule.classes);
  const set = (i: number, k: keyof Klass, v: unknown) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="card">
      <div className="card-h">
        <h3>Exam date and class times</h3>
        <span className="hint">Shown in the student and parent apps, and used by the exam countdown</span>
      </div>
      <div className="card-b">
        <div className="stu-row">
          <div className="sr-l">
            <div className="t">A/L exam date</div>
            <div className="s">the countdown counts to this day</div>
          </div>
          <input type="date" className="filter" value={exam} onChange={(e) => setExam(e.target.value)} />
        </div>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--hair)' }}>
            <select className="filter" value={r.loc} onChange={(e) => set(i, 'loc', e.target.value)} aria-label="Location">
              {Object.entries(LOC_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <select className="filter" value={r.cohort ?? ''} onChange={(e) => set(i, 'cohort', e.target.value === '' ? null : Number(e.target.value))} aria-label="Batch">
              <option value="">Both batches</option>
              {COHORT_SHORT.map((c, j) => (
                <option key={c} value={j}>
                  {c} Batch
                </option>
              ))}
            </select>
            <input className="filter" placeholder="Saturday" maxLength={20} value={r.day} onChange={(e) => set(i, 'day', e.target.value)} aria-label="Day" />
            <input className="filter" placeholder="8.00 am to 12.00 pm" maxLength={30} value={r.time} onChange={(e) => set(i, 'time', e.target.value)} aria-label="Time" />
            <input className="filter" placeholder="Note (optional)" maxLength={80} value={r.note ?? ''} onChange={(e) => set(i, 'note', e.target.value)} aria-label="Note" />
            <button className="btn-ghost" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button className="btn-ghost" onClick={() => setRows((rs) => [...rs, { loc: 'Kings', cohort: null, day: '', time: '', note: '' }])}>
            Add a class time
          </button>
          <span className="sp" style={{ flex: 1 }} />
          <button
            className="btn-primary"
            onClick={() =>
              op(
                { op: 'schedule', examDate: exam, classes: rows.filter((r) => r.day.trim() && r.time.trim()).map((r) => ({ ...r, note: r.note?.trim() || undefined })) },
                <Ok>Saved. Both apps show it on their next open.</Ok>,
              )
            }
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── #8 glossary ── */
function Glossary({ cfg, op }: { cfg: AppConfig; op: Op }) {
  const [items, setItems] = useState<Term[]>(cfg.pages.glossary);
  const set = (i: number, k: keyof Term, v: string) => setItems((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="card">
      <div className="card-h">
        <h3>Glossary</h3>
        <span className="hint">The terms a student looks up, in Leon&rsquo;s words</span>
      </div>
      <div className="card-b">
        {items.length === 0 && <div className="hint">No terms yet.</div>}
        {items.map((t, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px,1fr) minmax(200px,3fr) 80px auto', gap: 8, padding: '6px 0' }}>
            <input className="filter" placeholder="Term" maxLength={60} value={t.term} onChange={(e) => set(i, 'term', e.target.value)} aria-label="Term" />
            <input className="filter" placeholder="What it means" maxLength={300} value={t.def} onChange={(e) => set(i, 'def', e.target.value)} aria-label="Meaning" />
            <select className="filter" value={t.unit ?? ''} onChange={(e) => set(i, 'unit', e.target.value)} aria-label="Unit">
              <option value="">Any unit</option>
              {BSWL_SYLLABUS.map((u) => (
                <option key={u.u} value={u.u}>
                  Unit {u.u}
                </option>
              ))}
            </select>
            <button className="btn-ghost" onClick={() => setItems((rs) => rs.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button className="btn-ghost" onClick={() => setItems((rs) => [...rs, { term: '', def: '', unit: '' }])}>
            Add a term
          </button>
          <span className="sp" style={{ flex: 1 }} />
          <button
            className="btn-primary"
            onClick={() =>
              op(
                {
                  op: 'glossary',
                  items: items
                    .filter((t) => t.term.trim() && t.def.trim())
                    .map((t) => ({ term: t.term.trim(), def: t.def.trim(), ...(t.unit ? { unit: t.unit } : {}) }))
                    .sort((a, b) => a.term.localeCompare(b.term)),
                },
                <Ok>Glossary saved.</Ok>,
              )
            }
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── #11 new-student guide and #12 what to expect ── */
function Pages({ cfg, op }: { cfg: AppConfig; op: Op }) {
  const [guide, setGuide] = useState(cfg.pages.guide);
  const [month, setMonth] = useState(cfg.pages.expect.month);
  const [year, setYear] = useState(cfg.pages.expect.year);
  return (
    <>
      <div className="card">
        <div className="card-h">
          <h3>New-student guide</h3>
          <span className="hint">What a student reads on their first day in the app</span>
        </div>
        <div className="card-b">
          <textarea className="filter" style={{ width: '100%', minHeight: 140, resize: 'vertical' }} maxLength={4000} value={guide} onChange={(e) => setGuide(e.target.value)} />
          <button className="btn-primary" style={{ marginTop: 8 }} onClick={() => op({ op: 'guide', text: guide }, <Ok>Saved.</Ok>)}>
            Save
          </button>
        </div>
      </div>
      <div className="card">
        <div className="card-h">
          <h3>What to expect</h3>
          <span className="hint">The month and year the app&rsquo;s &ldquo;what to expect&rdquo; page is written for</span>
        </div>
        <div className="card-b">
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <select className="filter" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
              <option value="">Month</option>
              {MN_FULL.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <input className="filter" inputMode="numeric" maxLength={4} placeholder="Year" style={{ width: 100 }} value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, ''))} aria-label="Year" />
            <button className="btn-primary" onClick={() => op({ op: 'expect', month, year }, <Ok>Saved.</Ok>)}>
              Save
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
