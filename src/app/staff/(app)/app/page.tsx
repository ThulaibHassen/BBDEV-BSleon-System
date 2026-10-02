'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/client/api';
import { ErrorCard, Loading, Tabs } from '@/components/staff/ui';
import { AccessTab } from '@/components/staff/teach/AccessTab';
import { ExperienceTab } from '@/components/staff/teach/ExperienceTab';
import { ContentTab } from '@/components/staff/teach/ContentTab';
import { HealthTab } from '@/components/staff/teach/HealthTab';
import type { AccessData } from '@/components/staff/teach/types';
import type { AppConfig } from '@/lib/shared/constants';

/* STUDENT APP CONTROL v2. The team runs logins and app settings without BB.
   No password is ever stored or shown; every sensitive action is audited;
   rankings do not exist here. */

type Tab = 'access' | 'experience' | 'content' | 'health';
type Data = { config: AppConfig; access: AccessData; counts: Record<string, number>; health: { failed: number; version: string } };

export default function StudentAppPage() {
  const [tab, setTab] = useState<Tab>('access');
  const { data, error, mutate } = useSWR<Data>('/api/staff/app', fetcher, { keepPreviousData: true });
  if (error && !data) return <ErrorCard error={error} retry={() => mutate()} />;
  if (!data) return <Loading />;
  const reload = () => void mutate();
  return (
    <>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ['access', 'Access'],
          ['experience', 'Experience'],
          ['content', 'Content'],
          ['health', 'Health'],
        ]}
      />
      {tab === 'access' && <AccessTab access={data.access} reload={reload} />}
      {tab === 'experience' && <ExperienceTab cfg={data.config} counts={data.counts} reload={reload} />}
      {tab === 'content' && <ContentTab cfg={data.config} reload={reload} />}
      {tab === 'health' && <HealthTab access={data.access} health={data.health} go={setTab} />}
    </>
  );
}
