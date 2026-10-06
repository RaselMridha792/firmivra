import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AUTH_COOKIES, type AuthSite } from '@firmivra/types';
import { requestContext } from '../common/request-context.js';
import type { Env } from '../config/env.js';
import { siteOf } from './site.js';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const JSON_TYPE = /^application\/json\s*(;|$)/i;
/** Local sign-in (AUTH_MODE=local only) is called from all three sites. */
const DEV_PATH = /^\/api\/v1\/dev(\/|$)/i;
const SESSION_COOKIES = new Set<string>(
  Object.values(AUTH_COOKIES).flatMap((c) => [c.access, c.id, c.refresh]),
);

/**
 * The origins each site's pages run on, from config (ADMIN_BASE_URL, APP_BASE_URL,
 * PORTAL_BASE_URL: https:// and the configured site host). Never the Host header.
 */
export function siteOrigins(env: Env): Record<AuthSite, readonly string[]> {
  const origin = (url: string) => new URL(url).origin;
  return {
    admin: [origin(env.ADMIN_BASE_URL)],
    firm: [origin(env.APP_BASE_URL), origin(env.PORTAL_BASE_URL)],
  };
}

function reject(res: Response, status: number, code: string, message: string): void {
  const requestId = requestContext.getStore()?.requestId;
  res.status(status).json({ error: { code, message, requestId } });
}

/**
 * Stops cross-site requests, including login CSRF (a form on another site posting the
 * attacker's sign-in session and code to /auth/mfa). For POST, PUT, PATCH and DELETE:
 * - a body must be JSON (an HTML form cannot send that), else 415 UNSUPPORTED_MEDIA_TYPE;
 * - a browser request must come from the route's own site: `Origin` must be one of that site's
 *   origins, or, without `Origin`, `Sec-Fetch-Site` must be `same-origin`. Else 403
 *   ORIGIN_NOT_ALLOWED;
 * - a request with neither header is not from a browser (Node's fetch sends neither). It may
 *   not carry a session cookie: that would be server code relaying the user's session (for
 *   example a Next.js route handler), which this check could not protect. Also 403.
 * The API sends no CORS headers: the browser always calls it on its own host.
 */
export function crossSiteGuard(env: Env): RequestHandler {
  const origins = siteOrigins(env);
  const anySite = [...origins.admin, ...origins.firm];

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!STATE_CHANGING.has(req.method)) return next();

    const contentType = req.get('content-type');
    const hasBody =
      contentType !== undefined ||
      Number(req.get('content-length') ?? 0) > 0 ||
      req.get('transfer-encoding') !== undefined;
    if (hasBody && !(contentType && JSON_TYPE.test(contentType))) {
      return reject(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the request body as JSON');
    }

    const allowed = DEV_PATH.test(req.path) ? anySite : origins[siteOf(req)];
    const origin = req.get('origin');
    const fetchSite = req.get('sec-fetch-site');
    const cookies = (req.cookies ?? {}) as Record<string, unknown>;
    const crossSite =
      origin !== undefined
        ? !allowed.includes(origin)
        : fetchSite !== undefined
          ? fetchSite !== 'same-origin'
          : Object.keys(cookies).some((name) => SESSION_COOKIES.has(name));
    if (crossSite) {
      return reject(res, 403, 'ORIGIN_NOT_ALLOWED', 'This request must come from the site itself');
    }
    next();
  };
}
