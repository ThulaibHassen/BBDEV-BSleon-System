/* ═══ BS With Leon — database schema (PostgreSQL, Drizzle) ═══════════════════

   STORE 1 of 3. This database holds user data and the INDEX of every file.
   The files themselves live in the two object-storage buckets:
     documents  (PDFs)   → table `documents` holds title/year/audience + storage_key
     media      (images) → table `media` holds key/mime/size
   No file bytes are ever stored in Postgres.

   Mirrors the original Supabase tables (bswl_*), with the gaps the old client
   silently dropped now stored properly (enquiry batch/programme/student link,
   task done-date/time/note, studio overrides, timestamptz everywhere).

   Rule zero carried over: answer keys (quiz_questions.answer, mcq_questions.answer
   and .why) are never selected by a student route except after submit/reveal. */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  serial,
  integer,
  smallint,
  bigserial,

  text,
  boolean,
  date,
  timestamp,
  jsonb,
  uuid,
  primaryKey,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const created = () => ts('created_at').notNull().defaultNow();
const updated = () => ts('updated_at').notNull().defaultNow();
const day = (name: string) => date(name, { mode: 'string' });

/* ─── identity ───────────────────────────────────────────────────────── */

export const staff = pgTable(
  'staff',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(), // stored lower-case
    passwordHash: text('password_hash'),
    role: text('role').notNull().default('staff'), // owner | manager | staff
    active: boolean('active').notNull().default(true),
    mustChangePassword: boolean('must_change_password').notNull().default(true),
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: ts('locked_until'),
    lastLoginAt: ts('last_login_at'),
    createdAt: created(),
  },
  (t) => [uniqueIndex('staff_email_uq').on(t.email), check('staff_role_ck', sql`${t.role} in ('owner','manager','staff')`)],
);

/** One row per refresh token. Rotated on use; a family is revoked together. */
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').primaryKey(),
    familyId: uuid('family_id').notNull(),
    realm: text('realm').notNull(), // staff | student | parent
    principalId: integer('principal_id').notNull(),
    role: text('role').notNull(),
    name: text('name').notNull(),
    childStudentId: integer('child_student_id'),
    refreshHash: text('refresh_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    replacedBy: uuid('replaced_by'),
    lastUsedAt: ts('last_used_at'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex('auth_sessions_refresh_uq').on(t.refreshHash),
    index('auth_sessions_principal').on(t.realm, t.principalId),
    index('auth_sessions_family').on(t.familyId),
  ],
);

/* ─── students and the fee ledger ────────────────────────────────────── */

export const students = pgTable(
  'students',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    phone: text('phone').notNull().default(''),
    email: text('email').notNull().default(''),
    program: text('program').notNull().default('Theory'), // Theory | Revision | Combined
    cohort: smallint('cohort').notNull().default(0), // 0 = 2027 Batch, 1 = 2028 Batch
    loc: text('loc').notNull().default('Kings'), // Kings | JMC | Sasik | Residence | Online
    co: text('co').notNull().default(''), // display label, e.g. "Kings · Nugegoda"
    joined: day('joined'),
    status: text('status').notNull().default('active'), // active | alumni
    level: text('level').notNull().default('okay'), // good | okay | bad — Leon's read
    fee: integer('fee'), // LKR / month; null = no price on Leon's list
    owner: integer('owner').references(() => staff.id, { onDelete: 'set null' }),
    lastSeen: day('last_seen'),
    sent: integer('sent').notNull().default(0), // referral cadence steps sent (0–3)
    snooze: day('snooze'),
    school: text('school'),
    note: text('note'), // Leon's private note on the student panel
    history: jsonb('history').$type<{ item: string; cat: string; date: string; value: number }[]>().notNull().default([]),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index('students_cohort').on(t.cohort, t.status), index('students_owner').on(t.owner)],
);

