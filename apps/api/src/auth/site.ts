import type { CookieOptions, Request, Response } from 'express';
import { AUTH_COOKIES, type AuthSite, type IdentityPool, portalCookies } from '@firmivra/types';

/**
 * Routes under /api/v1/admin/ belong to the Super Admin site; every other route to the firm and
 * portal sites. Each site accepts only its own cookie and its own pools, so an admin session can
 * never act on the firm API and a staff session never on the admin API.
 */
// Case-insensitive like Express routing: /API/V1/Admin/me reaches the same handler.
const ADMIN_PATH = /^\/api\/v1\/admin(\/|$)/i;

export function siteOf(req: Pick<Request, 'path'>): AuthSite {
  return typeof req.path === 'string' && ADMIN_PATH.test(req.path) ? 'admin' : 'firm';
}

/**
 * Pools each site's routes accept (portal routes take only CLIENT, see portalSlugOf). The firm
 * site keeps CLIENT on purpose (#62 follow-up, confirmed): a client token there reaches only what
 * the roles guard allows (403 on every staff route; `GET /me` shows their own data), and a client's
 * cookies are scoped to their portal's paths, so a browser never sends them to the firm site.
 */
export const SITE_POOLS: Record<AuthSite, readonly IdentityPool[]> = {
  admin: ['ADMIN'],
  firm: ['STAFF', 'CLIENT'],
};

// Like routing, any letter case; the slug is the first part after /portal/.
const PORTAL_PATH = /^\/api\/v1\/portal\/([^/]+)/i;

/**
 * The firm slug of a client portal route (/api/v1/portal/{slug}/...), lower-cased, or undefined.
 * Portal routes take only that firm's portal cookies and only the clients pool.
 */
export function portalSlugOf(req: Pick<Request, 'path'>): string | undefined {
  const match = typeof req.path === 'string' ? PORTAL_PATH.exec(req.path) : null;
  return match?.[1]?.toLowerCase();
}

/** Who signs in on each site's /auth routes. Clients sign in on the portal (R3). */
export const SIGN_IN_POOL: Record<AuthSite, IdentityPool> = { firm: 'STAFF', admin: 'ADMIN' };

/** A session's cookie names and paths: the site's (AUTH_COOKIES) or one firm's portal's. */
export interface CookieSet {
  access: string;
  id: string;
  refresh: string;
  /** Path of the access and id cookies. */
  accessPath: string;
  refreshPath: string;
}

export const siteCookies = (site: AuthSite): CookieSet => ({
  ...AUTH_COOKIES[site],
  accessPath: '/',
});

/**
 * Where someone signs in: the pool, the session cookies, the issuer shown in the authenticator
 * app and, on a firm's portal, the firm. A client's login, challenge and refresh envelope belong
 * to that one firm.
 */
export interface SignInPlace {
  pool: IdentityPool;
  cookies: CookieSet;
  issuer: string;
  businessId?: string;
}

const ISSUER: Record<AuthSite, string> = { firm: 'Firmivra', admin: 'Firmivra Admin' };

export const sitePlace = (site: AuthSite): SignInPlace => ({
  pool: SIGN_IN_POOL[site],
  cookies: siteCookies(site),
  issuer: ISSUER[site],
});

export function portalPlace(firm: { id: string; slug: string; name: string }): SignInPlace {
  return {
    pool: 'CLIENT',
    cookies: portalCookies(firm.slug),
    // The otpauth label is "issuer:email", so the issuer may not hold a colon.
    issuer: firm.name.replace(/:/g, ''),
    businessId: firm.id,
  };
}

/**
 * How long a session lasts after sign-in, per pool, in days: the refresh cookie and its sealed
 * envelope expire then. Must not exceed `refreshTokenValidity` of the pool's app client in
 * infra/src/stacks/auth-stack.ts; since #21 the two are equal (staff 7, clients 30, admins 1).
 */
export const REFRESH_TOKEN_DAYS: Record<IdentityPool, number> = {
  STAFF: 7,
  CLIENT: 30,
  ADMIN: 1,
};

type CookieKind = 'access' | 'id' | 'refresh';

export function readCookie(req: Request, cookies: CookieSet, kind: CookieKind): string | undefined {
  const all = req.cookies as Record<string, string | undefined> | undefined;
  return all?.[cookies[kind]];
}

/** The access cookie the route takes: its firm's portal cookie on a portal route, else its site's. */
export function readAccessCookie(req: Request): string | undefined {
  const slug = portalSlugOf(req);
  return readCookie(req, slug ? portalCookies(slug) : siteCookies(siteOf(req)), 'access');
}

export interface SessionTokens {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  /** Lifetime of the access and id tokens, in seconds. */
  expiresIn: number;
}

/** Host-only (no Domain) and HttpOnly. `secure` is off only for plain-http local development. */
function cookieOptions(names: CookieSet, kind: CookieKind, secure: boolean): CookieOptions {
  return kind === 'refresh'
    ? { httpOnly: true, secure, sameSite: 'strict', path: names.refreshPath }
    : { httpOnly: true, secure, sameSite: 'lax', path: names.accessPath };
}

/**
 * The session cookies (docs/api/auth.yaml and client-auth.yaml, "Cookies"). `refresh` is the
 * sealed envelope.
 */
export function writeSessionCookies(
  res: Response,
  names: CookieSet,
  cookies: { access: string; id?: string; refresh?: string },
  maxAge: { accessMs: number; refreshMs: number },
  secure: boolean,
): void {
  const access = { ...cookieOptions(names, 'access', secure), maxAge: maxAge.accessMs };
  res.cookie(names.access, cookies.access, access);
  if (cookies.id) res.cookie(names.id, cookies.id, access);
  if (cookies.refresh) {
    res.cookie(names.refresh, cookies.refresh, {
      ...cookieOptions(names, 'refresh', secure),
      maxAge: maxAge.refreshMs,
    });
  }
}

export function clearSessionCookies(res: Response, names: CookieSet, secure: boolean): void {
  for (const kind of ['access', 'id', 'refresh'] as const) {
    res.clearCookie(names[kind], cookieOptions(names, kind, secure));
  }
}
