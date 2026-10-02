/* The student app's model: the shapes the server sends, and every rule the
   original computed in the browser (coverage, evidence, the recommender,
   rewards, the road, the exam clock). Pure functions, no React, so each
   screen reads the same truth. Ported line by line from student/index.html. */

import { BSWL_SYLLABUS, CFG } from '@/lib/shared/constants';
import { DY_FULL, MN, MN_FULL, todayISO, daysBetween, dPlus, ymNow, ymShift, colomboParts } from '@/lib/shared/dates';

/* ── server shapes ─────────────────────────────────────────────────────── */

export type Me = {
  id: number;
  name: string;
  first: string;
  cohort: number;
  batch: string;
  loc: string;
  locLabel: string;
  program: string;
  joined: string | null;
  level: string;
};
export type Rec = { id: number; date: string; title: string; url: string; mins: number | null; release: string; granted: boolean; missed: boolean; daysLeft: number | null };
export type Attempt = { id: number; date: string; paper: string; q: string; score: number; max: number; timed: boolean; marker: string; err: string };
export type Msg = { id: number; type: string; title: string; body: string; date: string; courier: { co: string; no: string; note?: string } | null; read: boolean; registered: boolean };
export type Weight = { unit: string; band: string; share: number | null; note: string | null };
export type ClassTime = { loc: string; cohort: number | null; day: string; time: string; note?: string };
export type Boot = {
  me: Me;
  serverNow: string;
  attendance: { date: string; present: boolean }[];
  classLog: { date: string; topics: string[] }[];
  conf: Record<string, string>;
  ev: Record<string, { s: string; d: string }>;
  tutes: Record<string, string>;
  tuteAssign: { unit: string; date: string; documentId: number | null }[];
  papers: Attempt[];
  checkins: { month: string; mood: string; blocker: string }[];
  recordings: Rec[];
  recClosed: number;
  inbox: Msg[];
  weights: Weight[];
  config: {
    examDate: string;
    classes: ClassTime[];
    pages: { glossary: { term: string; def: string; unit?: string }[]; guide: string; expect: { month: string; year: string } };
    support: { wa: string; hours: string; help: string };
    splash: string[];
    recheckDays: number;
    minBatch: number;
    rewardTiers: { t: string; prize: string; claim: string; state: string }[];
    features: { rewards: boolean; batchStats: boolean; seminars: boolean; competition: boolean };
  };
  race: { loc: string; pct: number }[];
  honours: { name: string; att: number }[];
  batch: { n: number; tuteRate: number | null; median: number | null };
};

export type McqItem = {
  id: number;
  title: string;
  unit: string | null;
  minutes: number;
  instructions: string | null;
  kind: string;
  mode: string;
  document_id: number | null;
  questions: number;
  finished_at: string | null;
  correct: number | null;
  total: number | null;
  marks: number | null;
  max_marks: number | null;
  seconds: number | null;
  in_progress: boolean;
  open_to: string | null;
};

export type LibDoc = {
  id: number;
  title: string;
  kind: string;
  year: number | null;
  part: string | null;
  lang: string;
  source: string;
  unit: string | null;
  pages: number | null;
  bytes: number;
  hasText: boolean;
  availableUntil: string | null;
  pairId: number | null;
  note: string | null;
};

export type Essay = { id: number; title: string; unit: string | null; marks: number; question: string | null; parts: { h: string; t?: string; m?: number }[]; notes: string | null };

/* ── syllabus ──────────────────────────────────────────────────────────── */

export const SYLLABUS = BSWL_SYLLABUS;
export const flatTopics = () => SYLLABUS.flatMap((u) => u.topics.map((t) => t[0]));
export const tName = (id: string) => {
  for (const u of SYLLABUS) for (const t of u.topics) if (t[0] === id) return t[1];
  return '';
};
export const tUnit = (id: string) => id.split('.')[0];
export const unitName = (u: string) => SYLLABUS.find((x) => x.u === u)?.name ?? '';

/* TEACHING CONTENT. DRAFT, AWAITING LEON'S APPROVAL. Shown with that label,
   because unapproved study material must never pose as the tutor's own. */
