import 'server-only';
import { cookies, headers } from 'next/headers';
import { and, eq, isNull, gt, ne } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db, schema } from './db';
import { env, isProd } from './env';
import {
  signAccess,
  verifyAccess,
  newRefreshToken,
  hashRefresh,
  cookieNames,
  type AccessClaims,
} from './tokens';
import { can, type Permission, type Realm, type Role } from '@/lib/shared/rbac';

/* ═══ Sessions ═══════════════════════════════════════════════════════════
   Login  → auth_sessions row (refresh hash, family id) + access JWT cookie
            + refresh cookie (path /api/auth, SameSite=Strict).
   Refresh → the presented refresh token is looked up by hash. If it is live
            it is ROTATED (row revoked, a new row in the same family). If it
            was already rotated, someone replayed a stolen token: the whole
            family is revoked and the user must sign in again.
   Logout → the row is revoked; cookies cleared.
   Every access token carries `sid`; requireAuth() re-checks that the session
   is still live (cached 30 s) so "sign out everywhere" and a deactivated
   staff member take effect within half a minute, not fifteen. */

export type Principal = AccessClaims & { id: number };

function refreshDays(realm: Realm) {
  return realm === 'staff' ? env().STAFF_REFRESH_DAYS : env().STUDENT_REFRESH_DAYS;
}

async function setAuthCookies(realm: Realm, access: string, refresh?: string) {
  const jar = await cookies();
  const n = cookieNames(realm);
  const secure = isProd();
  jar.set(n.access, access, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: env().ACCESS_TOKEN_TTL,
  });
  if (!refresh) return;
  jar.set(n.refresh, refresh, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: refreshDays(realm) * 86400,
  });
}

export async function clearAuthCookies(realm: Realm) {
  const jar = await cookies();
  const n = cookieNames(realm);
  jar.set(n.access, '', { path: '/', maxAge: 0 });
  jar.set(n.refresh, '', { path: '/api/auth', maxAge: 0 });
}

type SessionInput = {
  realm: Realm;
  principalId: number;
  role: Role;
  name: string;
  childStudentId?: number;
  ip?: string;
  userAgent?: string;
};

/** Create a session and set the cookies. Returns the access token too (for Bearer clients). */
export async function startSession(i: SessionInput) {
  const refresh = newRefreshToken();
  const id = randomUUID();
  const expires = new Date(Date.now() + refreshDays(i.realm) * 86400_000);
  await db().insert(schema.authSessions).values({
    id,
    familyId: id,
    realm: i.realm,
    principalId: i.principalId,
    role: i.role,
    name: i.name,
    childStudentId: i.childStudentId ?? null,
    refreshHash: hashRefresh(refresh),
    expiresAt: expires,
    ip: i.ip ?? null,
    userAgent: i.userAgent?.slice(0, 300) ?? null,
  });
  const access = await signAccess({
    sub: String(i.principalId),
    realm: i.realm,
    role: i.role,
    sid: id,
    name: i.name,
    sidOf: i.childStudentId,
  });
  await setAuthCookies(i.realm, access, refresh);
  return { access, expiresIn: env().ACCESS_TOKEN_TTL };
}

/* Two tabs (or a tab and the login page's silent refresh) often refresh at
   the same moment with the same cookie. Only one may rotate it; the other
   must not be mistaken for a thief. A token rotated less than GRACE_MS ago
   is answered with a fresh access token for its successor (the refresh
   cookie the winner set is left alone). Older replays still burn the family. */
const GRACE_MS = 30_000;

