'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/client/api';
import { ErrorCard, Loading, Tabs } from '@/components/staff/ui';
import { AttendanceStep } from '@/components/staff/teach/AttendanceStep';
import { TopicsStep } from '@/components/staff/teach/TopicsStep';
import { RecordingStep } from '@/components/staff/teach/RecordingStep';
import type { ClassCtx } from '@/components/staff/teach/types';
import { LOC_LABEL } from '@/lib/shared/constants';

/* ONE CLASS, ONE SCREEN. The date and batch are chosen once at the top and
   drive all three steps. The steps are numbered because the order matters:
   a recording releases to whoever was marked absent, so attendance has to be
   in before the link goes out. */

type Step = 'attendance' | 'topics' | 'recording';

export default function ClassesPage() {
  const [date, setDate] = useState<string | null>(null);
  const [cohort, setCohort] = useState(0);
  const [loc, setLoc] = useState('all');
  const [tab, setTab] = useState<Step>('attendance');

  // no date chosen yet: the server answers for the most recent register, or today
  const key = `/api/staff/classes?cohort=${cohort}${date ? `&date=${date}` : ''}`;
  const { data, error, mutate } = useSWR<ClassCtx>(key, fetcher, { keepPreviousData: true });

  if (error && !data) return <ErrorCard error={error} retry={() => mutate()} />;
  if (!data) return <Loading />;
  const shown = date ?? data.date;
  // keepPreviousData holds the last class on screen while the next one loads; its
  // steps must not stay live, or a tap would mark attendance on the old date
  const stale = shown !== data.date || cohort !== data.cohort;

  const hint = [
    data.marked ? 'attendance marked' : 'attendance NOT marked',
    data.logged.length ? `${data.logged.length} topics logged` : 'no topics yet',
    data.hasRecording ? 'recording added' : 'no recording',
  ].join(' · ');

  return (
    <>
      <div className="toolbar">
        <input type="date" className="filter" value={shown} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Class date" />
        <select className="filter" value={cohort} onChange={(e) => {
            setDate(shown);
            setCohort(Number(e.target.value));
          }} aria-label="Batch">
          <option value={0}>2027 Batch</option>
          <option value={1}>2028 Batch</option>
        </select>
        {tab === 'attendance' && (
          <select className="filter" value={loc} onChange={(e) => setLoc(e.target.value)} aria-label="Location">
            <option value="all">All locations</option>
            {Object.values(LOC_LABEL).map((l) => (
              <option key={l} value={l}>
                {l.replace(' · ', ' ')}
              </option>
            ))}
          </select>
        )}
        <div className="sp" />
        <span className="hint">{hint}</span>
      </div>
      <div style={{ marginBottom: 'var(--sp-5)' }}>
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            ['attendance', '1 · Who came'],
            ['topics', '2 · What you taught'],
            ['recording', '3 · The recording'],
          ]}
        />
      </div>
      {stale && (error ? <ErrorCard error={error} retry={() => mutate()} /> : <Loading />)}
      {!stale && tab === 'attendance' && <AttendanceStep key={`${data.date}:${data.cohort}`} ctx={data} loc={loc} reload={() => mutate()} />}
      {!stale && tab === 'topics' && <TopicsStep key={`${data.date}:${data.cohort}`} ctx={data} reload={() => mutate()} />}
      {!stale && tab === 'recording' && <RecordingStep key={`${data.date}:${data.cohort}`} ctx={data} reloadClass={() => mutate()} />}
    </>
  );
}
