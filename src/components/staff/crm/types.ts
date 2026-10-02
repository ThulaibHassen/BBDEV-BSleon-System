/* Client shapes of the CRM API (src/server/crm.ts) and the small helpers
   every CRM page shares. */

import { CFG } from '@/lib/shared/constants';
import type { StaffConfig } from '../StaffContext';

export type Act = { t: string; m: string; at: string; by?: string };

export type Enquiry = {
  id: number;
  name: string;
  co: string;
  phone: string;
  stage: string;
  owner: number | null;
  value: number | null;
  followUp: string | null;
  createdOn: string;
  lostReason: string | null;
  acts: Act[];
  batch: number | null;
  prog: string | null;
  school: string | null;
  studentId: number | null;
  studentName?: string | null;
};

export type Task = {
  id: number;
  t: string;
  who: number | null;
  due: string | null;
  dueTime: string | null;
  note: string | null;
  d: boolean;
  doneOn: string | null;
  createdBy: number | null;
};

export type StudentRow = {
  id: number;
  name: string;
  phone: string;
  co: string;
  cohort: number;
  program: string;
  loc: string;
  status: string;
  level: string;
  owner: number | null;
  sent: number;
  snooze: string | null;
  last: string | null;
  joined: string | null;
  ltv: number;
  payments: number;
  first: string | null;
  plan: { phone: string; monthsOwed: number; owed: number } | null;
};

export type StudentDetail = {
  id: number;
  name: string;
  phone: string;
  email: string;
  co: string;
  cohort: number;
  program: string;
  loc: string;
  status: string;
  level: string;
  owner: number | null;
  sent: number;
  snooze: string | null;
  last: string | null;
  joined: string | null;
  school: string | null;
  note: string;
  fee: number | null;
  feeEffective: number | null;
  hasPlan: boolean;
  history: { item: string; date: string; value: number }[];
  ltv: number;
  paidCount: number;
  attendance: { total: number; present: number; total30: number; present30: number; last: string | null };
  appLogin: string | null;
  enquiry: { id: number; name: string } | null;
};

export const cohortLabel = (i: number | null | undefined) => CFG.cohorts[Number(i)] ?? `Group ${(Number(i) || 0) + 1}`;

export const firstName = (s: string) => String(s || '').split(' ')[0];

export function staffName(cfg: StaffConfig, id: number | null | undefined) {
  return cfg.team.find((t) => t.id === id)?.name ?? '-';
}

/** A field's label as renamed in Customize (Vocabulary), falling back to the default. */
export function fieldLabel(cfg: StaffConfig, k: keyof typeof CFG.fieldLabels) {
  return cfg.fieldLabels?.[k] || CFG.fieldLabels[k];
}

export function stageLabel(cfg: StaffConfig, k: string) {
  return cfg.stages.find((s) => s.k === k)?.label ?? k;
}

export const isOpenStage = (cfg: StaffConfig, k: string) => !cfg.stages.find((s) => s.k === k)?.terminal;

export function standing(level: string | null | undefined) {
  if (level === 'good') return { key: 'good', label: 'Strong' };
  if (level === 'bad') return { key: 'bad', label: 'Needs work' };
  return { key: 'okay', label: 'Okay' };
}

/* referral cadence (cadDays / cadLabel / custNext from the original) */
export const cadDays = (cfg: StaffConfig, i: number) => cfg.cadence?.[i] || [30, 60, 90][i];
export const cadLabel = (cfg: StaffConfig, i: number) => `${cadDays(cfg, i)}-day ${['check-in', 're-engage', 'offer'][i]}`;
