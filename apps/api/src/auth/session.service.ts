import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { type AuthSite, IdentityPool } from '@firmivra/types';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { httpError } from './auth-errors.js';
import {
  AuthFlowError,
  IDENTITY_PROVIDER,
  type IdentityProvider,
} from './identity/identity-provider.js';
import { type PoolSecrets, Sealer } from './sealed.js';
import {
  clearSessionCookies,
  readCookie,
  REFRESH_TOKEN_DAYS,
  type SessionTokens,
  SIGN_IN_POOL,
  writeSessionCookies,
} from './site.js';

/** HKDF label for refresh-envelope keys. A new label (v2) signs everyone out. */
export const REFRESH_KEY_LABEL = 'fv-auth-refresh-v1';

const RefreshEnvelope = z.object({
  userId: z.string(),
  /** Cognito username: REFRESH_TOKEN_AUTH needs it for the SECRET_HASH. */
  username: z.string(),
  refreshToken: z.string(),
  pool: IdentityPool,
});
export type RefreshEnvelope = z.infer<typeof RefreshEnvelope>;

/**
 * What the refresh cookie holds: the refresh token with the Cognito username and our user id,
 * sealed so the browser can neither read nor change it. It expires with the refresh token.
 */
export class RefreshEnvelopes extends Sealer<RefreshEnvelope> {
  constructor(secrets: PoolSecrets) {
    super(REFRESH_KEY_LABEL, RefreshEnvelope, secrets);
  }
}

const DAY_SECONDS = 24 * 60 * 60;

/** The site's session cookies: set after sign-in, renewed by refresh, ended by sign-out. */
@Injectable()
export class SessionService {
  private readonly secure: boolean;

  constructor(
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
    private readonly envelopes: RefreshEnvelopes,
    @Inject(ENV) env: Env,
  ) {
    this.secure = env.NODE_ENV === 'production';
  }

  async start(
    res: Response,
    site: AuthSite,
    session: { userId: string; username: string; tokens: SessionTokens },
  ): Promise<void> {
    const { tokens } = session;
    const envelope = tokens.refreshToken
      ? {
          userId: session.userId,
          username: session.username,
          refreshToken: tokens.refreshToken,
          pool: SIGN_IN_POOL[site],
        }
      : undefined;
    await this.write(res, site, tokens, envelope);
  }

  /** New access and id cookies. Without a valid refresh cookie: cookies cleared, 401. */
  async refresh(req: Request, res: Response, site: AuthSite): Promise<void> {
    const envelope = await this.envelope(req, site);
    if (!envelope) throw this.signedOut(res, site);
    let tokens: SessionTokens;
    try {
      tokens = await this.identity.refresh(envelope.pool, envelope.username, envelope.refreshToken);
    } catch (e) {
      if (!(e instanceof AuthFlowError)) throw e;
      throw e.code === 'SESSION_EXPIRED' ? this.signedOut(res, site) : httpError(e.code);
    }
    // Cognito returns a new refresh token only when rotation is on; otherwise the cookie stays.
    const rotated = tokens.refreshToken
      ? { ...envelope, refreshToken: tokens.refreshToken }
      : undefined;
    await this.write(res, site, tokens, rotated);
  }

  /** Always succeeds: clears the cookies, revokes this device's refresh token, optionally all. */
  async end(req: Request, res: Response, site: AuthSite, everywhere: boolean): Promise<void> {
    const envelope = await this.envelope(req, site);
    clearSessionCookies(res, site, this.secure);
    if (!envelope) return;
    await this.identity.revoke(envelope.pool, envelope.refreshToken);
    if (everywhere) await this.identity.signOutEverywhere(envelope.pool, envelope.username);
  }

  private async envelope(req: Request, site: AuthSite): Promise<RefreshEnvelope | undefined> {
    const sealed = readCookie(req, site, 'refresh');
    return sealed ? this.envelopes.open(sealed, SIGN_IN_POOL[site]) : undefined;
  }

  private signedOut(res: Response, site: AuthSite) {
    clearSessionCookies(res, site, this.secure);
    return httpError('SESSION_EXPIRED');
  }

  private async write(
    res: Response,
    site: AuthSite,
    tokens: SessionTokens,
    envelope: RefreshEnvelope | undefined,
  ): Promise<void> {
    const refreshSeconds = REFRESH_TOKEN_DAYS[SIGN_IN_POOL[site]] * DAY_SECONDS;
    writeSessionCookies(
      res,
      site,
      {
        access: tokens.accessToken,
        id: tokens.idToken,
        refresh: envelope ? await this.envelopes.seal(envelope, refreshSeconds) : undefined,
      },
      { accessMs: tokens.expiresIn * 1000, refreshMs: refreshSeconds * 1000 },
      this.secure,
    );
  }
}
