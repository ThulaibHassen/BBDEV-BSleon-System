'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/client/api';
import { TASK_ARCHIVE_DAYS } from '@/lib/shared/constants';
import { Icon } from '@/components/staff/Icon';
import { ErrorCard, Loading } from '@/components/staff/ui';
import { TaskModal, TaskRows } from '@/components/staff/crm/Tasks';
import type { Task } from '@/components/staff/crm/types';

/* Task Book: open, then done. Finished tasks leave the screen after four days
   and stay in the data (archived, never deleted) — and the page says so. */
export default function TasksPage() {
  const { data, error, mutate } = useSWR<{ tasks: Task[]; archived: number }>('/api/staff/tasks', fetcher);
  const [adding, setAdding] = useState(false);
  const refresh = () => void mutate();

  const openT = data?.tasks.filter((t) => !t.d) ?? [];
  const doneT = data?.tasks.filter((t) => t.d) ?? [];
  const gone = data?.archived ?? 0;

  return (
    <>
      <div className="toolbar">
        <span className="hint" style={{ fontSize: 12.5, color: 'var(--muted)' }}>
          Assign and track work across the team
        </span>
        <div className="sp" />
        <button className="btn-primary" onClick={() => setAdding(true)}>
          <Icon name="plus" strokeWidth={2.4} />
          Add Task
        </button>
      </div>
      {error ? (
        <ErrorCard error={error} retry={refresh} />
      ) : (
        <div className="card">
          <div className="card-b">
            {!data ? (
              <Loading />
            ) : (
              <>
                {openT.length ? (
                  <>
                    <div className="sec-t" style={{ marginTop: 12 }}>
                      Open <span className="bdg bdg-grey">{openT.length}</span>
                    </div>
                    <TaskRows list={openT} onChange={refresh} onAdd={() => setAdding(true)} />
                  </>
                ) : (
                  <TaskRows list={[]} onChange={refresh} onAdd={() => setAdding(true)} />
                )}
                {doneT.length > 0 && (
                  <>
                    <div className="sec-t" style={{ marginTop: 20 }}>
                      Done <span className="bdg bdg-grey">{doneT.length}</span>
                    </div>
                    <TaskRows list={doneT} onChange={refresh} onAdd={() => setAdding(true)} />
                  </>
                )}
                {gone > 0 && (
                  <div className="hint" style={{ marginTop: 14 }}>
                    {gone} finished task{gone === 1 ? '' : 's'} moved out of the way after {TASK_ARCHIVE_DAYS} days. Nothing was deleted.
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
      <TaskModal open={adding} onClose={() => setAdding(false)} onSaved={refresh} />
    </>
  );
}
