'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { fetcher, post, patch, del, ApiError } from '@/lib/client/api';
import { ErrorCard, Loading, Ok, useToast } from '@/components/staff/ui';
import { useStaff } from '@/components/staff/StaffContext';
import { BSWL_SYLLABUS, COHORT_SHORT, LOC_LABEL } from '@/lib/shared/constants';
import { first, pl, weekday } from './util';
import { useCopy } from '@/components/staff/Dialog';
import type { ClassCtx, RecList, RecRow } from './types';

/* Step 3 · The recording. A recording is a LINK, never a file. The default
   audience is read from the attendance already marked (absent students),
   by batch not hall. Taking access away takes two presses; granting one. */

const RELEASE_L = { absent: 'Students marked absent', batch: 'The whole batch', picked: 'Chosen students only' } as const;
type Release = keyof typeof RELEASE_L;

export function RecordingStep({ ctx, reloadClass }: { ctx: ClassCtx; reloadClass: () => void }) {
  const { toast, toastError } = useToast();
  const { refreshBadges } = useStaff();
  const { data, error, mutate } = useSWR<RecList>(`/api/staff/recordings?date=${ctx.date}&cohort=${ctx.cohort}`, fetcher, { keepPreviousData: true });

  const [loc, setLoc] = useState(Object.keys(LOC_LABEL)[0]);
  const [mins, setMins] = useState('');
  const [title, setTitle] = useState('');
  const [touched, setTouched] = useState(false);
  const [url, setUrl] = useState('');
  const [release, setRelease] = useState<Release>('absent');
  const [windowDays, setWindowDays] = useState(14);
  const [pick, setPick] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Leon already marked what he taught: suggest the title from the class log until someone types
  const suggestion = useMemo(() => {
    if (!ctx.logged.length) return '';
    const names: Record<string, string> = {};
    for (const u of BSWL_SYLLABUS) for (const [k, n] of u.topics) names[k] = `Unit ${u.u} · ${n}`;
    const units = [...new Set(ctx.logged.map((k) => k.split('.')[0]))];
    return units.length === 1 ? names[ctx.logged[0]] || `Unit ${units[0]}` : `Units ${units.join(' and ')} · ${ctx.logged.length} topics`;
  }, [ctx.logged]);
  const shownTitle = touched ? title : suggestion;

  const refresh = () => {
    mutate();
    reloadClass();
    refreshBadges();
  };

  if (error && !data) return <ErrorCard error={error} retry={() => mutate()} />;
  if (!data) return <Loading />;
  const pv = data.preview;
  const n = release === 'batch' ? pv.batch : release === 'absent' ? pv.absent : 0;
  const preview =
    release === 'absent' && !pv.marked
      ? `Nobody is marked absent for ${ctx.date} yet, so nobody would get it. Mark attendance for this class first, or give it to the whole batch.`
      : (release === 'picked' ? 'Nobody can watch it until you choose students.' : `Reaches ${pl(n, 'student')} the moment you add it.`) +
        (windowDays ? ` Available for ${windowDays} days after the class.` : ' Available with no time limit.');
  const urlWarn = !url.trim()
    ? ''
    : /^https:\/\//.test(url.trim())
      ? 'A link is not a lock. Anyone who opens it can forward it. This page controls who SEES the link, not what they do with it afterwards.'
      : 'That does not look like a link. Paste the full address, starting with https://';

  const add = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await post<{ reach: number }>('/api/staff/recordings', {
        date: ctx.date,
        cohort: ctx.cohort,
        loc,
        title: shownTitle.trim(),
        url: url.trim(),
        mins: Math.max(0, Math.min(600, Number(mins) || 0)),
        release,
        windowDays,
      });
      setTitle('');
      setTouched(true);
      setUrl('');
      setMins('');
      refresh();
      toast(<Ok>Added. {pl(r.reach, 'student')} can watch it. It reaches their apps on their next open.</Ok>);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="card">
        <div className="card-h">
          <h3>Add a recording</h3>
          <span className="hint">Paste the link from Drive, YouTube or Zoom. Your team does this, not Business Booster.</span>
        </div>
        <div className="card-b">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(165px,1fr))', gap: 10, marginBottom: 10 }}>
            <div>
              <label className="hint" htmlFor="recLoc">
                Class
              </label>
              <select id="recLoc" className="filter" style={{ width: '100%' }} value={loc} onChange={(e) => setLoc(e.target.value)}>
                {Object.entries(LOC_LABEL).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="hint" htmlFor="recMins">
                Length in minutes <span style={{ opacity: 0.7 }}>(optional)</span>
              </label>
              <input
                id="recMins"
                type="number"
                className="filter"
                style={{ width: '100%' }}
                min={1}
                max={600}
                placeholder="leave blank if you are not sure"
                value={mins}
                onChange={(e) => setMins(e.target.value)}
              />
            </div>
          </div>
          <div style={{ display: 'grid', gap: 10, marginBottom: 12 }}>
            <div>
              <label className="hint" htmlFor="recTitle">
                What the class covered
              </label>
              <input
                id="recTitle"
                className="filter"
                style={{ width: '100%' }}
                placeholder="Unit 4 · Organising and leading"
                maxLength={160}
                value={shownTitle}
                onChange={(e) => {
                  setTouched(true);
                  setTitle(e.target.value);
                }}
              />
            </div>
            <div>
              <label className="hint" htmlFor="recUrl">
                Recording link
              </label>
              <input
                id="recUrl"
                className="filter"
                style={{ width: '100%' }}
                placeholder="https://drive.google.com/file/d/..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
          </div>
          <div className="hint" style={{ marginBottom: 10 }}>
            {urlWarn}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10, marginBottom: 12 }}>
            <div>
              <label className="hint" htmlFor="recRelease">
                Who can watch it
              </label>
              <select id="recRelease" className="filter" style={{ width: '100%' }} value={release} onChange={(e) => setRelease(e.target.value as Release)}>
                <option value="absent">Only the students marked absent</option>
                <option value="batch">The whole batch</option>
                <option value="picked">Nobody yet, I will choose</option>
              </select>
            </div>
            <div>
              <label className="hint" htmlFor="recWindow">
                Available for
              </label>
              <select id="recWindow" className="filter" style={{ width: '100%' }} value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))}>
                <option value={14}>14 days after the class</option>
                <option value={7}>7 days after the class</option>
                <option value={30}>30 days after the class</option>
                <option value={0}>No limit</option>
              </select>
            </div>
          </div>
          <div className="hint" style={{ marginBottom: 12 }}>
            {preview}
          </div>
          <button className="btn-primary" onClick={add} disabled={busy}>
            Add the recording
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <h3>Recordings</h3>
          <span className="hint">
            {data.total} in the library · {data.live} available to watch now
          </span>
        </div>
        <div className="card-b">
          {data.rows.length ? (
            data.rows.map((r) => {
              const on = pick === r.id;
              return (
                <div key={r.id}>
                  <button className="att-row" style={{ width: '100%', textAlign: 'left' }} onClick={() => setPick(on ? null : r.id)} aria-expanded={on}>
                    <div className="pr-main">
                      <div className="pr-nm">{r.title}</div>
                      <div className="pr-mt">
                        {weekday(r.date)} {r.date} · {COHORT_SHORT[r.cohort]} Batch · {LOC_LABEL[r.loc] || r.loc}
                        {r.mins ? ` · ${r.mins} min` : ''}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{r.audience.length}</div>
                      <div className="hint">{r.live ? (r.daysLeft === null ? 'no limit' : `${r.daysLeft} days left`) : 'closed'}</div>
                    </div>
                    <span className="hint" style={{ marginLeft: 10 }}>
                      {on ? 'Hide' : 'Manage'}
                    </span>
                  </button>
                  {on && <RecPanel r={r} students={ctx.students} refresh={refresh} onRemoved={() => setPick(null)} />}
                </div>
              );
            })
          ) : (
            <div className="hint">No recordings yet. Add the first one above, right after a class.</div>
          )}
        </div>
      </div>
    </>
  );
}

