/* Dates — one source of truth for "today".

   The original app used the device clock with no timezone, which is right
   only while every user sits in Sri Lanka. Here "today", month boundaries
   and stamps are pinned to Asia/Colombo (UTC+05:30, no DST) on both the
   server and the client. */

export const TZ = 'Asia/Colombo';

export const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MN_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Wall-clock parts in Colombo for an instant. */
export function colomboParts(d: Date = new Date()) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(d)) p[x.type] = x.value;
  return {
    y: +p.year,
    m: +p.month,
    d: +p.day,
    h: +p.hour % 24,
    min: +p.minute,
    s: +p.second,
    dow: DY.indexOf(p.weekday),
  };
}

export function todayISO(d: Date = new Date()) {
  const p = colomboParts(d);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

export const ymNow = () => todayISO().slice(0, 7);

export function dPlus(iso: string, n: number) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function daysBetween(a: string, b: string) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

export function ymShift(ym: string, n: number) {
  const [y, m] = ym.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`;
}

export const monthLbl = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return `${MN_FULL[m - 1]} ${y}`;
};
export const monthShort = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return `${MN[m - 1]} ${String(y).slice(2)}`;
};

export const greetWord = (h: number) => (h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');

/** '15 Jul' */
export function fmtDate(iso?: string | null) {
  if (!iso) return '-';
  const [, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MN[m - 1]}`;
}

/** '15 Jul 2026' */
export function fmtDateLong(iso?: string | null) {
  if (!iso) return '-';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MN[m - 1]} ${y}`;
}

/** '9:41 AM' for an instant, in Colombo time */
export function fmtTime(d: Date | string) {
  const p = colomboParts(typeof d === 'string' ? new Date(d) : d);
  const h12 = p.h % 12 || 12;
  return `${h12}:${pad(p.min)} ${p.h < 12 ? 'AM' : 'PM'}`;
}

/** '15 Jul, 9:41 AM' */
export function feedStamp(d: Date | string = new Date()) {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return `${fmtDate(todayISO(dt))}, ${fmtTime(dt)}`;
}

/** Colombo wall time 'YYYY-MM-DD HH:MM' → real instant. */
export function colomboToDate(local: string) {
  const [date, time = '00:00'] = local.trim().split(/[ T]/);
  const [h = '0', m = '0'] = time.split(':'); // '9:05' is as good as '09:05'
  return new Date(`${date}T${h.padStart(2, '0')}:${m.slice(0, 2).padStart(2, '0')}:00+05:30`);
}

/** instant → 'YYYY-MM-DD HH:MM' in Colombo */
export function dateToColombo(d: Date | string) {
  const p = colomboParts(typeof d === 'string' ? new Date(d) : d);
  return `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.h)}:${pad(p.min)}`;
}

export function relTime(d: Date | string) {
  const t = typeof d === 'string' ? new Date(d) : d;
  const s = Math.round((Date.now() - t.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return `${Math.floor(s / (86400 * 30))}mo ago`;
}
