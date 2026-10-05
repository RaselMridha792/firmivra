import type { CookieOptions, Request, Response } from 'express';
import { AUTH_COOKIES, type AuthSite, type IdentityPool } from '@firmivra/types';

/**
 * Routes under /api/v1/admin/ belong to the Super Admin site; every other route to the firm and
 * portal sites. Each site accepts only its own cookie and its own pools, so an admin session can
 * never act on the firm API and a staff session never on the admin API.
 */
const ADMIN_PATH = /^\/api\/v1\/admin(\/|$)/;

export function siteOf(req: Pick<Request, 'path'>): AuthSite {
  return typeof req.path === 'string' && ADMIN_PATH.test(req.path) ? 'admin' : 'firm';
}

export const SITE_POOLS: Record<AuthSite, readonly IdentityPool[]> = {
  admin: ['ADMIN'],
  firm: ['STAFF', 'CLIENT'],
};

/** Who signs in on each site's /auth routes. Clients sign in on the portal (R3). */
export const SIGN_IN_POOL: Record<AuthSite, IdentityPool> = { firm: 'STAFF', admin: 'ADMIN' };

/**
 * Refresh-token lifetime per pool, in days: the same as `refreshTokenValidity` of each pool's
 * app client in infra/src/stacks/auth-stack.ts. Change both together.
 */
export const REFRESH_TOKEN_DAYS: Record<IdentityPool, number> = {
  STAFF: 30,
  CLIENT: 30,
  ADMIN: 30,
};

type CookieKind = 'access' | 'id' | 'refresh';

export function readCookie(req: Request, site: AuthSite, kind: CookieKind): string | undefined {
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  return cookies?.[AUTH_COOKIES[site][kind]];
}

export function readAccessCookie(req: Request, site: AuthSite): string | undefined {
  return readCookie(req, site, 'access');
}

export interface SessionTokens {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  /** Lifetime of the access and id tokens, in seconds. */
  expiresIn: number;
}

/** Host-only (no Domain) and HttpOnly. `secure` is off only for plain-http local development. */
function cookieOptions(site: AuthSite, kind: CookieKind, secure: boolean): CookieOptions {
  return kind === 'refresh'
    ? { httpOnly: true, secure, sameSite: 'strict', path: AUTH_COOKIES[site].refreshPath }
    : { httpOnly: true, secure, sameSite: 'lax', path: '/' };
}

/** The site's session cookies (docs/api/auth.yaml, "Cookies"). `refresh` is the sealed envelope. */
export function writeSessionCookies(
  res: Response,
  site: AuthSite,
  cookies: { access: string; id?: string; refresh?: string },
  maxAge: { accessMs: number; refreshMs: number },
  secure: boolean,
): void {
  const names = AUTH_COOKIES[site];
  const access = { ...cookieOptions(site, 'access', secure), maxAge: maxAge.accessMs };
  res.cookie(names.access, cookies.access, access);
  if (cookies.id) res.cookie(names.id, cookies.id, access);
  if (cookies.refresh) {
    res.cookie(names.refresh, cookies.refresh, {
      ...cookieOptions(site, 'refresh', secure),
      maxAge: maxAge.refreshMs,
    });
  }
}

export function clearSessionCookies(res: Response, site: AuthSite, secure: boolean): void {
  for (const kind of ['access', 'id', 'refresh'] as const) {
    res.clearCookie(AUTH_COOKIES[site][kind], cookieOptions(site, kind, secure));
  }
}
