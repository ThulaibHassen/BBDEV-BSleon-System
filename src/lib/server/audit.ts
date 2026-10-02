import 'server-only';
import { db, schema } from './db';

/** Append to the staff activity feed (the Activity page). Never throws. */
export async function logActivity(who: number | null, t: string, m = '') {
  try {
    await db().insert(schema.activity).values({ who, t, m: m.slice(0, 500) });
  } catch (e) {
    console.warn('[audit] activity insert failed', e);
  }
}

export function deviceLabel(ua: string | null) {
  if (!ua) return 'Unknown device';
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS/.test(ua)
            ? 'Mac'
            : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${os} · ${br}`;
}

export async function logLogin(i: { realm: string; staffId?: number | null; name: string; role: string; ua: string | null; ip: string; ok: boolean }) {
  try {
    await db()
      .insert(schema.loginAudit)
      .values({ realm: i.realm, staffId: i.staffId ?? null, name: i.name, role: i.role, device: deviceLabel(i.ua), ip: i.ip, ok: i.ok });
  } catch (e) {
    console.warn('[audit] login insert failed', e);
  }
}