export type Lesson = { summary: string; terms: [string, string][]; qs: { q: string; opts: string[]; a: number; why: string }[] };
export const LESSON: Record<string, Lesson> = {
  '4.2': {
    summary: 'Organising turns a plan into a working structure. You decide what jobs exist, who does them, who reports to whom, and how much authority each person holds.',
    terms: [
      ['Organisation structure', 'How roles and reporting lines are arranged.'],
      ['Delegation', 'Passing authority down while keeping responsibility.'],
      ['Span of control', 'How many people report to one manager.'],
    ],
    qs: [
      {
        q: 'Delegation means a manager passes down',
        opts: ['authority, while staying responsible for the result', 'both authority and responsibility, entirely', 'responsibility only, keeping all authority'],
        a: 0,
        why: 'Authority moves down the structure. Responsibility for the outcome stays with the manager who delegated.',
      },
      {
        q: 'A wide span of control usually means',
        opts: ['one manager supervises many people', 'many managers supervise one person', 'fewer levels of delegation'],
        a: 0,
        why: 'Span of control counts direct reports. Wide spans mean flatter structures and looser supervision.',
      },
    ],
  },
  '1.3': {
    summary: 'Objectives are the targets a business sets itself. Good ones are specific and measurable, so the business can tell later whether it actually got there.',
    terms: [
      ['Objective', 'A target the business works towards.'],
      ['Mission', 'Why the business exists.'],
    ],
    qs: [
      {
        q: 'The clearest business objective is',
        opts: ['grow sales by 10% this year', 'do better than last year', 'be the best in the market'],
        a: 0,
        why: 'Specific and measurable. The other two cannot be checked at the end of the year.',
      },
    ],
  },
  '2.3': {
    summary: 'The macro environment is everything outside the firm that it cannot control: the economy, government policy, technology, society and law.',
    terms: [
      ['Macro environment', 'Wide external forces beyond the firm.'],
      ['Micro environment', 'Suppliers, customers and competitors close to the firm.'],
    ],
    qs: [
      {
        q: 'A rise in national interest rates sits in the',
        opts: ['macro environment', 'micro environment', 'internal environment'],
        a: 0,
        why: 'Interest rates are set nationally. No single firm can control them, so they are macro.',
      },
      {
        q: 'A new competitor opening nearby belongs to the',
        opts: ['micro environment', 'macro environment', 'internal environment'],
        a: 0,
        why: 'Competitors sit close to the firm and interact with it directly, so they are micro.',
      },
    ],
  },
  '3.2': {
    summary: 'A partnership is owned by two or more people who share profits as their agreement sets out. In an ordinary partnership the partners carry unlimited liability.',
    terms: [
      ['Partnership deed', 'The agreement setting out shares and duties.'],
      ['Unlimited liability', 'Personal assets are at risk for business debts.'],
    ],
    qs: [
      {
        q: 'In an ordinary partnership, profits are shared',
        opts: ['as the partnership agreement sets out', 'equally, always, by law', 'by the senior partner’s decision'],
        a: 0,
        why: 'The deed decides. Equal sharing applies only when no agreement says otherwise.',
      },
    ],
  },
};
export const hasLesson = (t: string) => !!LESSON[t];

/* ── labels ────────────────────────────────────────────────────────────── */

