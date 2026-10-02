import 'server-only';
import { NextResponse } from 'next/server';
import { handle } from './api';
import { refreshSession, endSession } from './auth';
import type { Realm } from '@/lib/shared/rbac';

/* The refresh and logout handlers are identical for all three realms. */

export const refreshHandler = (realm: Realm) =>
  handle(async () => {
    const r = await refreshSession(realm);
    if (!r) return NextResponse.json({ error: 'Your session has ended. Please sign in again.', code: 'unauthenticated' }, { status: 401 });
    return { ok: true, expiresIn: r.expiresIn };
  });

export const logoutHandler = (realm: Realm) =>
  handle(async () => {
    await endSession(realm);
    return { ok: true };
  });