/** Fee arrangement — id is the student's id (one plan per student). */
export const recurringPlans = pgTable('recurring_plans', {
  id: integer('id')
    .primaryKey()
    .references(() => students.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  phone: text('phone').notNull().default(''),
  cohort: smallint('cohort').notNull().default(0),
  program: text('program').notNull().default('Theory'),
  loc: text('loc').notNull().default('Kings'),
  fee: integer('fee'),
  joined: day('joined'),
  status: text('status').notNull().default('active'),
});

export const recurringPayments = pgTable(
  'recurring_payments',
  {
    id: serial('id').primaryKey(),
    planId: integer('plan_id')
      .notNull()
      .references(() => recurringPlans.id, { onDelete: 'cascade' }),
    month: text('month').notNull(), // billing month 'YYYY-MM'
    amount: integer('amount').notNull(),
    status: text('status').notNull().default('paid'), // paid | partial
    paidAt: day('paid_at'),
    method: text('method').notNull().default('Cash'),
    receiptNo: text('receipt_no'),
    recordedBy: integer('recorded_by').references(() => staff.id, { onDelete: 'set null' }),
    createdAt: created(),
  },
  (t) => [index('recurring_payments_plan_month').on(t.planId, t.month), index('recurring_payments_month').on(t.month)],
);

export const invoices = pgTable('invoices', {
  id: serial('id').primaryKey(),
  ref: text('ref').notNull(),
  studentId: integer('student_id').references(() => students.id, { onDelete: 'set null' }),
  cust: text('cust').notNull(),
  date: day('date').notNull(),
  amount: integer('amount').notNull(),
  paid: integer('paid').notNull().default(0),
  due: day('due'),
  method: text('method').notNull().default('-'),
  createdAt: created(),
});

/* ─── enquiries, tasks, activity ─────────────────────────────────────── */

export const records = pgTable(
  'records',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    co: text('co').notNull().default(''),
    phone: text('phone').notNull().default(''),
    stage: text('stage').notNull().default('new'), // new | contacted | quoted | won | lost
    owner: integer('owner').references(() => staff.id, { onDelete: 'set null' }),
    value: integer('value'),
    followUp: day('follow_up'),
    createdOn: day('created_on').notNull(),
    lostReason: text('lost_reason'),
    rev: jsonb('rev').$type<Record<string, number> | null>(),
    acts: jsonb('acts').$type<{ t: string; m: string; at: string; by?: string }[]>().notNull().default([]),
    // fields the old client set but never saved
    batch: smallint('batch'),
    prog: text('prog'),
    school: text('school'),
    studentId: integer('student_id').references(() => students.id, { onDelete: 'set null' }),
    extRef: text('ext_ref'), // website enquiry reference — imported once
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index('records_owner_stage').on(t.owner, t.stage), uniqueIndex('records_ext_ref_uq').on(t.extRef)],
);

export const tasks = pgTable('tasks', {
  id: serial('id').primaryKey(),
  t: text('t').notNull(),
  who: integer('who').references(() => staff.id, { onDelete: 'set null' }),
  due: day('due'),
  dueTime: text('due_time'),
  note: text('note'),
  d: boolean('d').notNull().default(false),
  doneOn: day('done_on'),
  createdBy: integer('created_by').references(() => staff.id, { onDelete: 'set null' }),
  createdAt: created(),
});

export const activity = pgTable(
  'activity',
  {
    id: serial('id').primaryKey(),
    who: integer('who').references(() => staff.id, { onDelete: 'set null' }),
    t: text('t').notNull(),
    m: text('m').notNull().default(''),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('activity_at').on(t.at)],
);

export const loginAudit = pgTable(
  'login_audit',
  {
    id: serial('id').primaryKey(),
    realm: text('realm').notNull().default('staff'),
    staffId: integer('staff_id'),
    name: text('name').notNull(),
    role: text('role').notNull(),
    device: text('device').notNull().default(''),
    ip: text('ip'),
    ok: boolean('ok').notNull().default(true),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('login_audit_at').on(t.at)],
);

export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  code: text('code'),
  details: text('details'),
  price: integer('price').notNull().default(0),
  qty: integer('qty').notNull().default(0),
  threshold: integer('threshold').notNull().default(5),
  photoMediaId: integer('photo_media_id'),
  lastSold: day('last_sold'),
});

/** Single row (id = 1): the student-app configuration plus the Studio overrides. */
export const appConfig = pgTable('app_config', {
  id: integer('id').primaryKey().default(1),
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  studio: jsonb('studio').$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: updated(),
});

/* ─── student & parent app accounts ──────────────────────────────────── */

