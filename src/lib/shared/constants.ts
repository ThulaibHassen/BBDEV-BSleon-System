/* Per-client configuration — ported verbatim from the original CFG block.
   Anything Leon can change at runtime lives in app_config (studio + config);
   these are the defaults and the locked values. */

export const CFG = {
  app: {
    name: 'BS With Leon',
    client: 'Academy of Business Studies by Leon Fambeck',
    tagline: 'Tuition Operating System',
    version: 'bswl v3 (next)',
  },
  entity: { singular: 'Enquiry', plural: 'Enquiries' },
  contactWord: { singular: 'Student', plural: 'Students' },
  fieldLabels: {
    name: 'Name',
    co: 'Batch / location',
    phone: 'WhatsApp',
    value: 'Enrolment value',
    followUp: 'Follow-up',
    owner: 'Handled by',
    stage: 'Stage',
  },
  currency: 'LKR',
  monthlyTarget: 400000,
  cadence: [30, 60, 90],
  company: {
    name: 'Academy of Business Studies by Leon Fambeck',
    phone: '077 139 6173',
    email: 'hello@bswithleon.lk',
    address: 'Kings Nugegoda · JMC Kiribathgoda · Sasik Gampaha · Residence · Online',
    regNo: '',
  },
  modules: {
    pipeline: true,
    records: true,
    customers: true,
    tasks: true,
    finance: true,
    reports: true,
    team: true,
    activity: true,
    import: true,
    quotes: false,
    recurring: true,
    cohorts: true,
    forecast: false,
    inventory: false,
  } as Record<string, boolean>,
  recurring: {
    label: 'Fee',
    amount: 4000,
    cycle: 'month',
    waRemind:
      'Hi {name}, a friendly reminder that your {month} tuition {label} of {amount} is due in the first week. Please let me know once settled. Thank you! — Leon, Academy of Business Studies',
  },
  cohorts: ['2027 Batch', '2028 Batch'],
  stages: [
    { k: 'new', label: 'Enquiry', color: 'var(--blue)', prob: 10, board: true },
    { k: 'contacted', label: 'Contacted', color: 'var(--amber)', prob: 40, board: true },
    { k: 'quoted', label: 'Trial', color: 'var(--brand)', prob: 70, board: true },
    { k: 'won', label: 'Enrolled', color: 'var(--green)', prob: 100, board: true, terminal: 'won' },
    { k: 'lost', label: 'Not now', color: 'var(--faint)', prob: 0, board: false, terminal: 'lost' },
  ] as { k: string; label: string; color: string; prob: number; board: boolean; terminal?: 'won' | 'lost' }[],
  lostReasons: ['Fee too high', 'Chose another class', 'Timing clash', 'Location too far', 'No response', 'Other'],
  waTemplate:
    'Hi {name}, thank you for your interest in Academy of Business Studies by Leon Fambeck. When would be a good time for a quick chat about the class?',
  /** The A/L exam the student countdown targets (Colombo time). */
  examAt: '2027-08-16T08:00:00+05:30',
};

/** Floor modules can never be switched off in the Studio. */
export const FLOOR_MODULES = ['records', 'customers', 'tasks', 'finance', 'reports', 'team', 'activity'];

export const LOC_LABEL: Record<string, string> = {
  Kings: 'Kings · Nugegoda',
  JMC: 'JMC · Kiribathgoda',
  Sasik: 'Sasik · Gampaha',
  Residence: 'Residence',
  Online: 'Online',
};
export const LOCS = Object.keys(LOC_LABEL);
export const COHORT_SHORT = ['2027', '2028'];
export const BSWL_PROGRAMS = ['Theory', 'Revision', 'Combined'] as const;
export const PROG_LABEL: Record<string, string> = {
  Theory: 'Theory Only',
  Revision: 'Revision Only',
  Combined: 'Theory and Revision',
};
export const locClass = (loc: string) =>
  loc === 'Kings' || loc === 'JMC' || loc === 'Sasik' ? 'inst' : loc === 'Residence' ? 'res' : 'online';

