import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { Database } from '@firmivra/db';
import { IdentityPool } from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { httpError } from './auth-errors.js';
import {
  AuthFlowError,
  IDENTITY_PROVIDER,
  type IdentityProvider,
} from './identity/identity-provider.js';
import { portalClient } from './portal-clients.js';
import { type Opened, type PoolSecrets, Sealer } from './sealed.js';
import {
  clearSessionCookies,
  readCookie,
  REFRESH_TOKEN_DAYS,
  type SessionTokens,
  type SignInPlace,
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
  /** Client portal sessions: the firm. The envelope opens only on that firm's portal. */
  businessId: z.string().optional(),
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
const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * The session cookies of a site or of one firm's portal: set after sign-in, renewed by refresh,
 * ended by sign-out.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly secure: boolean;

  constructor(
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
    private readonly envelopes: RefreshEnvelopes,
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    @Inject(ENV) env: Env,
  ) {
    this.secure = env.NODE_ENV === 'production';
  }

  async start(
    res: Response,
    place: SignInPlace,
    session: { userId: string; username: string; tokens: SessionTokens },
  ): Promise<void> {
    const { tokens } = session;
    const { pool, businessId } = place;
    const lifetime = REFRESH_TOKEN_DAYS[pool] * DAY_SECONDS;
    const refresh = tokens.refreshToken
      ? {
          value: {
            userId: session.userId,
            username: session.username,
            refreshToken: tokens.refreshToken,
            pool,
            ...(businessId ? { businessId } : {}),
          },
          expiresAt: nowSeconds() + lifetime,
          // The full lifetime, not the end minus a second clock read (Max-Age was 1 s short).
          maxAgeMs: lifetime * 1000,
        }
      : undefined;
    await this.write(res, place, tokens, refresh);
  }

  /**
   * New access and id cookies. The person must still be allowed in (our database, not only
   * Cognito); otherwise, or without a valid refresh cookie: token revoked, cookies cleared, 401.
   */
  async refresh(req: Request, res: Response, place: SignInPlace): Promise<void> {
    const opened = await this.envelope(req, place);
    if (!opened) throw this.signedOut(res, place);
    const envelope = opened.value;
    if (!(await this.stillAllowed(envelope))) {
      await this.identity.revoke(envelope.pool, envelope.refreshToken);
      throw this.signedOut(res, place);
    }
    let tokens: SessionTokens;
    try {
      tokens = await this.identity.refresh(envelope.pool, envelope.username, envelope.refreshToken);
    } catch (e) {
      if (!(e instanceof AuthFlowError)) throw e;
      throw e.code === 'SESSION_EXPIRED' ? this.signedOut(res, place) : httpError(e.code);
    }
    // Cognito returns a new refresh token only when rotation is on; otherwise the cookie stays.
    // A rotated one keeps the session's original end: refreshing never makes a session longer.
    const rotated = tokens.refreshToken
      ? { value: { ...envelope, refreshToken: tokens.refreshToken }, expiresAt: opened.expiresAt }
      : undefined;
    await this.write(res, place, tokens, rotated);
  }

  /**
   * Always succeeds: clears the cookies, revokes this device's refresh token, optionally all.
   * A sign-out with a session is audited (`auth.signed_out`) where its sign-in was: the firm's
   * log on a portal, the platform's for staff and Super Admins (public route: no tenant context).
   */
  async end(req: Request, res: Response, place: SignInPlace, everywhere: boolean): Promise<void> {
    const envelope = (await this.envelope(req, place))?.value;
    clearSessionCookies(res, place.cookies, this.secure);
    if (!envelope) return;
    // Sign-out always succeeds (#84 review): a failed revoke or audit is logged by id, never 500.
    try {
      await this.identity.revoke(envelope.pool, envelope.refreshToken);
      if (everywhere) await this.identity.signOutEverywhere(envelope.pool, envelope.username);
    } catch {
      this.logger.warn(`Could not revoke the session of user ${envelope.userId} at sign-out`);
    }
    try {
      await this.audit.log(
        'auth.signed_out',
        { type: 'user', id: envelope.userId },
        { pool: envelope.pool, everywhere },
        {
          actorUserId: envelope.userId,
          ...(envelope.businessId ? { businessId: envelope.businessId } : {}),
        },
      );
    } catch {
      this.logger.warn(`Could not audit the sign-out of user ${envelope.userId}`);
    }
  }

  /**
   * Same rule as sign-in: the user row of this pool exists; on the admin site, a Super Admin; on
   * a portal, a client of that firm who may sign in (src/auth/portal-clients.ts).
   */
  private async stillAllowed(envelope: RefreshEnvelope): Promise<boolean> {
    const platform = this.db.forPlatform();
    const user = await platform.user.findUnique({
      where: { id: envelope.userId },
      select: { pool: true },
    });
    if (user?.pool !== envelope.pool) return false;
    if (envelope.pool === 'CLIENT') {
      if (!envelope.businessId) return false;
      return !!(await portalClient(this.db, envelope.businessId, { userId: envelope.userId }));
    }
    if (envelope.pool !== 'ADMIN') return true;
    const admin = await platform.platformAdmin.findUnique({
      where: { userId: envelope.userId },
      select: { role: true },
    });
    return admin?.role === 'SUPER_ADMIN';
  }

  /** The envelope in the place's refresh cookie, if it was sealed for this pool and firm. */
  private async envelope(
    req: Request,
    place: SignInPlace,
  ): Promise<Opened<RefreshEnvelope> | undefined> {
    const sealed = readCookie(req, place.cookies, 'refresh');
    const opened = sealed ? await this.envelopes.open(sealed, place.pool) : undefined;
    return opened?.value.businessId === place.businessId ? opened : undefined;
  }

  private signedOut(res: Response, place: SignInPlace) {
    clearSessionCookies(res, place.cookies, this.secure);
    return httpError('SESSION_EXPIRED');
  }

  /**
   * `refresh`: the envelope to seal and the session's end; the cookie expires with it (`maxAgeMs`
   * when the caller knows it, else the time left until the end).
   */
  private async write(
    res: Response,
    place: SignInPlace,
    tokens: SessionTokens,
    refresh: (Opened<RefreshEnvelope> & { maxAgeMs?: number }) | undefined,
  ): Promise<void> {
    writeSessionCookies(
      res,
      place.cookies,
      {
        access: tokens.accessToken,
        id: tokens.idToken,
        refresh: refresh
          ? await this.envelopes.sealUntil(refresh.value, refresh.expiresAt)
          : undefined,
      },
      {
        accessMs: tokens.expiresIn * 1000,
        refreshMs: refresh ? (refresh.maxAgeMs ?? (refresh.expiresAt - nowSeconds()) * 1000) : 0,
      },
      this.secure,
    );
  }
}
