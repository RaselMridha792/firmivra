import { createHmac, randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import type { IdentityPool, MfaSetupResponse, SignInResult } from '@firmivra/types';
import { type AuditEntity, AuditService } from '../audit/audit.service.js';
import { type AuthContext, requestContext } from '../common/request-context.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { httpError, runFlow } from './auth-errors.js';
import { ChallengeSessions } from './challenge-session.js';
import {
  AuthFlowError,
  type AuthStep,
  IDENTITY_PROVIDER,
  type IdentityProvider,
} from './identity/identity-provider.js';
import { portalClient } from './portal-clients.js';
import { deriveKey, poolSecrets } from './sealed.js';
import type { SessionTokens, SignInPlace } from './site.js';

/** Failed resets are audited; the per-email limit counts those rows (shared by every API task). */
const RESET_FAILED = 'auth.password_reset_failed';
export const RESET_LIMIT = { attempts: 5, windowMs: 15 * 60_000 };
/**
 * Every failed sign-in, a wrong password or a wrong MFA code, is audited, and these limits count
 * those rows, so every API task shares them (R2 step 7). Real and unknown emails count alike.
 */
const SIGN_IN_FAILED = 'auth.sign_in_failed';
export const SIGN_IN_LIMIT = {
  /** Failures for one email (per firm on a portal) in the window, then 429 RATE_LIMITED. */
  perEmail: 10,
  /** Wrong MFA codes in one sign-in attempt, then CHALLENGE_EXPIRED: sign in again. */
  perAttempt: 5,
  windowMs: 15 * 60_000,
};
/** HKDF label for the key that turns an email into the pseudonymous key the limit counts by. */
const EMAIL_KEY_LABEL = 'fv-auth-email-key-v1';
/** Staff and Super Admins always pass MFA; the pools require it, and so does the API. */
const MFA_REQUIRED: ReadonlySet<IdentityPool> = new Set(['STAFF', 'ADMIN']);

/** The next step for the browser, or tokens for the controller to put in cookies. */
export type SignInOutcome =
  | { kind: 'step'; result: Exclude<SignInResult, { status: 'SIGNED_IN' }> }
  | { kind: 'signed-in'; userId: string; username: string; tokens: SessionTokens };

const wrongStep = () =>
  new BadRequestException({
    code: 'VALIDATION_FAILED',
    message: 'This sign-in step does not take that request. Follow the status from the last step.',
  });

/**
 * Sign-in for staff, Super Admins (docs/api/auth.yaml) and a firm's clients on its portal
 * (client-auth.yaml): password, then MFA or first-time MFA setup; forgot and reset password.
 * Errors never reveal whether an account exists.
 */
@Injectable()
export class SignInService {
  private readonly emailKeys: Partial<Record<IdentityPool, Uint8Array>> = {};

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
    private readonly challenges: ChallengeSessions,
    private readonly audit: AuditService,
    @Inject(ENV) env: Env,
  ) {
    for (const [pool, secret] of Object.entries(poolSecrets(env))) {
      if (secret) {
        this.emailKeys[pool as IdentityPool] = deriveKey(
          secret,
          pool as IdentityPool,
          EMAIL_KEY_LABEL,
        );
      }
    }
  }

  /**
   * Checks the password. An email with SIGN_IN_LIMIT.perEmail failures in the window is 429
   * before Cognito is asked, whether or not it has an account; each wrong password is audited.
   */
  async signIn(place: SignInPlace, email: string, password: string): Promise<SignInOutcome> {
    const emailKey = this.emailKey(place, email);
    if ((await this.failures(place, 'emailKey', emailKey)) >= SIGN_IN_LIMIT.perEmail) {
      throw httpError('RATE_LIMITED');
    }
    const user = await this.findUser(place, email);
    let step: AuthStep;
    try {
      step = await this.identity.signIn(place.pool, user?.cognitoSub, password);
      if (!user) throw new AuthFlowError('INVALID_CREDENTIALS');
    } catch (e) {
      if (!(e instanceof AuthFlowError)) throw e;
      if (e.code === 'INVALID_CREDENTIALS') {
        await this.failed(place, { emailKey, step: 'password' });
      }
      throw httpError(e.code);
    }
    return this.next(step, user.id, place, emailKey);
  }

  /** Right after activation: sign the new staff member in, which asks for MFA setup. */
  async afterActivation(userId: string, sub: string, password: string): Promise<SignInOutcome> {
    const step = await runFlow(() => this.identity.signIn('STAFF', sub, password));
    const user = await this.db
      .forPlatform()
      .user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
    const place = { pool: 'STAFF' as const };
    return this.next(step, userId, place, this.emailKey(place, user.email));
  }

  /**
   * The authenticator code (or the first code of a new authenticator). A wrong code counts against
   * the attempt (SIGN_IN_LIMIT.perAttempt, then sign in again) and against the email, so starting
   * again never gives a fresh set of tries.
   */
  async mfa(place: SignInPlace, session: string, code: string): Promise<SignInOutcome> {
    const { pool } = place;
    const c = await this.open(session, place);
    if (c.step === 'MFA_SETUP') throw wrongStep();
    if (
      c.attemptId &&
      (await this.failures(place, 'attemptId', c.attemptId)) >= SIGN_IN_LIMIT.perAttempt
    ) {
      throw httpError('CHALLENGE_EXPIRED');
    }
    if (
      c.emailKey &&
      (await this.failures(place, 'emailKey', c.emailKey)) >= SIGN_IN_LIMIT.perEmail
    ) {
      throw httpError('RATE_LIMITED');
    }
    let tokens: SessionTokens;
    try {
      tokens = await (c.step === 'MFA'
        ? this.identity.answerMfa(pool, c.username, c.session, code)
        : this.identity.finishMfaSetup(pool, c.username, c.session, code));
    } catch (e) {
      if (!(e instanceof AuthFlowError)) throw e;
      if (e.code === 'MFA_CODE_INVALID') {
        await this.failed(place, {
          ...(c.emailKey ? { emailKey: c.emailKey } : {}),
          ...(c.attemptId ? { attemptId: c.attemptId } : {}),
          step: 'mfa',
        });
      }
      throw httpError(e.code);
    }
    await this.succeeded(place, c.userId);
    return { kind: 'signed-in', userId: c.userId, username: c.username, tokens };
  }

  async startMfaSetup(place: SignInPlace, session: string): Promise<MfaSetupResponse> {
    const { pool } = place;
    const c = await this.open(session, place);
    if (c.step !== 'MFA_SETUP') throw wrongStep();
    const setup = await runFlow(() => this.identity.startMfaSetup(pool, c.username, c.session));
    const user = await this.db
      .forPlatform()
      .user.findUniqueOrThrow({ where: { id: c.userId }, select: { email: true } });
    return {
      session: await this.challenges.seal({
        ...c,
        session: setup.session,
        step: 'MFA_SETUP_VERIFY',
      }),
      secret: setup.secret,
      otpauthUri: otpauthUri(place.issuer, user.email, setup.secret),
    };
  }

  /** Emails a reset code when the account exists; the answer is the same either way. */
  async forgotPassword(place: SignInPlace, email: string): Promise<void> {
    const user = await this.findUser(place, email);
    await runFlow(() => this.identity.forgotPassword(place.pool, user?.cognitoSub));
  }

  /**
   * Sets the new password with the emailed code; Cognito then ends every session. Real and
   * unknown emails get the same answers: RESET_CODE_INVALID for any failure, and RATE_LIMITED
   * once an email has RESET_LIMIT.attempts failures in the window.
   */
  async resetPassword(
    place: SignInPlace,
    email: string,
    code: string,
    password: string,
  ): Promise<void> {
    const { pool } = place;
    const emailKey = this.emailKey(place, email);
    const failures = await this.count(
      place,
      RESET_FAILED,
      'emailKey',
      emailKey,
      RESET_LIMIT.windowMs,
    );
    if (failures >= RESET_LIMIT.attempts) throw httpError('RATE_LIMITED');
    const user = await this.findUser(place, email);
    try {
      await this.identity.resetPassword(pool, user?.cognitoSub, code, password);
    } catch (e) {
      if (!(e instanceof AuthFlowError)) throw e;
      await this.log(place, RESET_FAILED, { type: 'login' }, { emailKey, pool });
      throw httpError('RESET_CODE_INVALID');
    }
  }

  /**
   * A keyed hash, so the audit log never holds the email itself. A client has a login per firm,
   * so on a portal the key is per firm and email.
   */
  private emailKey(place: Pick<SignInPlace, 'pool' | 'businessId'>, email: string): string {
    const key = this.emailKeys[place.pool];
    if (!key) throw new Error(`No email key for the ${place.pool} pool`);
    const input = place.businessId ? `${place.businessId}:${email}` : email;
    return createHmac('sha256', key).update(input).digest('hex');
  }

  private failures(place: Pick<SignInPlace, 'businessId'>, field: string, value: string) {
    return this.count(place, SIGN_IN_FAILED, field, value, SIGN_IN_LIMIT.windowMs);
  }

  private failed(
    place: Pick<SignInPlace, 'pool' | 'businessId'>,
    metadata: { emailKey?: string; attemptId?: string; step: 'password' | 'mfa' },
  ): Promise<void> {
    return this.log(place, SIGN_IN_FAILED, { type: 'login' }, { ...metadata, pool: place.pool });
  }

  private succeeded(place: Pick<SignInPlace, 'pool' | 'businessId'>, userId: string) {
    return this.log(
      place,
      'auth.signed_in',
      { type: 'user', id: userId },
      { pool: place.pool },
      { userId, pool: place.pool },
    );
  }

  /**
   * Rows of one action in the window with this metadata value, where `log` writes them: the
   * firm's own log on its portal, the platform's otherwise. The (business_id, created_at) index
   * keeps each count to the window's rows.
   */
  private count(
    place: Pick<SignInPlace, 'businessId'>,
    action: string,
    field: string,
    value: string,
    windowMs: number,
  ): Promise<number> {
    const where = {
      action,
      createdAt: { gt: new Date(Date.now() - windowMs) },
      metadata: { path: [field], equals: value },
    };
    return place.businessId
      ? this.db
          .forBusiness(place.businessId)
          .auditLog.count({ where: { ...where, businessId: place.businessId } })
      : this.db.forPlatform().auditLog.count({ where: { ...where, businessId: null } });
  }

  /**
   * Audits a sign-in event: a client's portal events in the firm's log, staff and Super Admin
   * events in the platform's. `actor` is the person signing in (these routes are signed out).
   */
  private log(
    place: Pick<SignInPlace, 'businessId'>,
    action: string,
    entity: AuditEntity,
    metadata: Record<string, unknown>,
    actor?: Pick<AuthContext, 'userId' | 'pool'>,
  ): Promise<void> {
    const store = requestContext.getStore() ?? { requestId: randomUUID() };
    return requestContext.run(
      {
        ...store,
        auth: actor ? { ...actor, cognitoSub: '' } : store.auth,
        // AuditService reads only the firm id from the tenant context.
        tenant: place.businessId
          ? { businessId: place.businessId, role: 'STAFF', kind: 'staff' }
          : undefined,
      },
      () => this.audit.log(action, entity, metadata),
    );
  }

  /**
   * Exactly one user of the pool with this email; on the admin site also a platform admin; on a
   * firm's portal, that firm's client who may sign in.
   */
  private async findUser(
    place: SignInPlace,
    email: string,
  ): Promise<{ id: string; cognitoSub: string } | undefined> {
    const { pool } = place;
    if (place.businessId) {
      const client = await portalClient(this.db, place.businessId, { email });
      return client && { id: client.userId, cognitoSub: client.cognitoSub };
    }
    const platform = this.db.forPlatform();
    const users = await platform.user.findMany({
      where: { email, pool },
      select: { id: true, cognitoSub: true },
      take: 2,
    });
    const user = users.length === 1 ? users[0] : undefined;
    if (!user || pool !== 'ADMIN') return user;
    const admin = await platform.platformAdmin.findUnique({
      where: { userId: user.id },
      select: { userId: true },
    });
    return admin ? user : undefined;
  }

  private async next(
    step: AuthStep,
    userId: string,
    place: Pick<SignInPlace, 'pool' | 'businessId'>,
    emailKey: string,
  ): Promise<SignInOutcome> {
    const { pool, businessId } = place;
    if (step.kind === 'tokens') {
      if (MFA_REQUIRED.has(pool)) {
        // Defence in depth: only the pool setting makes Cognito ask for MFA. If it ever signs
        // someone in without it, end that session and answer 500 (a configuration fault).
        if (step.tokens.refreshToken) await this.identity.revoke(pool, step.tokens.refreshToken);
        throw new Error(`Refused a ${pool} sign-in that skipped MFA: check the pool's MFA setting`);
      }
      await this.succeeded(place, userId);
      return { kind: 'signed-in', userId, username: step.username, tokens: step.tokens };
    }
    const session = await this.challenges.seal({
      userId,
      username: step.username,
      session: step.session,
      step: step.step,
      pool,
      ...(businessId ? { businessId } : {}),
      emailKey,
      attemptId: randomUUID(),
    });
    const status = step.step === 'MFA' ? 'MFA_REQUIRED' : 'MFA_SETUP_REQUIRED';
    return { kind: 'step', result: { status, session } };
  }

  private async open(session: string, place: SignInPlace) {
    const challenge = await this.challenges.open(session, place.pool, place.businessId);
    if (!challenge) throw httpError('CHALLENGE_EXPIRED');
    return challenge;
  }
}

export function otpauthUri(issuer: string, email: string, secret: string): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