function RecPanel({ r, students, refresh, onRemoved }: { r: RecRow; students: ClassCtx['students']; refresh: () => void; onRemoved: () => void }) {
  const { toast, toastError } = useToast();
  const copyText = useCopy();
  const [edit, setEdit] = useState(false);
  const [armed, setArmed] = useState<string | null>(null); // release value armed, or "rm:<id>" / "del"
  const [q, setQ] = useState('');

  const can = new Set(r.audience.map((s) => s.id));
  const hits = q.trim()
    ? students.filter((s) => s.cohort === r.cohort && !can.has(s.id) && s.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6)
    : [];

  const changeRelease = async (v: Release) => {
    try {
      const res = await patch<{ reach: number; lost: number }>(`/api/staff/recordings/${r.id}`, { release: v, confirm: armed === `rel:${v}` });
      setArmed(null);
      refresh();
      toast(<Ok>{`${res.reach} students can watch it now.${res.lost ? ` ${res.lost} lost access.` : ''}`}</Ok>);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'confirm') {
        setArmed(`rel:${v}`);
        toast(e.message);
      } else toastError(e);
    }
  };

  const changeWindow = async (v: number) => {
    try {
      await patch(`/api/staff/recordings/${r.id}`, { windowDays: v });
      refresh();
      toast(<Ok>Saved</Ok>);
    } catch (e) {
      toastError(e);
    }
  };

  const access = async (sid: number, give: boolean) => {
    if (!give && armed !== `rm:${sid}`) {
      setArmed(`rm:${sid}`);
      return;
    }
    try {
      const res = await post<{ name: string }>(`/api/staff/recordings/${r.id}/access`, { studentId: sid, grant: give });
      setArmed(null);
      setQ('');
      refresh();
      toast(<Ok>{give ? `${first(res.name)} can watch it.` : `Removed for ${first(res.name)}.`}</Ok>);
    } catch (e) {
      toastError(e);
    }
  };

  const remove = async () => {
    if (armed !== 'del') {
      setArmed('del');
      toast('Tap again to remove it from the app. The video itself stays on your drive.');
      return;
    }
    try {
      await del(`/api/staff/recordings/${r.id}`);
      onRemoved();
      refresh();
      toast(<Ok>Removed. The video itself is untouched on your drive.</Ok>);
    } catch (e) {
      toastError(e);
    }
  };

  if (edit) return <RecEdit r={r} done={() => setEdit(false)} refresh={refresh} />;

  return (
    <div className="card-b" style={{ padding: '12px 20px 16px', borderBottom: '1px solid var(--line)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10, marginBottom: 12 }}>
        <div>
          <label className="hint">Who can watch it</label>
          <select className="filter" style={{ width: '100%' }} value={armed?.startsWith('rel:') ? armed.slice(4) : r.release} onChange={(e) => changeRelease(e.target.value as Release)}>
            {(Object.keys(RELEASE_L) as Release[]).map((k) => (
              <option key={k} value={k}>
                {RELEASE_L[k]}
              </option>
            ))}
          </select>
          {armed?.startsWith('rel:') && (
            <button className="btn-ghost" style={{ marginTop: 6 }} onClick={() => changeRelease(armed.slice(4) as Release)}>
              Confirm: {RELEASE_L[armed.slice(4) as Release]}
            </button>
          )}
        </div>
        <div>
          <label className="hint">Available for</label>
          <select className="filter" style={{ width: '100%' }} value={r.windowDays} onChange={(e) => changeWindow(Number(e.target.value))}>
            <option value={14}>14 days after the class</option>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={0}>No limit</option>
          </select>
        </div>
      </div>
      <div className="hint" style={{ marginBottom: 10 }}>
        {r.live
          ? r.daysLeft === null
            ? 'Open with no time limit.'
            : `Closes in ${r.daysLeft} days.`
          : 'Closed. Students can no longer open it. Change the window above to reopen it.'}{' '}
        Added by {r.addedBy} on {r.addedOn}.
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <a className="btn-ghost" href={r.url} target="_blank" rel="noopener noreferrer">
          Open the recording
        </a>
        <button
          className="btn-ghost"
          onClick={() => copyText(r.url, 'Link copied')}
        >
          Copy link
        </button>
        <button className="btn-ghost" onClick={() => setEdit(true)}>
          Edit the details
        </button>
        <button className="btn-ghost" onClick={remove}>
          {armed === 'del' ? 'Tap again to remove' : 'Remove from the app'}
        </button>
      </div>
      <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 6 }}>Can watch it · {r.audience.length}</div>
      {r.audience.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {r.audience.slice(0, 24).map((s) => (
            <span className="chip" key={s.id} style={{ cursor: 'default' }}>
              {s.name} <span className="hint">{s.why}</span>{' '}
              <button className="hint" style={{ textDecoration: 'underline', marginLeft: 4 }} onClick={() => access(s.id, false)}>
                {armed === `rm:${s.id}` ? 'sure? remove' : 'remove'}
              </button>
            </span>
          ))}
          {r.audience.length > 24 && <span className="hint">and {r.audience.length - 24} more</span>}
        </div>
      ) : (
        <div className="hint" style={{ marginBottom: 12 }}>
          Nobody yet.
        </div>
      )}
      <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 6 }}>Give it to somebody else</div>
      <input className="filter" style={{ width: '100%', maxWidth: 320 }} placeholder="Search a student in this batch" value={q} onChange={(e) => setQ(e.target.value)} />
      {hits.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {hits.map((s) => (
            <button className="chip" key={s.id} onClick={() => access(s.id, true)}>
              {s.name}
            </button>
          ))}
        </div>
      ) : (
        q.trim() && (
          <div className="hint" style={{ marginTop: 8 }}>
            Nobody by that name who cannot already watch it.
          </div>
        )
      )}
    </div>
  );
}

