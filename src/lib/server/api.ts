import 'server-only';
import { NextResponse } from 'next/server';
import { z, ZodError, type ZodType } from 'zod';
import { HttpError } from './auth';

/* Every route handler is wrapped in `handle()` so that errors become JSON
   with the right status and nothing internal leaks to a phone. */

type Ctx<P> = { params: Promise<P> };

export function handle<P = Record<string, string>>(fn: (req: Request, ctx: Ctx<P>) => Promise<Response | unknown>) {
  return async (req: Request, ctx: Ctx<P>) => {
    try {
      const out = await fn(req, ctx);
      if (out instanceof Response) return out;
      return NextResponse.json(out ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown) {
  if (e instanceof HttpError) {
    return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  }
  if (e instanceof ZodError) {
    const first = e.issues[0];
    return NextResponse.json(
      { error: first ? `${first.path.join('.') || 'input'}: ${first.message}` : 'Invalid input', code: 'invalid', issues: e.issues },
      { status: 400 },
    );
  }
  const pg = e as { code?: string; detail?: string; message?: string };
  if (pg?.code === '23505') return NextResponse.json({ error: 'That already exists.', code: 'conflict' }, { status: 409 });
  if (pg?.code === '23503') return NextResponse.json({ error: 'That is still in use elsewhere.', code: 'in_use' }, { status: 409 });
  console.error('[api]', e);
  return NextResponse.json({ error: 'Something went wrong. Your data is safe — try again.', code: 'server' }, { status: 500 });
}

export async function body<T extends ZodType>(req: Request, s: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, 'Expected a JSON body.', 'invalid');
  }
  return s.parse(raw);
}

export function query(req: Request) {
  return new URL(req.url).searchParams;
}

export const idParam = z.coerce.number().int().positive();

export async function paramId<P extends { id: string }>(ctx: Ctx<P>) {
  const { id } = await ctx.params;
  const r = idParam.safeParse(id);
  if (!r.success) throw new HttpError(400, 'Bad id', 'invalid');
  return r.data;
}

export function notFound(what = 'That') {
  return new HttpError(404, `${what} was not found.`, 'not_found');
}

/** Short private cache for per-user GETs (the browser may reuse for a few seconds). */
export function jsonCached(data: unknown, maxAge = 0) {
  return NextResponse.json(data, {
    headers: { 'Cache-Control': maxAge ? `private, max-age=${maxAge}` : 'private, no-store' },
  });
}
