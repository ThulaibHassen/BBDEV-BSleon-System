'use client';

/* The one way client code talks to the server.

   - JSON in, JSON out; errors throw ApiError with the server's message.
   - On 401 it refreshes the realm's session ONCE (concurrent callers share
     the same refresh, because refresh tokens rotate) and replays the call.
   - If the refresh fails, the user is sent to that app's login page. */

export type Realm = 'staff' | 'student' | 'parent';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

const refreshing: Partial<Record<Realm, Promise<boolean>>> = {};

export function refreshOnce(realm: Realm): Promise<boolean> {
  if (!refreshing[realm]) {
    refreshing[realm] = fetch(`/api/auth/${realm}/refresh`, { method: 'POST', credentials: 'same-origin' })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        setTimeout(() => delete refreshing[realm], 0);
      });
  }
  return refreshing[realm]!;
}

function realmOfPath(path: string): Realm {
  if (path.startsWith('/api/student') || path.startsWith('/api/auth/student')) return 'student';
  if (path.startsWith('/api/parent') || path.startsWith('/api/auth/parent')) return 'parent';
  if (path.startsWith('/api/staff') || path.startsWith('/api/auth/staff')) return 'staff';
  // shared routes (/api/push, /api/quiz …): the app the page belongs to
  const app = typeof window === 'undefined' ? '' : window.location.pathname.split('/')[1];
  return app === 'student' || app === 'parent' ? app : 'staff';
}

/* Sign-in, refresh and sign-out answer 401 for a wrong code or a dead
   session; refreshing in front of them would loop. Every other route
   (including /api/auth/<realm>/me and /password) gets one refresh. */
const NO_REFRESH = /^\/api\/auth\/[a-z]+\/(login|refresh|logout)(\?|$)/;

function toLogin(realm: Realm) {
  if (typeof window === 'undefined') return;
  const here = window.location.pathname + window.location.search;
  if (!window.location.pathname.endsWith('/login')) {
    window.location.href = `/${realm}/login?next=${encodeURIComponent(here)}`;
  }
}

type Opts = Omit<RequestInit, 'body'> & { body?: unknown; realm?: Realm; raw?: boolean };

export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const realm = opts.realm ?? realmOfPath(path);
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  const init: RequestInit = {
    ...opts,
    credentials: 'same-origin',
    headers: {
      ...(opts.body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers || {}),
    },
    body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
  };

  let res = await fetch(path, init);
  if (res.status === 401 && !NO_REFRESH.test(path)) {
    if (await refreshOnce(realm)) res = await fetch(path, init);
    if (res.status === 401) {
      toLogin(realm);
      throw new ApiError(401, 'Your session has ended. Please sign in again.', 'unauthenticated');
    }
  }
  if (opts.raw) return res as unknown as T;
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const d = (data || {}) as { error?: string; code?: string };
    throw new ApiError(res.status, d.error || `Request failed (${res.status})`, d.code);
  }
  return data as T;
}

function safeJson(t: string) {
  try {
    return JSON.parse(t);
  } catch {
    return { error: t.slice(0, 300) };
  }
}

/** SWR fetcher bound to api() */
export const fetcher = <T,>(path: string) => api<T>(path);

export const post = <T = unknown,>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });
export const patch = <T = unknown,>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body });
export const put = <T = unknown,>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body });
export const del = <T = unknown,>(path: string, body?: unknown) => api<T>(path, { method: 'DELETE', body });
