import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge pre-filter for the contractor workspace.
 *
 * This is a *speed* optimisation, not the security boundary: it only checks
 * that a session cookie is present, so a visitor without one is sent to the
 * login page before any server component runs.
 *
 * The authoritative check is `requireSession()` in `app/app/layout.tsx`, which
 * loads the session from PostgreSQL (via a security definer function), and
 * verifies expiry, revocation, the user's active flag and an ACTIVE business
 * membership on every request. A stale or forged cookie therefore gets past
 * this middleware and is rejected there.
 *
 * The matcher deliberately excludes the public marketing site, the auth pages
 * and the API routes, all of which enforce their own rules.
 */
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? 'cg_session';

export function middleware(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  if (pathname === '/app' || pathname.startsWith('/app/')) {
    const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);

    if (!hasSessionCookie) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.search = '';
      // Remember where the visitor was heading; the login action validates it
      // with safeAppRedirectPath() before using it.
      url.searchParams.set('next', `${pathname}${search}`);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/app/:path*'],
};
