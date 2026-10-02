/* Response shapes of the teaching APIs, as the client sees them (JSON). */

import type { classContext, listRecordings, recordingPreview } from '@/server/classes';

export type ClassCtx = Awaited<ReturnType<typeof classContext>>;
export type RecList = Awaited<ReturnType<typeof listRecordings>> & { preview: Awaited<ReturnType<typeof recordingPreview>> };
export type RecRow = RecList['rows'][number];

export type MsgRow = {
  id: number;
  type: string;
  title: string;
  body: string;
  aud: string;
  status: string;
  sentAt: string | null;
  schedFor: string | null;
  courier: { co: string; no: string; note?: string } | null;
  sent: number;
  opened: number;
  registered: number | null;
};
export type MsgPage = {
  kpis: { sentThisMonth: number; scheduled: number; readRate: number | null };
  messages: MsgRow[];
  rsvps: { seminar: string; student: string; batch: string }[];
  counts: Record<string, number>;
};

export type LoginRow = {
  id: number;
  studentId: number;
  username: string;
  status: 'active' | 'never' | 'locked';
  lastActive: string | null;
  sessions: number;
  failed: number;
  name: string;
  co: string;
  program: string;
  cohort: number;
  phone: string;
  quietDays: number | null;
};
export type AccessData = {
  stats: { roster: number; signingIn: number; never: number; noAccount: number; locked: number; logins: number };
  quiet: LoginRow[];
  logins: LoginRow[];
  withoutLogin: { id: number; name: string; co: string }[];
  active: { id: number; name: string }[];
};
export type ParentRow = {
  id: number;
  studentId: number;
  child: string;
  label: string;
  status: string;
  active: boolean;
  lastActive: string | null;
  sessions: number;
  codeExpires: string | null;
};
export type CodeCard =
  | { kind: 'student'; name: string; username: string; code: string; expiresAt: string }
  | { kind: 'parent'; label: string; child: string; code: string; expiresAt: string };
