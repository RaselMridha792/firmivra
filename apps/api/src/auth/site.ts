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

export function readAccessCookie(req: Request, site: AuthSite): string | undefined {
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  return cookies?.[AUTH_COOKIES[site].access];
}

export interface SessionTokens {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  /** Lifetime of the access and id tokens, in seconds. */
  expiresIn: number;
}

const REFRESH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Host-only (no Domain), HttpOnly session cookies for the site (docs/api/auth.yaml, "Cookies").
 * `secure` is off only for plain-http local development.
 */
export function setSessionCookies(
  res: Response,
  site: AuthSite,
  tokens: SessionTokens,
  secure: boolean,
): void {
  const names = AUTH_COOKIES[site];
  const base: CookieOptions = { httpOnly: true, secure, sameSite: 'lax', path: '/' };
  const maxAge = tokens.expiresIn * 1000;
  res.cookie(names.access, tokens.accessToken, { ...base, maxAge });
  if (tokens.idToken) res.cookie(names.id, tokens.idToken, { ...base, maxAge });
  if (tokens.refreshToken) {
    res.cookie(names.refresh, tokens.refreshToken, {
      ...base,
      sameSite: 'strict',
      path: names.refreshPath,
      maxAge: REFRESH_MAX_AGE_MS,
    });
  }
}
