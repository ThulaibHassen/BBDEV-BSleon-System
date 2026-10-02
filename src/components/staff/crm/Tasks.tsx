'use client';

/* Task Book pieces shared by the Tasks page and the dashboard card:
   the Add Task modal, the task rows (toggle, inline edit, delete + undo). */

import { useEffect, useRef, useState } from 'react';
import { del, patch, post } from '@/lib/client/api';
import { todayISO } from '@/lib/shared/dates';
import { Icon } from '../Icon';
import { Empty, Field, Modal, Ok, useToast } from '../ui';
import { useStaff } from '../StaffContext';
import { staffName, type Task } from './types';

type ModalProps = { open: boolean; onClose: () => void; onSaved: () => void };

/* The form mounts fresh on every open, so it always starts blank. */
export function TaskModal(props: ModalProps) {
  return props.open ? <TaskModalForm {...props} /> : null;
}

function TaskModalForm({ open, onClose, onSaved }: ModalProps) {
  const { me, isMaster, config, refreshBadges } = useStaff();
  const { toast, toastError } = useToast();
  const [t, setT] = useState('');
  const [who, setWho] = useState(me.id);
  const [due, setDue] = useState('');
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const k = setTimeout(() => ref.current?.focus(), 60);
    return () => clearTimeout(k);
  }, []);

  const save = async () => {
    if (!t.trim()) {
      setErr(true);
      ref.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await post('/api/staff/tasks', { t: t.trim(), who: isMaster ? who : me.id, due });
      onClose();
      onSaved();
      refreshBadges();
      toast(<Ok>Task added</Ok>);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Add Task"
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save} disabled={busy}>
            Add Task
          </button>
        </>
      }
    >
      <Field label="Task" error={err && 'Please describe the task.'}>
        <input
          ref={ref}
          value={t}
          placeholder="e.g. Follow up on the Sunrise quote"
          onChange={(e) => {
            setT(e.target.value);
            if (err) setErr(false);
          }}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
      </Field>
      <div className="fld-grid2">
        <Field label="Assign to">
          <select value={isMaster ? who : me.id} disabled={!isMaster} onChange={(e) => setWho(+e.target.value)}>
            {config.team
              .filter((s) => s.active)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Due">
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export function TaskRows({ list, onChange, onAdd }: { list: Task[]; onChange: () => void; onAdd: () => void }) {
  const { config, isMaster, me, refreshBadges } = useStaff();
  const { toast, toastUndo, toastError } = useToast();
  const [editing, setEditing] = useState<number | null>(null);
  // tasks with a request in flight: a second tap on Delete would 404 and its error toast
  // would replace the Undo of the first
  const busy = useRef(new Set<number>());
  const today = todayISO();

  const done = () => {
    onChange();
    refreshBadges();
  };

  const toggle = async (tk: Task) => {
    try {
      await patch(`/api/staff/tasks/${tk.id}`, { d: !tk.d });
      done();
      if (!tk.d)
        toastUndo(<Ok>Task done</Ok>, async () => {
          await patch(`/api/staff/tasks/${tk.id}`, { d: false }).then(() => toast(<Ok>Undone</Ok>), toastError);
          done();
        });
    } catch (e) {
      toastError(e);
    }
  };

  const remove = async (tk: Task) => {
    if (busy.current.has(tk.id)) return;
    busy.current.add(tk.id);
    try {
      const { task } = await del<{ task: Task }>(`/api/staff/tasks/${tk.id}`);
      done();
      /* a delete somebody meant to be a complete is the expensive mistake */
      toastUndo(<Ok>Task deleted</Ok>, async () => {
        await post('/api/staff/tasks', { restore: task }).then(() => toast(<Ok>Undone</Ok>), toastError);
        done();
      });
    } catch (e) {
      busy.current.delete(tk.id); // a deleted id never comes back (Undo restores under a new one)
      toastError(e);
    }
  };

  if (!list.length)
    return (
      <Empty
        icon="check"
        title="No tasks"
        sub="Add the first task to get the team moving."
        cta={
          <button className="btn-ghost" onClick={onAdd}>
            Add a task
          </button>
        }
      />
    );

  return (
    <>
      {list.map((tk) =>
        editing === tk.id ? (
          <TaskEditRow
            key={tk.id}
            tk={tk}
            canAssign={isMaster}
            meId={me.id}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              done();
              toast(<Ok>Saved.</Ok>);
            }}
          />
        ) : (
          <div key={tk.id} className={`task${tk.d ? ' done' : ''}`}>
            <button className="cb" aria-label="Toggle task" onClick={() => toggle(tk)}>
              <Icon name="check" />
            </button>
            <div className="tk-main">
              <div className="tk-t">{tk.t}</div>
              <div className="tk-m">
                {staffName(config, tk.who)}
                {tk.due ? ` · ${tk.due}` : ''}
                {tk.dueTime ? ` at ${tk.dueTime}` : ''}
                {tk.d && tk.doneOn ? ` · done ${tk.doneOn}` : ''}
              </div>
              {tk.note && <div className="tk-note">{tk.note}</div>}
            </div>
            {!tk.d && tk.due && tk.due < today && <span className="bdg bdg-action">Overdue</span>}
            <div className="tk-act">
              <button className="btn-ghost" onClick={() => setEditing(tk.id)}>
                Edit
              </button>
              <button className="btn-ghost" onClick={() => remove(tk)}>
                Delete
              </button>
            </div>
          </div>
        ),
      )}
    </>
  );
}

/* Leon's fields, in his order: what to do, who, when, and anything else. */
function TaskEditRow({ tk, canAssign, meId, onCancel, onSaved }: { tk: Task; canAssign: boolean; meId: number; onCancel: () => void; onSaved: () => void }) {
  const { config } = useStaff();
  const { toast, toastError } = useToast();
  const [t, setT] = useState(tk.t);
  const [who, setWho] = useState(tk.who ?? meId);
  const [due, setDue] = useState(tk.due ?? '');
  const [time, setTime] = useState(tk.dueTime ?? '');
  const [note, setNote] = useState(tk.note ?? '');

  const save = async () => {
    if (!t.trim()) {
      toast(
        <>
          <Icon name="warn" /> A task needs to say what to do.
        </>,
      );
      return;
    }
    try {
      await patch(`/api/staff/tasks/${tk.id}`, { t: t.trim(), who: canAssign ? who : meId, due, dueTime: time, note: note.trim() });
      onSaved();
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div className="task task-edit">
      <div className="tk-main" style={{ width: '100%' }}>
        <input className="filter" style={{ width: '100%', marginBottom: 8 }} value={t} placeholder="What needs to be done" onChange={(e) => setT(e.target.value)} />
        <div className="tk-grid">
          <select className="filter" value={who} disabled={!canAssign} onChange={(e) => setWho(+e.target.value)}>
            {config.team
              .filter((x) => x.active || x.id === tk.who)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
          </select>
          <input className="filter" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          <input className="filter" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <input className="filter" style={{ width: '100%', marginTop: 8 }} value={note} placeholder="Notes (optional)" onChange={(e) => setNote(e.target.value)} />
        <div className="tk-act" style={{ marginTop: 10 }}>
          <button className="btn-primary" onClick={save}>
            Save
          </button>
          <button className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