export const CONF_LABEL: Record<string, string> = { got: 'Got it', shaky: 'Shaky', lost: 'Lost' };
export const EV_TEXT: Record<string, string> = { untested: 'Not checked yet', developing: 'Developing', demonstrated: 'Shown in checks' };
export const TUTE_LABEL: Record<string, string> = { assigned: 'Assigned', started: 'Started', done: 'Done', fix: 'Needs another pass' };
export const IB_TYPES: Record<string, string> = {
  all: 'All',
  class: 'Classes',
  learning: 'Learning',
  seminar: 'Seminars',
  delivery: 'Deliveries',
  payment: 'Payments',
  general: 'General',
};
export const PRIO: Record<string, number> = { class: 1, seminar: 3, learning: 4, delivery: 5, payment: 6, general: 7 };
export const CTA: Record<string, { label: string; go: string } | null> = {
  class: { label: 'View class details', go: 'next' },
  delivery: { label: 'Track package', go: 'courier' },
  seminar: { label: 'Register', go: 'seminar' },
  payment: { label: 'View receipt', go: 'receipt' },
  learning: { label: 'Open papers', go: 'papers' },
  general: null,
};
export const ERRS = ['Knowledge gap', 'Misread question', 'Application', 'Answer structure', 'Terminology', 'Time management', 'Careless'];
export function errAdvice(e: string) {
  return (
    (
      {
        Application: 'Practise linking theory to the case in the question.',
        'Answer structure': 'Plan two lines before writing. Point, reason, example.',
        Terminology: 'Learn the exact words the marking scheme rewards.',
        'Time management': 'Time your next attempt strictly and stop when time is up.',
        'Knowledge gap': 'Go back to the topic before the next attempt.',
        'Misread question': 'Underline the command word before you start.',
        Careless: 'Read your answer once before moving on.',
      } as Record<string, string>
    )[e] || 'Worth another pass.'
  );
}

/* ── dates ─────────────────────────────────────────────────────────────── */