/** Rotate the refresh token. Returns null when the session is gone (sign in again). */
export async function refreshSession(realm: Realm) {
  const jar = await cookies();
  const token = jar.get(cookieNames(realm).refresh)?.value;
  if (!token) return null;
  const h = hashRefresh(token);
  const d = db();
  const [row] = await d.select().from(schema.authSessions).where(eq(schema.authSessions.refreshHash, h)).limit(1);
  if (!row || row.realm !== realm) return null;

  if (row.revokedAt) return rotatedAlready(realm, row);
  if (row.expiresAt < new Date()) {
    await clearAuthCookies(realm);
    return null;
  }

  // the principal must still be allowed in (staff deactivated, login locked …)
  const live = await principalStillActive(realm, row.principalId);
  if (!live) {
    await d.update(schema.authSessions).set({ revokedAt: new Date() }).where(eq(schema.authSessions.id, row.id));
    await clearAuthCookies(realm);
    return null;
  }

  const next = newRefreshToken();
  const nextId = randomUUID();
  const won = await d.transaction(async (tx) => {
    // claim the row first: of two concurrent refreshes exactly one gets it
    const claimed = await tx
      .update(schema.authSessions)
      .set({ revokedAt: new Date(), replacedBy: nextId, lastUsedAt: new Date() })
      .where(and(eq(schema.authSessions.id, row.id), isNull(schema.authSessions.revokedAt)))
      .returning({ id: schema.authSessions.id });
    if (!claimed.length) return false;
    await tx.insert(schema.authSessions).values({
      id: nextId,
      familyId: row.familyId,
      realm,
      principalId: row.principalId,
      role: live.role ?? row.role,
      name: live.name ?? row.name,
      childStudentId: row.childStudentId,
      refreshHash: hashRefresh(next),
      expiresAt: row.expiresAt, // the family never outlives the original login
      ip: row.ip,
      userAgent: row.userAgent,
    });
    return true;
  });
  if (!won) {
    const [now] = await d.select().from(schema.authSessions).where(eq(schema.authSessions.id, row.id)).limit(1);
    return now ? rotatedAlready(realm, now) : null;
  }
  const access = await signAccess({
    sub: String(row.principalId),
    realm,
    role: (live.role ?? row.role) as Role,
    sid: nextId,
    name: live.name ?? row.name,
    sidOf: row.childStudentId ?? undefined,
  });
  await setAuthCookies(realm, access, next);
  return { access, expiresIn: env().ACCESS_TOKEN_TTL };
}

type SessionRow = typeof schema.authSessions.$inferSelect;

/** The presented refresh token is no longer live: a sibling refresh, a logout, or a replay. */
async function rotatedAlready(realm: Realm, row: SessionRow) {
  const d = db();
  if (row.replacedBy && row.revokedAt && Date.now() - row.revokedAt.getTime() < GRACE_MS) {
    const [succ] = await d
      .select()
      .from(schema.authSessions)
      .where(and(eq(schema.authSessions.id, row.replacedBy), isNull(schema.authSessions.revokedAt), gt(schema.authSessions.expiresAt, new Date())))
      .limit(1);
    if (succ) {
      const access = await signAccess({
        sub: String(succ.principalId),
        realm,
        role: succ.role as Role,
        sid: succ.id,
        name: succ.name,
        sidOf: succ.childStudentId ?? undefined,
      });
      await setAuthCookies(realm, access);
      return { access, expiresIn: env().ACCESS_TOKEN_TTL };
    }
    // successor gone too (logout / family revoked): fall through
  } else if (row.replacedBy) {
    // replay of a rotated token: burn the whole family
    await d
      .update(schema.authSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.authSessions.familyId, row.familyId), isNull(schema.authSessions.revokedAt)));
    liveCache().clear();
  }
  // Leave the cookies alone: a sibling tab may already hold a newer pair in
  // the same jar. A stale refresh cookie simply fails again next time.
  return null;
}

/** Sign out: revoke the session family found by the access token or, when that
    has already expired, by the refresh cookie (sent here: both live under /api/auth). */
export async function endSession(realm: Realm) {
  const p = await getPrincipal(realm);
  let family = p ? ((await familyOf(p.sid)) ?? p.sid) : undefined;
  if (!family) {
    const rt = (await cookies()).get(cookieNames(realm).refresh)?.value;
    if (rt) {
      const [r] = await db()
        .select({ f: schema.authSessions.familyId, realm: schema.authSessions.realm })
        .from(schema.authSessions)
        .where(eq(schema.authSessions.refreshHash, hashRefresh(rt)))
        .limit(1);
      if (r && r.realm === realm) family = r.f;
    }
  }
  if (family) {
    await db()
      .update(schema.authSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.authSessions.familyId, family), isNull(schema.authSessions.revokedAt)));
    liveCache().clear();
  }
  await clearAuthCookies(realm);
}