export const appLogins = pgTable(
  'app_logins',
  {
    id: serial('id').primaryKey(),
    studentId: integer('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    username: text('username').notNull(),
    status: text('status').notNull().default('never'), // active | never | locked
    lastActive: day('last_active'),
    sessions: integer('sessions').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    codeHash: text('code_hash'),
    codeExpires: ts('code_expires'),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex('app_logins_student_uq').on(t.studentId),
    uniqueIndex('app_logins_username_uq').on(sql`lower(${t.username})`),
    check('app_logins_status_ck', sql`${t.status} in ('active','never','locked')`),
  ],
);

export const parentLogins = pgTable(
  'parent_logins',
  {
    id: serial('id').primaryKey(),
    studentId: integer('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    label: text('label').notNull().default('Parent'), // Mother | Father | Guardian | Parent
    codeHash: text('code_hash'),
    codeExpires: ts('code_expires'),
    status: text('status').notNull().default('active'), // active | locked
    active: boolean('active').notNull().default(true),
    lastActive: day('last_active'),
    sessions: integer('sessions').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    createdAt: created(),
  },
  (t) => [index('parent_logins_student').on(t.studentId)],
);

/* ─── class: attendance, topics, tutes, recordings ───────────────────── */

export const attendance = pgTable(
  'attendance',
  {
    id: serial('id').primaryKey(),
    studentId: integer('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    date: day('date').notNull(),
    present: boolean('present').notNull(),
    markedBy: integer('marked_by'),
  },
  (t) => [uniqueIndex('attendance_student_date_uq').on(t.studentId, t.date), index('attendance_date').on(t.date)],
);

export const classLog = pgTable(
  'class_log',
  {
    id: serial('id').primaryKey(),
    date: day('date').notNull(),
    cohort: smallint('cohort').notNull(),
    topics: text('topics').array().notNull().default(sql`'{}'::text[]`),
  },
  (t) => [uniqueIndex('class_log_date_cohort_uq').on(t.date, t.cohort)],
);

/** A tute set for a batch on a date. */
export const tuteAssign = pgTable(
  'tute_assign',
  {
    unit: text('unit').notNull(),
    cohort: smallint('cohort').notNull(),
    date: day('date').notNull(),
    by: text('by').notNull().default(''),
    documentId: integer('document_id'), // optional: the tute PDF in the library
  },
  (t) => [primaryKey({ columns: [t.unit, t.cohort, t.date] })],
);

/** A student's own progress on each unit's tute. */
export const tutes = pgTable(
  'tutes',
  {
    studentId: integer('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    unit: text('unit').notNull(),
    state: text('state').notNull().default('assigned'), // assigned | started | done | fix
    updatedAt: updated(),
  },
  (t) => [primaryKey({ columns: [t.studentId, t.unit] })],
);

/** A student's own past-paper attempt log (self-marked or marked by Leon). */
export const paperAttempts = pgTable(
  'paper_attempts',
  {
    id: serial('id').primaryKey(),
    studentId: integer('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    date: day('date').notNull(),
    paper: text('paper').notNull(),
    q: text('q').notNull().default(''),
    score: integer('score').notNull().default(0),
    max: integer('max').notNull().default(0),
    timed: boolean('timed').notNull().default(false),
    marker: text('marker').notNull().default('self'),
    err: text('err'),
    createdAt: created(),
  },
  (t) => [index('paper_attempts_student').on(t.studentId, t.date)],
);

export const topicChecks = pgTable(
  'topic_checks',
  {
    studentId: integer('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // conf (student self-rating) | ev (evidence Leon recorded)
    topic: text('topic').notNull(),
    state: text('state').notNull(), // conf: got|shaky|lost · ev: untested|developing|demonstrated
    checkedAt: day('checked_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.studentId, t.kind, t.topic] })],
);

export const checkins = pgTable(
  'checkins',
  {
    studentId: integer('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    month: text('month').notNull(),
    mood: text('mood').notNull(), // steady | heavy | struggling
    blocker: text('blocker').notNull().default('none'), // none | time | topics | motivation | personal
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.studentId, t.month] })],
);

export const recordings = pgTable(
  'recordings',
  {
    id: serial('id').primaryKey(),
    date: day('date').notNull(),
    cohort: smallint('cohort').notNull(),
    loc: text('loc').notNull().default(''),
    title: text('title').notNull(),
    url: text('url').notNull(),
    mins: integer('mins'),
    addedBy: text('added_by').notNull().default(''),
    addedOn: day('added_on').notNull(),
    release: text('release').notNull().default('absent'), // absent | batch | picked
    windowDays: integer('window_days').notNull().default(14), // 0 = no limit
    grants: integer('grants').array().notNull().default(sql`'{}'::int[]`),
    revoked: integer('revoked').array().notNull().default(sql`'{}'::int[]`),
    views: integer('views').notNull().default(0),
  },
  (t) => [index('recordings_cohort_date').on(t.cohort, t.date)],
);

export const recordingViews = pgTable(
  'recording_views',
  {
    recordingId: integer('recording_id')
      .notNull()
      .references(() => recordings.id, { onDelete: 'cascade' }),
    studentId: integer('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    viewedAt: ts('viewed_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.recordingId, t.studentId] })],
);

/* ─── messages ───────────────────────────────────────────────────────── */

export const messages = pgTable(
  'messages',
  {
    id: serial('id').primaryKey(),
    type: text('type').notNull(), // class | learning | seminar | delivery | payment | general
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    aud: text('aud').notNull(), // audience code: all | c0 | c1 | loc:Kings | mode:online | prog:Theory | student:<id>
    audLabel: text('aud_label').notNull().default(''),
    sentAt: ts('sent_at'),
    schedFor: ts('sched_for'),
    by: integer('by').references(() => staff.id, { onDelete: 'set null' }),
    sent: integer('sent').notNull().default(0),
    opened: integer('opened').notNull().default(0),
    registered: integer('registered'),
    status: text('status').notNull().default('sent'), // sent | scheduled
    courier: jsonb('courier').$type<{ co: string; no: string; note?: string } | null>(),
    createdAt: created(),
  },
  (t) => [index('messages_status').on(t.status, t.schedFor)],
);

export const messageRecipients = pgTable(
  'message_recipients',
  {
    messageId: integer('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    studentId: integer('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    readAt: ts('read_at'),
    registeredAt: ts('registered_at'),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.studentId] }), index('message_recipients_student').on(t.studentId)],
);

/* ─── push ───────────────────────────────────────────────────────────── */

export const pushSubs = pgTable(
  'push_subs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    audience: text('audience').notNull().default('student'), // student | parent
    studentId: integer('student_id').references(() => students.id, { onDelete: 'cascade' }),
    parentId: integer('parent_id').references(() => parentLogins.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    ua: text('ua'),
    createdAt: created(),
    lastOk: ts('last_ok'),
    fails: integer('fails').notNull().default(0),
  },
  (t) => [uniqueIndex('push_subs_endpoint_uq').on(t.endpoint), index('push_subs_student').on(t.studentId), index('push_subs_parent').on(t.parentId)],
);

export const pushLog = pgTable(
  'push_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    studentId: integer('student_id').notNull(), // for parent rows: the CHILD's id
    audience: text('audience').notNull().default('student'),
    kind: text('kind').notNull(), // recording | tute | checkin | exam | topics | comeback | fee | test
    ref: text('ref'),
    title: text('title'),
    body: text('body'),
    devices: integer('devices').notNull().default(0),
    delivered: integer('delivered').notNull().default(0),
    test: boolean('test').notNull().default(false),
    sentAt: ts('sent_at').notNull().defaultNow(),
  },
  (t) => [index('push_log_student_day').on(t.studentId, t.sentAt)],
);

/* ─── live class quiz (Kahoot-style) ─────────────────────────────────── */

export const quizzes = pgTable('quizzes', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  unit: text('unit'),
  cohort: smallint('cohort'),
  note: text('note'),
  published: boolean('published').notNull().default(false),
  createdBy: integer('created_by'),
  createdAt: created(),
  updatedAt: updated(),
});

