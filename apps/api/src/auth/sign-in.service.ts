import { createHmac, randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { type Database, Prisma } from '@firmivra/db';
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
const RESET = {
  attempt: 'auth.password_reset_attempt',
  passed: 'auth.password_reset_passed',
  released: 'auth.password_reset_released',
};
export const RESET_LIMIT = { attempts: 5, windowMs: 15 * 60_000 };
/**
 * Every failed sign-in, a wrong password or a wrong MFA code, is audited, and these limits count
 * those rows, so every API task shares them (R2 step 7). Real and unknown emails count alike.
 */
const SIGN_IN_FAILED = 'auth.sign_in_failed';
/**
 * Each attempt is recorded before Cognito is asked (its `reservationId` in the row), then closed
 * by a "passed" row with the same id when it succeeds, or a "released" row when it ends without a
 * verdict on the credential (its own action, so the audit log never reads "passed" for it); an
 * attempt with neither is a failure or still in flight, and the limits count those.
 */
const SIGN_IN = {
  attempt: 'auth.sign_in_attempt',
  passed: 'auth.sign_in_passed',
  released: 'auth.sign_in_released',
};
type Actions = { attempt: string; passed: string; released: string };
/** One limit an attempt must stay under: the open attempts (failed or in flight) with this value. */
type LimitCheck = {
  field: 'emailKey' | 'attemptId';
  value: string;
  limit: number;
  windowMs: number;
  refuse: () => Error;
};
export const SIGN_IN_LIMIT = {
  /** Failures for one email (per firm on a portal) in the window, then 429 RATE_LIMITED. */
  perEmail: 10,
  /** Wrong MFA codes in one sign-in attempt, then CHALLENGE_EXPIRED: sign in again. */
  perAttempt: 5,
  windowMs: 15 * 60_000,
};
/**
 * One check's open attempts in its window, as SQL: the reservations with an attempt row and no
 * "passed" or "released" row (all carry the check's value). One pass over the window per check,
 * and the reserve counts every check in one statement that returns numbers, never rows, so its
 * transaction stays short under bursts (#84 review). Rows written before the key's rename to
 * `reservationId` say `token` (#84 follow-up); both are read, and the old ones age out with their
 * window.
 */
function openAttempts(businessId: string | null, actions: Actions, check: LimitCheck) {
  const inScope = businessId
    ? Prisma.sql`business_id = ${businessId}::uuid`
    : Prisma.sql`business_id IS NULL`;
  const [attempt, passed, released] = [actions.attempt, actions.passed, actions.released].map(
    literal,
  );
  return Prisma.sql`(
    SELECT count(*) FROM (
      SELECT 1 FROM audit_logs
      WHERE ${inScope}
        AND created_at > now() - ${check.windowMs}::int * interval '1 millisecond'
        AND action IN (${attempt}, ${passed}, ${released})
        AND ${KEY_SQL[check.field]} = ${check.value}
      GROUP BY coalesce(metadata ->> 'reservationId', metadata ->> 'token')
      HAVING bool_and(action = ${attempt})
    ) open)`;
}
/**
 * The key and the actions are SQL literals, never parameters: R0's partial indexes on
 * audit_logs (one per key, WHERE action IN the six attempt, passed and released actions) only match a
 * query whose expression and action list the planner can read (#84 follow-up). The value, the
 * window and the firm stay parameters.
 */
const KEY_SQL: Record<LimitCheck['field'], Prisma.Sql> = {
  emailKey: Prisma.sql`metadata ->> 'emailKey'`,
  attemptId: Prisma.sql`metadata ->> 'attemptId'`,
};
function literal(action: string): Prisma.Sql {
  if (!/^[a-z_.]+$/.test(action)) throw new Error(`Not an action name: ${action}`);
  return Prisma.raw(`'${action}'`);
}
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
  private readonly logger = new Logger(SignInService.name);
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
   * Checks the password. An email at SIGN_IN_LIMIT.perEmail failures (and attempts in flight) in
   * the window is 429 before Cognito is asked, whether or not it has an account; each attempt is
   * reserved first and each wrong password audited.
   */
  async signIn(place: SignInPlace, email: string, password: string): Promise<SignInOutcome> {
    const emailKey = this.emailKey(place, email);
    const reservationId = await this.reserve(
      place,
      SIGN_IN,
      `fv-sign-in:${emailKey}`,
      [this.perEmail(emailKey)],
      {
        emailKey,
        step: 'password',
      },
    );
    const user = await this.findUser(place, email);
    let step: AuthStep;
    try {
      step = await this.identity.signIn(place.pool, user?.cognitoSub, password);
      if (!user) throw new AuthFlowError('INVALID_CREDENTIALS');
      await this.passed(place, SIGN_IN, { emailKey, reservationId });
    } catch (e) {
      if (!(e instanceof AuthFlowError)) {
        await this.release(place, SIGN_IN, { emailKey, reservationId }, e);
        throw e;
      }
      if (e.code === 'INVALID_CREDENTIALS') {
        await this.failed(place, { emailKey, step: 'password', reservationId });
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
    const checks: LimitCheck[] = [];
    if (c.attemptId) {
      checks.push({
        field: 'attemptId',
        value: c.attemptId,
        limit: SIGN_IN_LIMIT.perAttempt,
        windowMs: SIGN_IN_LIMIT.windowMs,
        refuse: () => httpError('CHALLENGE_EXPIRED'),
      });
    }
    if (c.emailKey) checks.push(this.perEmail(c.emailKey));
    const lockKey = c.emailKey
      ? `fv-sign-in:${c.emailKey}`
      : c.attemptId
        ? `fv-sign-in-attempt:${c.attemptId}`
        : undefined;
    const ids = {
      ...(c.emailKey ? { emailKey: c.emailKey } : {}),
      ...(c.attemptId ? { attemptId: c.attemptId } : {}),
    };
    // A challenge sealed before step 7 carries neither; it expires within minutes.
    const reservationId = lockKey
      ? await this.reserve(place, SIGN_IN, lockKey, checks, { ...ids, step: 'mfa' })
      : undefined;
    let tokens: SessionTokens;
    try {
      tokens = await (c.step === 'MFA'
        ? this.identity.answerMfa(pool, c.username, c.session, code)
        : this.identity.finishMfaSetup(pool, c.username, c.session, code));
      if (reservationId) await this.passed(place, SIGN_IN, { ...ids, reservationId });
    } catch (e) {
      // Only a wrong code counts. This step follows a right password, so releasing every other
      // outcome (an expired MFA session, Cognito busy, an error of ours) reveals nothing.
      if (e instanceof AuthFlowError && e.code === 'MFA_CODE_INVALID') {
        await this.failed(place, {
          ...ids,
          step: 'mfa',
          ...(reservationId ? { reservationId } : {}),
        });
      } else if (reservationId) {
        await this.release(place, SIGN_IN, { ...ids, reservationId }, e);
      }
      if (!(e instanceof AuthFlowError)) throw e;
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
    const reservationId = await this.reserve(
      place,
      RESET,
      `fv-reset:${emailKey}`,
      [
        {
          field: 'emailKey',
          value: emailKey,
          limit: RESET_LIMIT.attempts,
          windowMs: RESET_LIMIT.windowMs,
          refuse: () => httpError('RATE_LIMITED'),
        },
      ],
      { emailKey },
    );
    const user = await this.findUser(place, email);
    try {
      await this.identity.resetPassword(pool, user?.cognitoSub, code, password);
      await this.passed(place, RESET, { emailKey, reservationId });
    } catch (e) {
      if (!(e instanceof AuthFlowError)) {
        await this.release(place, RESET, { emailKey, reservationId }, e);
        throw e;
      }
      await this.log(place, RESET_FAILED, { type: 'login' }, { emailKey, pool, reservationId });
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

  /** The per-email sign-in limit for this email key. */
  private perEmail(emailKey: string): LimitCheck {
    return {
      field: 'emailKey',
      value: emailKey,
      limit: SIGN_IN_LIMIT.perEmail,
      windowMs: SIGN_IN_LIMIT.windowMs,
      refuse: () => httpError('RATE_LIMITED'),
    };
  }

  /**
   * Reserves one attempt before Cognito is asked (#70's lesson, applied to sign-in): in one
   * scoped transaction under a try-lock on `lockKey`, each check's open attempts in its window
   * (recorded, with no "passed" row: failed, or still in flight) must stay under its limit; then
   * this attempt is recorded. So parallel guesses can't all pass a count taken before any of them
   * failed. A busy key is refused like the limit (never waited for: a waiting lock holds a pooled
   * connection). The transaction is three short statements: the try-lock, one count for every
   * check (`openAttempts`), the insert. Rows go where `log` writes them: the firm's log on a
   * portal, the platform's otherwise. Returns the attempt's reservation id, which the row that
   * closes it carries.
   */
  private async reserve(
    place: Pick<SignInPlace, 'pool' | 'businessId'>,
    actions: Actions,
    lockKey: string,
    checks: LimitCheck[],
    metadata: Record<string, unknown>,
  ): Promise<string> {
    const reservationId = randomUUID();
    const businessId = place.businessId ?? null;
    const scope = place.businessId
      ? ({ kind: 'business', businessId: place.businessId } as const)
      : ({ kind: 'platform' } as const);
    const refusal = await this.db.withScope(scope, async (tx) => {
      const [locked] = await tx.$queryRaw<{ ok: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${lockKey}, 0)) AS ok`;
      if (locked?.ok !== true) return httpError('RATE_LIMITED');
      const counts = checks.map((check) => openAttempts(businessId, actions, check));
      const [counted] = await tx.$queryRaw<{ open: number[] }[]>`
        SELECT ARRAY[${Prisma.join(counts)}]::int[] AS open`;
      const over = checks.find((check, i) => (counted?.open[i] ?? 0) >= check.limit);
      if (over) return over.refuse();
      const store = requestContext.getStore();
      await tx.auditLog.create({
        data: {
          businessId,
          actorUserId: null,
          action: actions.attempt,
          entityType: 'login',
          entityId: null,
          metadata: { ...metadata, pool: place.pool, reservationId } as Prisma.InputJsonValue,
          ip: store?.ip ?? null,
          userAgent: store?.userAgent ?? null,
          requestId: store?.requestId ?? null,
        },
      });
      return null;
    });
    if (refusal) throw refusal;
    return reservationId;
  }

  /** The attempt succeeded: its "passed" row takes it out of the limits' count. */
  private passed(
    place: Pick<SignInPlace, 'pool' | 'businessId'>,
    actions: Actions,
    ids: { emailKey?: string; attemptId?: string; reservationId: string },
  ): Promise<void> {
    return this.log(place, actions.passed, { type: 'login' }, { ...ids, pool: place.pool });
  }

  /**
   * An outcome that says nothing about the credential: the attempt gets its "released" row, with
   * what happened, so it never counts against the limits (#84 follow-up). On the
   * password and reset steps only an error of ours or an outage does this; every answer from
   * Cognito still counts there, the same for real and unknown emails, so it reveals nothing. A
   * failure here is logged by the attempt's reservation id and never hides the original error.
   */
  private async release(
    place: Pick<SignInPlace, 'pool' | 'businessId'>,
    actions: Actions,
    ids: { emailKey?: string; attemptId?: string; reservationId: string },
    outcome: unknown,
  ): Promise<void> {
    const ended = outcome instanceof AuthFlowError ? outcome.code : 'ERROR';
    try {
      await this.log(
        place,
        actions.released,
        { type: 'login' },
        { ...ids, pool: place.pool, outcome: ended },
      );
    } catch {
      this.logger.warn(`Could not release sign-in attempt ${ids.reservationId}`);
    }
  }

  private failed(
    place: Pick<SignInPlace, 'pool' | 'businessId'>,
    metadata: {
      emailKey?: string;
      attemptId?: string;
      step: 'password' | 'mfa';
      reservationId?: string;
    },
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