async function familyOf(sid: string) {
  const [r] = await db()
    .select({ f: schema.authSessions.familyId })
    .from(schema.authSessions)
    .where(eq(schema.authSessions.id, sid))
    .limit(1);
  return r?.f;
}

/** Revoke every session of a principal (lock a login, deactivate staff, reset code).
    `keep` spares one session — the caller's own, after a password change. */
export async function revokeAllFor(realm: Realm, principalId: number, keep?: string) {
  await db()
    .update(schema.authSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.authSessions.realm, realm),
        eq(schema.authSessions.principalId, principalId),
        isNull(schema.authSessions.revokedAt),
        keep ? ne(schema.authSessions.id, keep) : undefined,
      ),
    );
  liveCache().clear();
}

async function principalStillActive(realm: Realm, id: number): Promise<{ role?: Role; name?: string } | null> {
  const d = db();
  if (realm === 'staff') {
    const [s] = await d.select().from(schema.staff).where(eq(schema.staff.id, id)).limit(1);
    return s && s.active ? { role: s.role as Role, name: s.name } : null;
  }
  if (realm === 'student') {
    const [l] = await d.select().from(schema.appLogins).where(eq(schema.appLogins.studentId, id)).limit(1);
    if (!l || l.status === 'locked') return null;
    const [st] = await d.select({ name: schema.students.name }).from(schema.students).where(eq(schema.students.id, id)).limit(1);
    return st ? { role: 'student', name: st.name } : null;
  }
  const [p] = await d.select().from(schema.parentLogins).where(eq(schema.parentLogins.id, id)).limit(1);
  return p && p.active && p.status !== 'locked' ? { role: 'parent', name: p.label } : null;
}

/* ── reading the caller ─────────────────────────────────────────────── */

/* sid → checked-at ms. Parked on globalThis so every route bundle shares one
   map (revokeAllFor must clear the map requireAuth reads). Other server
   processes notice a revocation within the 30 s window. */
const gl = globalThis as unknown as { __bswlLive?: Map<string, number> };
const liveCache = () => (gl.__bswlLive ??= new Map());

async function sessionLive(sid: string) {
  const at = liveCache().get(sid);
  if (at && Date.now() - at < 30_000) return true;
  const [r] = await db()
    .select({ id: schema.authSessions.id })
    .from(schema.authSessions)
    .where(and(eq(schema.authSessions.id, sid), isNull(schema.authSessions.revokedAt), gt(schema.authSessions.expiresAt, new Date())))
    .limit(1);
  if (r) {
    if (liveCache().size > 5000) liveCache().clear();
    liveCache().set(sid, Date.now());
    return true;
  }
  return false;
}

export async function getPrincipal(realm: Realm): Promise<Principal | null> {
  const h = await headers();
  let token = h.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) token = (await cookies()).get(cookieNames(realm).access)?.value;
  if (!token) return null;
  const c = await verifyAccess(token, realm);
  if (!c) return null;
  if (!(await sessionLive(c.sid))) return null;
  return { ...c, id: Number(c.sub) };
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export async function requireAuth(realm: Realm, perm?: Permission): Promise<Principal> {
  const p = await getPrincipal(realm);
  if (!p) throw new HttpError(401, 'Your session has ended. Please sign in again.', 'unauthenticated');
  if (perm && !can(p.role, perm)) throw new HttpError(403, 'You do not have access to that.', 'forbidden');
  return p;
}

export const requireStaff = (perm?: Permission) => requireAuth('staff', perm);
export const requireStudent = () => requireAuth('student', 'student.self');
export const requireParent = () => requireAuth('parent', 'parent.self');
