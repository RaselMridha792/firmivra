import { type NextRequest, NextResponse } from 'next/server';
import { areaForHost, INTERNAL_PREFIXES } from './lib/hosts';

/**
 * One Next.js app, three sites, chosen by host name:
 *   admin.<domain>/...        -> app/admin/...         (Super Admin)
 *   app.<domain>/...          -> app/firm/...          (firm workspace)
 *   portal.<domain>/{slug}/.. -> app/portal/{slug}/... (client portal)
 * Works the same for admin.localhost:3000 and admin.dev.firmivra.com.
 * The internal folders are never reachable by their own path.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const area = areaForHost(request.headers.get('host'));

  if (!area) {
    // Bare host (localhost): only the index page, never an area's internal path.
    return INTERNAL_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
      ? new NextResponse(null, { status: 404 })
      : NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = `/${area}${pathname === '/' ? '' : pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Skip the API (forwarded separately), the health check, Next.js assets and static files.
  matcher: [
    '/((?!api/|healthz|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)',
  ],
};
