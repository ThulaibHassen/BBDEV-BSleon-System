import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

/* Page guard. Runs before /staff, /student and /parent pages render.

   It only checks that the realm's access cookie is a valid, unexpired JWT —
   a cheap signature check, no database. When it is missing or expired the
   browser goes to that app's login page, which first tries a silent refresh
   (the refresh cookie is scoped to /api/auth and never reaches pages) and
   only shows the form if that fails.

   The API routes do the real authorisation: they re-verify the token, check
   the session is still live and check the RBAC permission on every call. */

const APPS = ['staff', 'student', 'parent'] as const;

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const realm = APPS.find((a) => pathname === `/${a}` || pathname.startsWith(`/${a}/`));
  if (!realm) return NextResponse.next();

  // public pages inside each app
  if (
    pathname === `/${realm}/login` ||
    pathname.startsWith(`/${realm}/sw.js`) ||
    pathname.startsWith(`/${realm}/manifest`) ||
    /\.(png|ico|svg|webp|jpg|json|webmanifest)$/.test(pathname) // icons and manifests are public
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get(`bswl_${realm}_at`)?.value;
  if (token && (await valid(token, realm))) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = `/${realm}/login`;
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

async function valid(token: string, realm: string) {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(secret), {
      issuer: 'bswl',
      audience: `bswl:${realm}`,
      algorithms: ['HS256'],
    });
    return true;
  } catch {
    return false;
  }
}

export const config = {
  matcher: ['/staff/:path*', '/student/:path*', '/parent/:path*'],
};
