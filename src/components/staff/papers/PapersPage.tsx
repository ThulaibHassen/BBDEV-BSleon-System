'use client';

/* The Papers page carries four things under one tab bar: MCQ papers,
   speed drills, essay templates and the live class game. Papers and drills
   share one list and editor; they differ only by kind. */

import { useState } from 'react';
import { Tabs } from '@/components/staff/ui';
import { McqTab } from './McqTab';
import { EssayTab } from './EssayTab';
import { LiveTab } from './LiveTab';

type Tab = 'mcq' | 'drill' | 'essay' | 'live';
const TABS: Tab[] = ['mcq', 'drill', 'essay', 'live'];

export function PapersPage() {
  // ?tab=live brings the host back to the sets after a game (the shell renders pages client-side only)
  const [tab, setTab] = useState<Tab>(() => {
    const t = (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('tab')) as Tab | null;
    return t && TABS.includes(t) ? t : 'mcq';
  });

  const go = (t: Tab) => {
    setTab(t);
    window.history.replaceState(null, '', t === 'mcq' ? '/staff/quizzes' : `/staff/quizzes?tab=${t}`);
  };

  return (
    <div className="page active">
      <Tabs
        value={tab}
        onChange={go}
        tabs={[
          ['mcq', 'MCQ papers'],
          ['drill', 'Speed drills'],
          ['essay', 'Essay templates'],
          ['live', 'Live class quiz'],
        ]}
      />
      {(tab === 'mcq' || tab === 'drill') && <McqTab key={tab} kind={tab === 'drill' ? 'drill' : 'paper'} />}
      {tab === 'essay' && <EssayTab />}
      {tab === 'live' && <LiveTab />}
    </div>
  );
}
