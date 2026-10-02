/* Small client helpers shared by the Class, Messages and Student app pages. */

import { DY_FULL } from '@/lib/shared/dates';

export const pl = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** wa.me number: digits only, a leading 0 becomes 94. Empty when there is no number. */
export const waNum = (phone: string | null | undefined) => String(phone || '').replace(/\D/g, '').replace(/^0/, '94');

export function openWa(phone: string | null | undefined, text?: string) {
  const n = waNum(phone);
  if (!n) return false;
  window.open(`https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ''}`, '_blank', 'noopener');
  return true;
}

/** 'Saturday' for an ISO date (no timezone drift: the date is a calendar day). */
export function weekday(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return DY_FULL[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** '4:00 pm' */
export const hr = (h: number) => `${h % 12 || 12}:00 ${h < 12 ? 'am' : 'pm'}`;

export const first = (name: string) => name.trim().split(/\s+/)[0] || name;
