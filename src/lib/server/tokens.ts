import 'server-only';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from './env';
import type { Realm, Role } from '@/lib/shared/rbac';

/* Access tokens: short-lived HS256 JWTs, carried in an httpOnly cookie per
   realm (or an Authorization: Bearer header for API clients).
   Refresh tokens: opaque 256-bit randoms; only their peppered SHA-256 is
   stored (auth_sessions.refresh_hash), rotated on every use. */

export type AccessClaims = {
  sub: string; // principal id (staff.id / student.id / parent_login.id)
  realm: Realm;
  role: Role;
  sid: string; // auth_sessions.id
  name: string;
  sidOf?: number; // parent → child student id
};

const ISSUER = 'bswl';
const enc = () => new TextEncoder().encode(env().JWT_ACCESS_SECRET);

export async function signAccess(c: AccessClaims): Promise<string> {
  return new SignJWT({ realm: c.realm, role: c.role, sid: c.sid, name: c.name, ...(c.sidOf ? { sidOf: c.sidOf } : {}) })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(c.sub)
    .setIssuer(ISSUER)
    .setAudience(`bswl:${c.realm}`)
    .setIssuedAt()
    .setExpirationTime(`${env().ACCESS_TOKEN_TTL}s`)
    .sign(enc());
}

export async function verifyAccess(token: string, realm: Realm): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify<JWTPayload & Omit<AccessClaims, 'sub'>>(token, enc(), {
      issuer: ISSUER,
      audience: `bswl:${realm}`,
      algorithms: ['HS256'],
    });
    if (!payload.sub || payload.realm !== realm) return null;
    return {
      sub: payload.sub,
      realm: payload.realm,
      role: payload.role,
      sid: payload.sid,
      name: payload.name,
      sidOf: payload.sidOf,
    };
  } catch {
    return null;
  }
}

export function newRefreshToken() {
  return randomBytes(32).toString('base64url');
}

export function hashRefresh(token: string) {
  return createHmac('sha256', env().JWT_REFRESH_PEPPER).update(token).digest('hex');
}

export function sha256(s: string) {
  return createHash('sha256').update(s).digest('hex');
}

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/* ── cookie names, one pair per realm so a staff and a student session can
   live in the same browser without stepping on each other ── */
export const cookieNames = (realm: Realm) => ({
  access: `bswl_${realm}_at`,
  refresh: `bswl_${realm}_rt`,
});
