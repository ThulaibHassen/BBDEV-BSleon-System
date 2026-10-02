'use client';

/* The enquiry detail panel (openRecord): WhatsApp, log activity, edit,
   won / lost with undo, and the enrol hand-off. */

import { useState } from 'react';
import { del, post } from '@/lib/client/api';
import { lkr, waLink } from '@/lib/shared/constants';
import { feedStamp, todayISO } from '@/lib/shared/dates';
import { Icon } from '../Icon';
import { Ok, useToast } from '../ui';
import { useStaff } from '../StaffContext';
import { useDialog } from '../Dialog';
import { fieldLabel, firstName, isOpenStage, stageLabel, staffName, type Enquiry } from './types';

type Props = {
  r: Enquiry;
  onClose: () => void;
  onEdit: () => void;
  onEnrol: () => void;
  onChanged: () => void;
  onOpenStudent: (id: number) => void;
};

export function EnquiryPanel({ r, onClose, onEdit, onEnrol, onChanged, onOpenStudent }: Props) {
  const { config, refreshBadges } = useStaff();
  const { toast, toastUndo, toastError } = useToast();
  const ask = useDialog();
  const [askLost, setAskLost] = useState(false);
  // one won / lost request at a time: a second tap would answer with prev = won / lost and break Undo
  const [busy, setBusy] = useState(false);
  const open = isOpenStage(config, r.stage);
  const due = !!r.followUp && r.followUp <= todayISO() && open;
  const won = config.stages.find((s) => s.k === r.stage)?.terminal === 'won';
  const changed = () => {
    onChanged();
    refreshBadges();
  };

  const wa = async () => {
    const digits = (r.phone || '').replace(/\D/g, '');
    if (!digits) {
      toast(`No phone number on this ${config.entity.singular.toLowerCase()}`);
      return;
    }
    window.open(waLink(r.phone, config.waTemplate.replace('{name}', firstName(r.name))), '_blank', 'noopener');
    try {
      await post(`/api/staff/records/${r.id}/acts`, { t: 'WhatsApp sent', m: 'Template message opened in WhatsApp' });
      changed();
    } catch (e) {
      toastError(e);
    }
  };

  const logAct = async () => {
    const note = await ask.prompt({ title: 'Log activity', label: `Activity for ${r.name}`, placeholder: 'Called, asked about the Saturday batch', okLabel: 'Log', multiline: true, maxLength: 500 });
    if (!note) return;
    try {
      await post(`/api/staff/records/${r.id}/acts`, { t: 'Activity', m: note });
      changed();
      toast(<Ok>Activity logged</Ok>);
    } catch (e) {
      toastError(e);
    }
  };

  const markWon = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const out = await post<{ prev: string; record: Enquiry }>(`/api/staff/records/${r.id}/won`);
      changed();
      /* the undo also takes back the student the win created */
      toastUndo(<>&#127881; {r.name} won</>, async () => {
        try {
          await del(`/api/staff/records/${r.id}/won`, { prev: out.prev });
          toast(<Ok>Undone</Ok>);
        } catch (e) {
          toastError(e);
        }
        changed();
      });
      /* WINNING IS NOT ENROLLING: ask now, while whoever won it is still here */
      if (!out.record.studentId) onEnrol();
      else onClose();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const markLost = async (reason: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const out = await post<{ prev: string }>(`/api/staff/records/${r.id}/lost`, { reason });
      onClose();
      changed();
      toastUndo(`${r.name} marked lost`, async () => {
        await del(`/api/staff/records/${r.id}/lost`, { prev: out.prev }).then(() => toast(<Ok>Undone</Ok>), toastError);
        changed();
      });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="pn-head">
        <button className="pn-close" onClick={onClose} aria-label="Close">
          <Icon name="x" />
        </button>
        <div className="pn-nm">{r.name}</div>
        <div className="pn-co">{r.co || ''}</div>
        <div className="pn-badges">
          <span className="bdg bdg-stage">{stageLabel(config, r.stage)}</span>
          {due && <span className="bdg bdg-action">Follow-up due</span>}
          {r.stage === 'lost' && r.lostReason && <span className="bdg bdg-grey">{r.lostReason}</span>}
          <span className="bdg bdg-grey">{staffName(config, r.owner)}</span>
        </div>
      </div>
      <div className="pn-actions">
        <button className="pa primary" onClick={wa}>
          <Icon name="phone" /> WhatsApp
        </button>
        <button className="pa" onClick={logAct}>
          <Icon name="doc" /> Log activity
        </button>
        <button className="pa" onClick={onEdit}>
          Edit
        </button>
        {open && (
          <>
            <button className="pa" onClick={markWon} disabled={busy}>
              <Icon name="check" /> Mark won
            </button>
            <button className="pa" onClick={() => setAskLost(true)}>
              Mark lost
            </button>
          </>
        )}
        {r.studentId ? (
          <button className="pa" onClick={() => onOpenStudent(r.studentId!)}>
            <Icon name="users" /> Enrolled as {r.studentName ?? 'a student'}
          </button>
        ) : won ? (
          <button className="pa primary" onClick={onEnrol}>
            <Icon name="users" /> Enrol as a student
          </button>
        ) : null}
      </div>
      <div className="pn-body">
        {askLost && (
          <div className="sec">
            <div className="sec-t">Why was it lost?</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {config.lostReasons.map((x) => (
                <button key={x} className="tag" style={{ cursor: 'pointer' }} disabled={busy} onClick={() => markLost(x)}>
                  {x}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="sec">
          <div className="sec-t">Details</div>
          <div className="info-grid">
            <div className="info">
              <div className="il">{fieldLabel(config, 'value')}</div>
              <div className="iv">{r.value ? lkr(r.value) : '-'}</div>
            </div>
            <div className="info">
              <div className="il">{fieldLabel(config, 'phone')}</div>
              <div className="iv">{r.phone || '-'}</div>
            </div>
            <div className="info">
              <div className="il">Created</div>
              <div className="iv">{r.createdOn}</div>
            </div>
            <div className="info">
              <div className="il">{fieldLabel(config, 'followUp')}</div>
              <div className="iv">{r.followUp || '-'}</div>
            </div>
            {r.school && (
              <div className="info">
                <div className="il">School</div>
                <div className="iv">{r.school}</div>
              </div>
            )}
          </div>
        </div>
        <div className="sec">
          <div className="sec-t">Activity</div>
          {r.acts.length ? (
            r.acts.map((a, i) => (
              <div className="act" key={i}>
                <div className="act-ic">&#9679;</div>
                <div className="act-c">
                  <div className="act-s">{a.t}</div>
                  <div className="act-m">
                    {a.m}
                    {a.by ? ` · ${a.by}` : ''}
                  </div>
                </div>
                <div className="act-tm">{a.at && !Number.isNaN(Date.parse(a.at)) ? feedStamp(a.at) : ''}</div>
              </div>
            ))
          ) : (
            <div className="empty">
              <div className="es-ic">
                <Icon name="doc" />
              </div>
              <div className="es-t">No activity yet</div>
              Log the first call or message.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
