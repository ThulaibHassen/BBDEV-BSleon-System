/* Role-based access control — the single source of truth.

   Shared by the server (every API route checks a permission) and the client
   (the sidebar hides what a role cannot open). The client copy is a
   convenience only: the server check is the one that counts.

   Staff roles follow the original rank owner > manager > staff.
   Students and parents are separate realms with their own small sets. */

export type StaffRole = 'owner' | 'manager' | 'staff';
export type Realm = 'staff' | 'student' | 'parent';
export type Role = StaffRole | 'student' | 'parent';

export const ROLE_RANK: Record<StaffRole, number> = { staff: 0, manager: 1, owner: 2 };

export const PERMISSIONS = [
  // overview
  'dashboard.view',
  'reports.view',
  // enquiries (records) — staff see only their own
  'enquiries.view.own',
  'enquiries.view.all',
  'enquiries.write',
  // students
  'students.view.own',
  'students.view.all',
  'students.write',
  'students.delete',
  // tasks
  'tasks.view.own',
  'tasks.view.all',
  'tasks.write',
  // teaching
  'classes.manage', // attendance, class log, recordings, tute assignment
  'messages.send',
  'papers.manage', // live quiz sets, MCQ papers, drills, essays
  'library.manage', // upload / publish PDFs (past papers, schemes, tutes)
  'media.upload', // images (MCQ pictures)
  'app.manage', // student-app control: logins, codes, content, weights, reminders
  'parents.manage',
  // money
  'fees.manage',
  'invoices.manage',
  // manage
  'team.view',
  'team.manage', // add users, change roles — owner only
  'activity.view',
  'settings.manage', // Customize studio — owner only
  // other realms
  'student.self',
  'parent.self',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const STAFF_BASE: Permission[] = [
  'dashboard.view',
  'enquiries.view.own',
  'enquiries.write',
  'students.view.own',
  'tasks.view.own',
  'tasks.write',
];

const MANAGER: Permission[] = [
  ...STAFF_BASE,
  'reports.view',
  'enquiries.view.all',
  'students.view.all',
  'students.write',
  'students.delete',
  'tasks.view.all',
  'classes.manage',
  'messages.send',
  'papers.manage',
  'library.manage',
  'media.upload',
  'app.manage',
  'parents.manage',
  'fees.manage',
  'invoices.manage',
  'team.view',
  'activity.view',
];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  staff: new Set(STAFF_BASE),
  manager: new Set(MANAGER),
  owner: new Set([...MANAGER, 'team.manage', 'settings.manage']),
  student: new Set(['student.self']),
  parent: new Set(['parent.self']),
};

export function can(role: Role | null | undefined, perm: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.has(perm) ?? false;
}

export function roleLabel(r: StaffRole) {
  return r === 'owner' ? 'Owner' : r === 'manager' ? 'Manager' : 'Sales';
}

/* ── Staff navigation: page → permission + module flag (original nav matrix) ── */

export type NavItem = {
  id: string;
  label: string;
  group: 'overview' | 'work' | 'money' | 'manage';
  perm: Permission;
  module?: string;
  icon: string;
  badge?: 'records' | 'tasks' | 'rec' | 'inventory';
};

export const NAV_GROUPS: Record<NavItem['group'], string> = {
  overview: 'Overview',
  work: 'Daily',
  money: 'Money',
  manage: 'Manage',
};

export const STAFF_NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', group: 'overview', perm: 'dashboard.view', icon: 'grid' },
  { id: 'reports', label: 'Reports', group: 'overview', perm: 'reports.view', module: 'reports', icon: 'chart' },
  { id: 'records', label: 'Enquiries', group: 'work', perm: 'enquiries.view.own', module: 'records', icon: 'inbox', badge: 'records' },
  { id: 'customers', label: 'Students', group: 'work', perm: 'students.view.own', module: 'customers', icon: 'users' },
  { id: 'classes', label: 'Class', group: 'work', perm: 'classes.manage', icon: 'calendar', badge: 'rec' },
  { id: 'messages', label: 'Messages', group: 'work', perm: 'messages.send', icon: 'send' },
  { id: 'library', label: 'Library', group: 'work', perm: 'library.manage', icon: 'book' },
  { id: 'quizzes', label: 'Papers', group: 'work', perm: 'papers.manage', icon: 'file' },
  { id: 'app', label: 'Student app', group: 'work', perm: 'app.manage', icon: 'phone' },
  { id: 'tasks', label: 'Task Book', group: 'work', perm: 'tasks.view.own', module: 'tasks', icon: 'check', badge: 'tasks' },
  { id: 'recurring', label: 'Fees', group: 'money', perm: 'fees.manage', module: 'recurring', icon: 'wallet' },
  { id: 'finance', label: 'Invoices', group: 'money', perm: 'invoices.manage', module: 'finance', icon: 'receipt' },
  { id: 'team', label: 'Team', group: 'manage', perm: 'team.view', module: 'team', icon: 'team' },
  { id: 'activity', label: 'Activity', group: 'manage', perm: 'activity.view', module: 'activity', icon: 'pulse' },
  { id: 'settings', label: 'Settings', group: 'manage', perm: 'settings.manage', icon: 'settings' },
];

export const PAGE_TITLES: Record<string, [string, string]> = {
  dashboard: ['Dashboard', 'Today at a glance'],
  reports: ['Reports', 'Month-over-month performance'],
  records: ['Enquiries', 'Every enquiry from first message to enrolled'],
  customers: ['Students', 'Enrolled students, batches and referrals'],
  tasks: ['Task Book', 'Assign and track work'],
  classes: ['Class', 'One class: who came, what you taught, the recording'],
  messages: ['Messages', 'Send updates to the student app'],
  library: ['Library', 'Past papers, marking schemes and tutes — upload once, students read in the app'],
  quizzes: ['Papers', 'MCQ papers, speed drills, essay templates and the live class quiz'],
  app: ['Student app', 'Logins and settings, run by your team'],
  finance: ['Finance', 'Fee invoices, collections and aging'],
  recurring: ['Fee collection', 'Who paid, collected vs expected, who owes'],
  team: ['Team', 'Performance per person'],
  activity: ['Activity', 'System activity and sign-ins'],
  settings: ['Customize', 'Make this system yours'],
};