export const quizQuestions = pgTable(
  'quiz_questions',
  {
    id: serial('id').primaryKey(),
    quizId: integer('quiz_id')
      .notNull()
      .references(() => quizzes.id, { onDelete: 'cascade' }),
    ord: integer('ord').notNull().default(1),
    q: text('q').notNull(),
    imageMediaId: integer('image_media_id'),
    opts: text('opts').array().notNull(),
    optImages: integer('opt_images').array(), // parallel to opts, null = text only
    answer: smallint('answer').notNull(),
    seconds: integer('seconds').notNull().default(20),
    pointsX: smallint('points_x').notNull().default(1),
    why: text('why'),
  },
  (t) => [index('quiz_questions_ord').on(t.quizId, t.ord)],
);

export const quizGames = pgTable(
  'quiz_games',
  {
    id: serial('id').primaryKey(),
    quizId: integer('quiz_id')
      .notNull()
      .references(() => quizzes.id, { onDelete: 'cascade' }),
    pin: text('pin').notNull(),
    hostStaff: integer('host_staff'),
    cohort: smallint('cohort'),
    state: text('state').notNull().default('lobby'), // lobby | question | reveal | ended
    qIndex: integer('q_index').notNull().default(-1),
    qStartedAt: ts('q_started_at'),
    createdAt: created(),
    endedAt: ts('ended_at'),
  },
  (t) => [uniqueIndex('quiz_games_pin_uq').on(t.pin), index('quiz_games_state').on(t.state, t.createdAt)],
);