export const fmtD = (iso: string) => {
  const p = iso.slice(0, 10).split('-');
  return `${+p[2]} ${MN[+p[1] - 1]}`;
};
export const fmtFull = (iso: string) => {
  const p = iso.slice(0, 10).split('-');
  return `${+p[2]} ${MN[+p[1] - 1]} ${p[0]}`;
};
export const dowName = (iso: string) => DY_FULL[new Date(iso.slice(0, 10) + 'T00:00:00Z').getUTCDay()];
export const monthName = (ym: string) => MN_FULL[+ym.split('-')[1] - 1];
export const mmss = (s: number) => {
  s = Math.max(0, Math.round(s || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
export const examAt = (b: Boot | undefined) => new Date(`${b?.config.examDate || CFG.examAt.slice(0, 10)}T08:00:00+05:30`).getTime();
export const examDateOf = (b: Boot | undefined) => b?.config.examDate || CFG.examAt.slice(0, 10);

/* ── derived truths ────────────────────────────────────────────────────── */

/** A model the screens read: the server's boot plus this phone's own self-check results. */
export type Model = Boot & { evAll: Record<string, { s: string; d: string }>; progressTask: FlowState | null };

export type FlowState = { topic: string; kind: string; step: number; answers: ({ pick: number; locked: boolean } | null)[] };

export function covered(m: Boot) {
  const o: Record<string, string> = {};
  for (const r of m.classLog) for (const t of r.topics) o[t] = r.date;
  return o;
}
export const coveredCount = (m: Boot) => Object.keys(covered(m)).length;
export const evOf = (m: Model, t: string) => m.evAll[t]?.s || 'untested';
export const evDate = (m: Model, t: string) => m.evAll[t]?.d;
export const evStale = (m: Model, t: string) => {
  const e = m.evAll[t];
  return !!(e && e.d && e.s === 'demonstrated' && daysBetween(e.d, todayISO()) > (m.config.recheckDays || 42));
};
export const shownCount = (m: Model) => Object.keys(covered(m)).filter((t) => evOf(m, t) === 'demonstrated').length;
export const missed = (m: Boot) => m.attendance.filter((a) => !a.present).map((a) => a.date);
export const attRate = (m: Boot) => (m.attendance.length ? m.attendance.filter((a) => a.present).length / m.attendance.length : 0);
export const lastClass = (m: Boot) => m.classLog[m.classLog.length - 1];

export function phaseHint(m: Boot) {
  const d = daysBetween(todayISO(), examDateOf(m));
  if (d > 300) return 'Build foundations before timed papers';
  if (d > 150) return 'Topic questions and answer technique';
  if (d > 90) return 'Timed sections and error repair';
  if (d > 21) return 'Full papers and pacing';
  return 'Focused revision';
}

/** #3: the next class at this student's location, from Leon's class times. */
export function nextClass(m: Boot) {
  const today = todayISO();
  const list = m.config.classes.length ? m.config.classes : [{ loc: m.me.loc, cohort: null, day: 'Saturday', time: '' }];
  let best: { date: string; c: ClassTime } | null = null;
  for (const c of list) {
    const dow = DY_FULL.indexOf(c.day);
    if (dow < 0) continue;
    for (let i = 1; i <= 7; i++) {
      const d = dPlus(today, i);
      if (new Date(d + 'T00:00:00Z').getUTCDay() === dow) {
        if (!best || d < best.date) best = { date: d, c };
        break;
      }
    }
  }
  return best;
}

export type RecItem = {
  p: number;
  kind: 'recording' | 'catchup' | 'recheck' | 'papers' | 'tute';
  topic?: string;
  rec?: number;
  unit?: string;
  mins: number;
  title: string;
  why: string;
  days?: number | null;
};

/* THE RECOMMENDATION ENGINE. Deterministic. Every item carries a reason, a
   duration and a start action that opens the real task. Lower p wins. */
export function recommend(m: Model): RecItem[] {
  const out: RecItem[] = [];
  const cov = covered(m);
  const miss = missed(m);
  for (const r of m.classLog) {
    if (!miss.includes(r.date)) continue;
    for (const t of r.topics) {
      if (evOf(m, t) === 'demonstrated') continue;
      out.push({ p: 1, kind: 'catchup', topic: t, mins: hasLesson(t) ? 9 : 6, title: 'Catch up: ' + tName(t), why: 'You missed ' + dowName(r.date) + '’s lesson' });
    }
  }
  for (const t of Object.keys(m.conf)) {
    if (m.conf[t] === 'got' && evOf(m, t) === 'developing')
      out.push({ p: 2, kind: 'recheck', topic: t, mins: 4, title: tName(t) + ' needs another look', why: 'Your last check found a gap' });
  }
  const e: Record<string, number> = {};
  for (const p of m.papers) if (p.err) e[p.err] = (e[p.err] || 0) + 1;
  const top = Object.keys(e).sort((a, b) => e[b] - e[a])[0];
  if (top && e[top] >= 2)
    out.push({
      p: 3,
      kind: 'papers',
      mins: 12,
      title: top.toLowerCase() === 'application' ? 'Practise application' : 'Practise ' + top.toLowerCase(),
      why: top + ' cost you marks in ' + e[top] + ' attempts',
    });
  for (const t of Object.keys(m.conf)) {
    if (m.conf[t] === 'lost' && cov[t]) out.push({ p: 4, kind: 'catchup', topic: t, mins: hasLesson(t) ? 9 : 6, title: 'Rebuild: ' + tName(t), why: 'You marked this Lost' });
  }
  /* A class you missed, with the recording still open, beats every other
     suggestion: it is the one gap that grows if you leave it. */
  for (const r of m.recordings) {
    if (r.release !== 'absent') continue;
    const dl = r.daysLeft;
    out.push({
      p: 0,
      kind: 'recording',
      rec: r.id,
      mins: r.mins ?? 0,
      title: 'Watch: ' + r.title,
      why: 'You missed this class' + (dl === null ? '' : ', ' + dl + ' day' + (dl === 1 ? '' : 's') + ' left to watch it'),
      days: dl,
    });
  }
  for (const u of Object.keys(m.tutes)) {
    const s = m.tutes[u];
    if (s === 'started') out.push({ p: 5, kind: 'tute', unit: u, mins: 20, title: 'Finish the Unit ' + u + ' tute', why: 'Started, not finished' });
    else if (s === 'assigned') out.push({ p: 6, kind: 'tute', unit: u, mins: 25, title: 'Start the Unit ' + u + ' tute', why: 'Assigned for ' + unitName(u).toLowerCase() });
  }
  for (const t of Object.keys(m.evAll)) {
    if (evStale(m, t)) out.push({ p: 7, kind: 'recheck', topic: t, mins: 3, title: 'Recheck ' + tName(t), why: 'Not checked since ' + fmtD(evDate(m, t)!) });
  }
  out.push({ p: 9, kind: 'papers', mins: 15, title: 'Try a timed question', why: phaseHint(m) });
  out.sort((a, b) => a.p - b.p);
  const recovery = out.filter((x) => x.p <= 7).slice(0, 3);
  return recovery.concat(out.filter((x) => x.p === 9)).slice(0, 4);
}

export const KIND_LABEL: Record<string, string> = { recording: 'Missed class', catchup: 'Catch up', recheck: 'Quick check', tute: 'Tute', papers: 'Practice' };

export function unitClass(topic?: string) {
  if (typeof topic !== 'string' || !topic) return '';
  const u = parseInt(tUnit(topic), 10);
  if (!u || isNaN(u)) return '';
  return 'spined u' + (((u - 1) % 6) + 1);
}

/* ── the exam clock ────────────────────────────────────────────────────── */

export function examLeft(at: number) {
  let ms = at - Date.now();
  if (ms < 0) ms = 0;
  return { d: Math.floor(ms / 864e5), h: Math.floor(ms / 36e5) % 24, m: Math.floor(ms / 6e4) % 60 };
}
export function examBand(m: Boot | undefined) {
  const t = examLeft(examAt(m));
  const dISO = todayISO();
  const ex = examDateOf(m);
  if (dISO > ex) return 'past';
  if (dISO === ex) return 'today';
  if (t.d < 1) return 'hours';
  if (t.d <= 14) return 'close';
  return 'far';
}

/* ── the monthly check-in ──────────────────────────────────────────────── */

export function checkinDue(m: Boot) {
  const day = colomboParts().d;
  const cur = ymNow();
  const prev = ymShift(cur, -1);
  const have = new Set(m.checkins.map((c) => c.month));
  if (!have.has(prev)) return prev;
  if (day >= 25 && !have.has(cur)) return cur;
  return null;
}

/* ── papers ────────────────────────────────────────────────────────────── */

export const comparable = (m: Boot, p: { max: number; timed: boolean }) => m.papers.filter((x) => x.max === p.max && x.timed === p.timed);

export function paperTrend(m: Boot) {
  const groups: Record<string, Attempt[]> = {};
  for (const p of m.papers) (groups[p.max + '|' + (p.timed ? 'timed' : 'untimed')] ||= []).push(p);
  let best: Attempt[] = [];
  for (const k of Object.keys(groups)) if (groups[k].length > best.length) best = groups[k];
  return best.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
}

export function paperInsights(m: Boot) {
  const out: { t: string; s: string }[] = [];
  const e: Record<string, number> = {};
  for (const p of m.papers) if (p.err) e[p.err] = (e[p.err] || 0) + 1;
  const top = Object.keys(e).sort((a, b) => e[b] - e[a])[0];
  if (top && e[top] >= 2) out.push({ t: top + ' is your most repeated issue', s: 'In ' + e[top] + ' of ' + m.papers.length + ' attempts' });
  const timed = m.papers.filter((p) => p.timed && p.max === 20);
  if (timed.length >= 3) {
    const last3 = timed.slice(-3);
    const up = last3[2].score > last3[0].score;
    out.push({ t: up ? 'Your timed answers are improving' : 'Timed scores have held steady', s: last3.map((p) => p.score).join(' then ') + ' out of 20' });
  }
  const recent = m.papers.slice(-2);
  if (recent.length === 2 && recent.every((p) => p.err !== 'Terminology')) out.push({ t: 'No terminology slips recently', s: 'Last two attempts were clean on that' });
  return out;
}

/* ── rewards and the road ──────────────────────────────────────────────── */

export function rewards(m: Boot) {
  const att = attRate(m);
  const last4 = m.attendance.slice(-4).filter((a) => a.present).length;
  const tiers = m.config.rewardTiers || [];
  const tier = (i: number, t: string, sub: string) => ({ t: tiers[i]?.t || t, sub: tiers[i]?.prize || sub, pendingCfg: tiers[i]?.state === 'pending' });
  return [
    {
      ...tier(0, 'Four in a row', 'BSWL merch'),
      have: last4,
      need: 4,
      unit: 'classes',
      pct: false,
      done: last4 >= 4,
      pending: false,
      rule: 'Counts your last four classes. A missed week rolls out of the window.',
    },
    {
      ...tier(1, 'A term at 90%', 'BSWL t-shirt'),
      have: Math.round(att * 100),
      need: 90,
      unit: '',
      pct: true,
      done: att >= 0.9 && m.attendance.length >= 10,
      pending: false,
      rule: 'Verified attendance across the term, checked when you claim.',
    },
    {
      ...tier(2, 'A year at 90%', '10% off at the partner university'),
      have: m.attendance.length,
      need: 40,
      unit: 'classes',
      pct: false,
      done: false,
      pending: true,
      rule: 'Planned benefit, pending confirmation. Do not count on it yet.',
    },
  ].map((r) => ({ ...r, pending: r.pending || r.pendingCfg }));
}

export function milestones(m: Model): [string, boolean, string][] {
  const att = attRate(m);
  const tutesDone = Object.keys(m.tutes).filter((k) => m.tutes[k] === 'done').length;
  const timed = m.papers.filter((p) => p.timed).length;
  const p = m.papers;
  return [
    ['Set your goal', true, 'tutor'],
    ['Attend regularly', att >= 0.9, 'verified'],
    ['Rate your topics', Object.keys(m.conf).length >= 8, 'self'],
    ['Finish a tute', tutesDone >= 1, 'self'],
    ['Log an attempt', p.length >= 1, 'self'],
    ['Get one marked by Leon', p.some((x) => x.marker !== 'self'), 'tutor'],
    ['Fix a repeated error', p.some((x) => !x.err), 'self'],
    ['Three timed attempts', timed >= 3, 'self'],
    ['Clear every Lost topic', !Object.keys(m.conf).some((k) => m.conf[k] === 'lost'), 'self'],
    ['Ask before you are stuck', false, 'self'],
    ['Beat your first score', p.length > 1 && p[p.length - 1].score / p[p.length - 1].max > p[0].score / p[0].max, 'self'],
    ['Five topics shown', shownCount(m) >= 5, 'verified'],
    ['Whole syllabus covered', coveredCount(m) === flatTopics().length, 'tutor'],
    ['Sit the exam', false, 'outcome'],
  ];
}

/* ── #14 where the class is ────────────────────────────────────────────── */

export function tracker(m: Boot) {
  const cov = covered(m);
  const units = SYLLABUS.map((u) => ({ u: u.u, name: u.name, total: u.topics.length, n: u.topics.filter((t) => cov[t[0]]).length }));
  const done = units.filter((u) => u.n === u.total);
  const ongoing = units.filter((u) => u.n > 0 && u.n < u.total);
  const lastTouched = Math.max(0, ...units.filter((u) => u.n > 0).map((u) => +u.u));
  const upNext = units.find((u) => u.n === 0 && +u.u > lastTouched) ?? units.find((u) => u.n === 0) ?? null;
  return { done, ongoing, upNext };
}

/* ── misc ──────────────────────────────────────────────────────────────── */

export const ordinal = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : n + 'th');

export function closingText(iso: string, nowMs = Date.now()) {
  const d = new Date(iso).getTime();
  if (isNaN(d)) return '';
  const days = Math.ceil((d - nowMs) / 86400000);
  if (days < 0) return 'closed';
  if (days === 0) return 'closes today';
  if (days === 1) return 'closes tomorrow';
  return 'closes in ' + days + ' days';
}

/** "Closes in 1 day 4 hours" style countdown for #6 target papers. */
export function untilText(iso: string, nowMs = Date.now()) {
  const ms = new Date(iso).getTime() - nowMs;
  if (ms <= 0) return 'Closed';
  const h = Math.floor(ms / 36e5);
  const mi = Math.floor(ms / 6e4) % 60;
  if (h >= 48) return `Open for ${Math.floor(h / 24)} more days`;
  if (h >= 1) return `${h} hour${h === 1 ? '' : 's'} left`;
  return `${mi} minute${mi === 1 ? '' : 's'} left`;
}

export function splashLine(lines: string[]) {
  const p = todayISO().split('-');
  const n = +p[0] * 372 + +p[1] * 31 + +p[2];
  return lines[n % lines.length];
}