/** Leon's price list. Fee depends only on batch and programme; unknown = null, never guessed. */
export const BSWL_PRICES: Record<string, Partial<Record<string, number>>> = {
  '2027 Batch': { Theory: 2900, Revision: 3200, Combined: 5500 },
  '2028 Batch': { Theory: 3000 }, // Revision and Combined: NOT GIVEN, ask Leon
};

export function bswlFee(program: string, cohort: number | string): number | null {
  const label = typeof cohort === 'number' ? CFG.cohorts[cohort] : cohort;
  const v = BSWL_PRICES[label]?.[program];
  return typeof v === 'number' ? v : null;
}

export const TASK_ARCHIVE_DAYS = 4;

export const lkr = (n: number | null | undefined) =>
  `${CFG.currency} ${Math.round(Number(n) || 0).toLocaleString('en-LK')}`;

export const init2 = (s: string) =>
  s
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

export function stageOf(k: string) {
  return CFG.stages.find((s) => s.k === k) ?? CFG.stages[0];
}

/** wa.me link: digits only, leading 0 → 94 (and 0094… / a bare 9-digit 7… number). */
export function waLink(phone: string, text: string) {
  let d = (phone || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = '94' + d.slice(1);
  else if (d.length === 9 && d.startsWith('7')) d = '94' + d;
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
}

export const SL_PHONE = /^(0\d{9}|(\+?94)\d{9})$/;

/* ── Syllabus: the 8 placeholder units / 31 topics both apps share.
   Topic ids must stay identical between staff and student apps. ── */
export type Unit = { u: string; name: string; topics: [string, string][] };
export const BSWL_SYLLABUS: Unit[] = [
  { u: '1', name: 'The nature of business', topics: [['1.1', 'What a business is and does'], ['1.2', 'Needs, wants and resources'], ['1.3', 'Business objectives'], ['1.4', 'Stakeholders']] },
  { u: '2', name: 'The business environment', topics: [['2.1', 'Internal environment'], ['2.2', 'Micro environment'], ['2.3', 'Macro environment'], ['2.4', 'Environment analysis']] },
  { u: '3', name: 'Forms of business', topics: [['3.1', 'Sole proprietorship'], ['3.2', 'Partnerships'], ['3.3', 'Companies'], ['3.4', 'State and cooperative bodies']] },
  { u: '4', name: 'Management process', topics: [['4.1', 'Planning'], ['4.2', 'Organising'], ['4.3', 'Leading'], ['4.4', 'Controlling']] },
  { u: '5', name: 'Marketing', topics: [['5.1', 'Markets and customers'], ['5.2', 'The marketing mix'], ['5.3', 'Product and price'], ['5.4', 'Promotion and place']] },
  { u: '6', name: 'Human resources', topics: [['6.1', 'HR planning'], ['6.2', 'Recruitment and selection'], ['6.3', 'Training and development'], ['6.4', 'Motivation']] },
  { u: '7', name: 'Operations and finance', topics: [['7.1', 'Operations management'], ['7.2', 'Sources of finance'], ['7.3', 'Financial statements'], ['7.4', 'Ratios and interpretation']] },
  { u: '8', name: 'Business growth', topics: [['8.1', 'Small business and entrepreneurship'], ['8.2', 'Growth strategies'], ['8.3', 'International business']] },
];
export const topicName = (id: string) => {
  for (const u of BSWL_SYLLABUS) for (const [k, n] of u.topics) if (k === id) return n;
  return id;
};
export const topicCount = () => BSWL_SYLLABUS.reduce((n, u) => n + u.topics.length, 0);

/* ── Default student-app configuration (app_config.config) ── */
export const DEFAULT_APP_CONFIG = {
  features: {
    rewards: { on: true, aud: 'all', by: 'Leon', when: '2026-07-01' },
    batchStats: { on: true, aud: 'all', by: 'Leon', when: '2026-07-01' },
    seminars: { on: true, aud: 'all', by: 'Leon', when: '2026-07-01' },
    weeklyPlan: { on: true, aud: 'all', by: 'Leon', when: '2026-07-08' },
    competition: { on: true, aud: 'all', by: 'Leon', when: '2026-07-12' },
  },
  checks: { recheckDays: 42, minBatch: 10, allowNotes: false },
  road: [
    ['Set your goal', 'Lit by signing your commitment', 'leon', 1],
    ['Attend regularly', 'Lights at 90% verified attendance', 'system', 1],
    ['Rate your topics', 'Lights once 8 topics are rated honestly', 'self', 1],
    ['Finish a tute', 'Lights with the first finished tute', 'self', 1],
    ['Log an attempt', 'Lights with the first logged attempt', 'self', 2],
    ['Get one marked by Leon', 'Lights when Leon marks an attempt', 'leon', 2],
    ['Fix a repeated error', 'Lights when an attempt comes back clean', 'self', 2],
    ['Three timed attempts', 'Lights at three timed attempts', 'self', 2],
    ['Clear every Lost topic', 'Lights when nothing is marked Lost', 'self', 2],
    ['Ask before you are stuck', 'Lights the term a question comes early', 'self', 2],
    ['Beat your first score', 'Lights when the latest beats the first', 'self', 3],
    ['Five topics shown', 'Lights at five topics demonstrated', 'system', 3],
    ['Whole syllabus covered', 'Lights when coverage reaches 100%', 'leon', 3],
    ['Sit the exam', 'The outcome, not an app milestone', 'outcome', 3],
  ] as [string, string, string, number][],
  rewardTiers: [
    { t: 'Four in a row', prize: 'BSWL merch', claim: 'Collect from Bihandu at class', state: 'confirmed' },
    { t: 'A term at 90%', prize: 'BSWL t-shirt', claim: 'Handed over at the term test', state: 'confirmed' },
    { t: 'A year at 90%', prize: '10% off at the partner university', claim: 'Written confirmation first', state: 'pending' },
  ],
  support: {
    wa: '077 139 6173',
    hours: 'Weekdays 4 to 8 pm',
    help: 'Forgotten password? Ask Leon or Bihandu at class for a new code. Nothing is lost.',
  },
  oath: {
    text: 'I chose an A. I will turn up, do the work when it is set, fix what I get wrong and ask early when I am stuck.',
    since: '2026-07-01',
    version: 1,
  },
  splash: [
    'One weak topic is easier to fix than five.',
    'Your next useful action is ready.',
    'Read the question twice. Answer it once.',
    'Paper practice shows you what to revise.',
    'Ask before a small gap becomes a large one.',
    'Ten focused minutes count. Start there.',
    'Understanding is quiet. Memorising is loud, and it forgets.',
  ],
  push: {
    on: true,
    max: 2,
    from: 16,
    to: 19,
    kinds: { recording: true, tute: true, checkin: true, topics: true, comeback: true, exam: true },
    examDate: '2027-08-16',
    /** parent fee reminders: day of month (first and follow-up) and the hour, Colombo */
    parent: { on: true, day: 5, day2: 12, hour: 18 },
  },
  /** #3 — exam date and class times per teaching location (shown in both apps). */
  schedule: {
    examDate: '2027-08-16',
    classes: [] as { loc: string; cohort: number | null; day: string; time: string; note?: string }[],
  },
  /** Text pages Leon fills in (#8 glossary, #11 new-student guide, #12 what to expect). */
  pages: {
    glossary: [] as { term: string; def: string; unit?: string }[],
    guide: '',
    expect: { month: '', year: '' },
  },
};
export type AppConfig = typeof DEFAULT_APP_CONFIG;

export const MSG_TYPES: Record<string, string> = {
  class: 'Class notice',
  learning: 'New tute or paper',
  seminar: 'Seminar',
  delivery: 'Courier dispatch',
  payment: 'Payment confirmation',
  general: 'General announcement',
};

export const DOC_KINDS: Record<string, string> = {
  paper: 'Past paper',
  scheme: 'Marking scheme',
  tute: 'Tute',
  mcq: 'MCQ paper',
  target: 'Target paper',
  guide: 'Guide',
  other: 'Other',
};