export const quizPlayers = pgTable(
  'quiz_players',
  {
    gameId: integer('game_id')
      .notNull()
      .references(() => quizGames.id, { onDelete: 'cascade' }),
    studentId: integer('student_id').notNull(),
    nickname: text('nickname').notNull(),
    avatar: text('avatar').notNull().default('bulb'),
    score: integer('score').notNull().default(0),
    streak: integer('streak').notNull().default(0),
    bestStreak: integer('best_streak').notNull().default(0),
    joinedAt: ts('joined_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.studentId] })],
);

export const quizAnswers = pgTable(
  'quiz_answers',
  {
    gameId: integer('game_id')
      .notNull()
      .references(() => quizGames.id, { onDelete: 'cascade' }),
    questionId: integer('question_id')
      .notNull()
      .references(() => quizQuestions.id, { onDelete: 'cascade' }),
    studentId: integer('student_id').notNull(),
    choice: smallint('choice').notNull(),
    ms: integer('ms').notNull(),
    correct: boolean('correct').notNull(),
    points: integer('points').notNull(),
    answeredAt: ts('answered_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.questionId, t.studentId] })],
);

/* ─── MCQ papers & speed drills ──────────────────────────────────────── */

export const mcqPapers = pgTable(
  'mcq_papers',
  {
    id: serial('id').primaryKey(),
    title: text('title').notNull(),
    kind: text('kind').notNull().default('paper'), // paper | drill
    // 'questions' = typed in the editor · 'pdf' = the questions are a PDF from
    // the library and the student answers on an in-app bubble sheet
    mode: text('mode').notNull().default('questions'),
    documentId: integer('document_id'),
    unit: text('unit'),
    cohort: smallint('cohort'),
    minutes: integer('minutes').notNull().default(15),
    instructions: text('instructions'),
    published: boolean('published').notNull().default(false),
    shuffle: boolean('shuffle').notNull().default(false),
    openFrom: ts('open_from'),
    openTo: ts('open_to'),
    createdBy: integer('created_by'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    check('mcq_papers_kind_ck', sql`${t.kind} in ('paper','drill')`),
    check('mcq_papers_mode_ck', sql`${t.mode} in ('questions','pdf')`),
  ],
);

export const mcqQuestions = pgTable(
  'mcq_questions',
  {
    id: serial('id').primaryKey(),
    paperId: integer('paper_id')
      .notNull()
      .references(() => mcqPapers.id, { onDelete: 'cascade' }),
    ord: integer('ord').notNull().default(1),
    q: text('q').notNull(),
    imageMediaId: integer('image_media_id'),
    opts: text('opts').array().notNull(),
    // one media id per option (parallel to opts, null = text only); an option may be a picture alone
    optImages: integer('opt_images').array(),
    answer: smallint('answer').notNull(),
    why: text('why'),
    marks: integer('marks').notNull().default(1),
  },
  (t) => [index('mcq_questions_ord').on(t.paperId, t.ord)],
);

export const mcqAttempts = pgTable(
  'mcq_attempts',
  {
    id: serial('id').primaryKey(),
    paperId: integer('paper_id')
      .notNull()
      .references(() => mcqPapers.id, { onDelete: 'cascade' }),
    studentId: integer('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    startedAt: ts('started_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
    seconds: integer('seconds'),
    correct: integer('correct').notNull().default(0),
    total: integer('total').notNull().default(0),
    marks: integer('marks').notNull().default(0),
    maxMarks: integer('max_marks').notNull().default(0),
    answers: jsonb('answers').$type<Record<string, number>>().notNull().default({}),
    late: boolean('late').notNull().default(false),
  },
  (t) => [uniqueIndex('mcq_attempts_one_uq').on(t.paperId, t.studentId), index('mcq_attempts_student').on(t.studentId)],
);

/* ─── teaching aids ──────────────────────────────────────────────────── */

export const essayTemplates = pgTable('essay_templates', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  unit: text('unit'),
  cohort: smallint('cohort'),
  marks: smallint('marks').notNull().default(15),
  question: text('question'),
  parts: jsonb('parts').$type<{ h: string; t?: string; m?: number }[]>().notNull().default([]),
  notes: text('notes'),
  published: boolean('published').notNull().default(false),
  createdBy: integer('created_by'),
  createdAt: created(),
  updatedAt: updated(),
});

export const unitWeights = pgTable(
  'unit_weights',
  {
    unit: text('unit').primaryKey(),
    band: text('band').notNull().default('medium'),
    share: smallint('share'),
    note: text('note'),
    published: boolean('published').notNull().default(false),
    updatedAt: updated(),
  },
  (t) => [
    check('unit_weights_band_ck', sql`${t.band} in ('high','medium','low')`),
    check('unit_weights_share_ck', sql`${t.share} is null or (${t.share} between 0 and 100)`),
  ],
);

export const chapters = pgTable('chapters', {
  ch: text('ch').primaryKey(),
  name: text('name').notNull(),
  shortName: text('short_name'),
  sort: smallint('sort').notNull(),
  createdAt: created(),
});

/* ─── STORE 2 index: documents (PDFs in the "documents" bucket) ──────── */

export const documents = pgTable(
  'documents',
  {
    id: serial('id').primaryKey(),
    title: text('title').notNull(),
    // paper = past paper · scheme = marking scheme · tute · mcq = MCQ paper PDF
    // target = 48-hour target paper · guide · other
    kind: text('kind').notNull().default('paper'),
    year: smallint('year'),
    part: text('part'), // free text typed by staff: 'I', 'II', 'MCQ', 'Structured' …
    lang: text('lang').notNull().default('en'), // free text; en | si | ta are the usual
    source: text('source').notNull().default('orig'), // free text; orig (state paper scan) | leon (typed by Leon) are the usual
    unit: text('unit'),
    cohort: smallint('cohort'), // null = every batch
    audience: text('audience').notNull().default('students'), // public | students | staff
    published: boolean('published').notNull().default(false),
    // optional viewing window — #6 "48-hour target papers" sets both
    availableFrom: ts('available_from'),
    availableUntil: ts('available_until'),
    pairId: integer('pair_id'), // a paper's marking scheme (and back)
    storageKey: text('storage_key').notNull(),
    originalName: text('original_name'),
    bytes: integer('bytes').notNull().default(0),
    pages: smallint('pages'),
    hasText: boolean('has_text').notNull().default(false),
    sha256: text('sha256').notNull(),
    note: text('note'),
    createdBy: integer('created_by').references(() => staff.id, { onDelete: 'set null' }),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    uniqueIndex('documents_storage_key_uq').on(t.storageKey),
    // the same PDF twice is refused in code; this closes the race of two uploads at once
    uniqueIndex('documents_sha256_uq').on(t.sha256),
    index('documents_list').on(t.published, t.kind, t.year),
    check('documents_kind_ck', sql`${t.kind} in ('paper','scheme','tute','mcq','target','guide','other')`),
    check('documents_audience_ck', sql`${t.audience} in ('public','students','staff')`),
  ],
);

/** One row per ticket issued — who opened what, when. */
export const documentLog = pgTable(
  'document_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    documentId: integer('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    studentId: integer('student_id'),
    staffId: integer('staff_id'),
    asStaff: boolean('as_staff').notNull().default(false),
    issuedAt: ts('issued_at').notNull().defaultNow(),
  },
  (t) => [index('document_log_doc').on(t.documentId, t.issuedAt), index('document_log_student').on(t.studentId, t.issuedAt)],
);

/* ─── STORE 3 index: media (images in the "media" bucket) ────────────── */

export const media = pgTable(
  'media',
  {
    id: serial('id').primaryKey(),
    storageKey: text('storage_key').notNull(),
    mime: text('mime').notNull(),
    bytes: integer('bytes').notNull(),
    purpose: text('purpose').notNull().default('mcq'), // mcq | quiz | product | brand
    sha256: text('sha256').notNull(),
    createdBy: integer('created_by').references(() => staff.id, { onDelete: 'set null' }),
    createdAt: created(),
  },
  (t) => [uniqueIndex('media_storage_key_uq').on(t.storageKey)],
);