/* Fixing a mistake keeps everyone it was given to; delete-and-add would not. */
function RecEdit({ r, done, refresh }: { r: RecRow; done: () => void; refresh: () => void }) {
  const { toast, toastError } = useToast();
  const [f, setF] = useState({ date: r.date, title: r.title, mins: String(r.mins ?? 0), cohort: r.cohort, loc: r.loc, url: r.url });
  const set = (k: keyof typeof f, v: string | number) => setF((o) => ({ ...o, [k]: v }));

  const save = async () => {
    try {
      const res = await patch<{ changes: number }>(`/api/staff/recordings/${r.id}`, {
        date: f.date,
        title: f.title.trim(),
        url: f.url.trim(),
        mins: Math.max(0, Number(f.mins) || 0),
        cohort: Number(f.cohort),
        loc: f.loc,
      });
      done();
      refresh();
      toast(res.changes ? <Ok>Saved. {pl(res.changes, 'change')}.</Ok> : 'Nothing changed.');
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div className="card-b" style={{ padding: '12px 20px 16px', borderBottom: '1px solid var(--line)' }}>
      <div className="hint" style={{ marginBottom: 10 }}>
        Fixing a mistake keeps everyone you already gave it to. Deleting and adding again does not.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10, marginBottom: 12 }}>
        <div>
          <label className="hint">Date of the class</label>
          <input className="filter" style={{ width: '100%' }} type="date" value={f.date} onChange={(e) => set('date', e.target.value)} />
        </div>
        <div>
          <label className="hint">What it covered</label>
          <input className="filter" style={{ width: '100%' }} value={f.title} maxLength={160} onChange={(e) => set('title', e.target.value)} />
        </div>
        <div>
          <label className="hint">Minutes</label>
          <input className="filter" style={{ width: '100%' }} type="number" min={0} value={f.mins} onChange={(e) => set('mins', e.target.value)} />
        </div>
        <div>
          <label className="hint">Batch</label>
          <select className="filter" style={{ width: '100%' }} value={f.cohort} onChange={(e) => set('cohort', Number(e.target.value))}>
            {COHORT_SHORT.map((c, i) => (
              <option key={c} value={i}>
                {c} Batch
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="hint">Place</label>
          <select className="filter" style={{ width: '100%' }} value={f.loc} onChange={(e) => set('loc', e.target.value)}>
            {Object.entries(LOC_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>
      <label className="hint">Recording link</label>
      <input className="filter" style={{ width: '100%', marginBottom: 12 }} value={f.url} onChange={(e) => set('url', e.target.value)} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn-primary" onClick={save}>
          Save the changes
        </button>
        <button className="btn-ghost" onClick={done}>
          Cancel
        </button>
      </div>
    </div>
  );
}
