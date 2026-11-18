import { type NextRequest, NextResponse } from 'next/server';
import { buildCsp, CSP_HEADER, newNonce } from './lib/csp';
import { type Area, areaForHost, INTERNAL_PREFIXES } from './lib/hosts';

/**
 * The page's Content-Security-Policy (lib/csp.ts), with a fresh nonce: on the request, where
 * Next.js reads the nonce to stamp it on its own scripts, and on the response for the browser.
 */
function withCsp(
  request: NextRequest,
  area: Area | null,
  make: (init: { headers: Headers }) => NextResponse,
) {
  const nonce = newNonce();
  const policy = buildCsp({ nonce, area, dev: process.env.NODE_ENV === 'development' });
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set(CSP_HEADER, policy);
  const response = make({ headers });
  response.headers.set(CSP_HEADER, policy);
  return response;
}

/** A firm slug as the first path segment (slugs are case-insensitive). */
const PORTAL_SLUG = /^\/[A-Za-z0-9-]{1,63}(\/|$)/;

/**
 * One Next.js app, three sites, chosen by host name from configuration (src/lib/hosts.ts):
 *   ADMIN_HOST/...         -> app/admin/...         (Super Admin)
 *   APP_HOST/...           -> app/firm/...          (firm workspace)
 *   PORTAL_HOST/{slug}/... -> app/portal/{slug}/... (client portal)
 * Locally admin.localhost etc.; in AWS the CloudFront domains, later *.dev.firmivra.com.
 * The internal folders are never reachable by their own path.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const area = areaForHost(request.headers.get('host'));

  if (!area) {
    // Bare host (localhost): only the index page, never an area's internal path.
    return INTERNAL_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
      ? new NextResponse(null, { status: 404 })
      : withCsp(request, null, (init) => NextResponse.next({ request: init }));
  }

  // Portal: the first segment is the firm's slug and must look like one. An encoded "/" or "\"
  // (/%2Fevil.com/home) would otherwise reach pages and redirects as the slug "/evil.com".
  if (area === 'portal' && pathname !== '/' && !PORTAL_SLUG.test(pathname)) {
    return new NextResponse(null, { status: 404 });
  }

  const url = request.nextUrl.clone();
  url.pathname = `/${area}${pathname === '/' ? '' : pathname}`;
  return withCsp(request, area, (init) => NextResponse.rewrite(url, { request: init }));
}

export const config = {
  // Skip the API (forwarded separately), the health check, Next.js assets and static files.
  matcher: [
    '/((?!api/|healthz|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)',
  ],
};
