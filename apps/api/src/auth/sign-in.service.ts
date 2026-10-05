import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import type { AuthSite, IdentityPool, MfaSetupResponse, SignInResult } from '@firmivra/types';
import { DATABASE } from '../database/database.module.js';
import { httpError, runFlow } from './auth-errors.js';
import { ChallengeSessions } from './challenge-session.js';
import {
  type AuthStep,
  IDENTITY_PROVIDER,
  type IdentityProvider,
} from './identity/identity-provider.js';
import { type SessionTokens, SIGN_IN_POOL } from './site.js';

const TOTP_ISSUER: Record<AuthSite, string> = { firm: 'Firmivra', admin: 'Firmivra Admin' };

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
 * Staff and Super Admin sign-in (docs/api/auth.yaml): password, then MFA or first-time MFA setup;
 * forgot and reset password. Errors never reveal whether an account exists.
 */
@Injectable()
export class SignInService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
    private readonly challenges: ChallengeSessions,
  ) {}

  async signIn(site: AuthSite, email: string, password: string): Promise<SignInOutcome> {
    const pool = SIGN_IN_POOL[site];
    const user = await this.findUser(pool, email);
    const step = await runFlow(() => this.identity.signIn(pool, user?.cognitoSub, password));
    if (!user) throw httpError('INVALID_CREDENTIALS');
    return this.next(step, user.id, pool);
  }

  async mfa(site: AuthSite, session: string, code: string): Promise<SignInOutcome> {
    const pool = SIGN_IN_POOL[site];
    const c = await this.open(session, pool);
    if (c.step === 'MFA_SETUP') throw wrongStep();
    const tokens = await runFlow(() =>
      c.step === 'MFA'
        ? this.identity.answerMfa(pool, c.username, c.session, code)
        : this.identity.finishMfaSetup(pool, c.username, c.session, code),
    );
    return { kind: 'signed-in', userId: c.userId, username: c.username, tokens };
  }

  async startMfaSetup(site: AuthSite, session: string): Promise<MfaSetupResponse> {
    const pool = SIGN_IN_POOL[site];
    const c = await this.open(session, pool);
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
      otpauthUri: otpauthUri(TOTP_ISSUER[site], user.email, setup.secret),
    };
  }

  /** Emails a reset code when the account exists; the answer is the same either way. */
  async forgotPassword(site: AuthSite, email: string): Promise<void> {
    const pool = SIGN_IN_POOL[site];
    const user = await this.findUser(pool, email);
    await this.identity.forgotPassword(pool, user?.cognitoSub);
  }

  /** Sets the new password with the emailed code; Cognito then ends every session. */
  async resetPassword(
    site: AuthSite,
    email: string,
    code: string,
    password: string,
  ): Promise<void> {
    const pool = SIGN_IN_POOL[site];
    const user = await this.findUser(pool, email);
    await runFlow(() => this.identity.resetPassword(pool, user?.cognitoSub, code, password));
  }

  /** Exactly one user of the pool with this email; on the admin site also a platform admin. */
  private async findUser(pool: IdentityPool, email: string) {
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

  private async next(step: AuthStep, userId: string, pool: IdentityPool): Promise<SignInOutcome> {
    if (step.kind === 'tokens') {
      return { kind: 'signed-in', userId, username: step.username, tokens: step.tokens };
    }
    const session = await this.challenges.seal({
      userId,
      username: step.username,
      session: step.session,
      step: step.step,
      pool,
    });
    const status = step.step === 'MFA' ? 'MFA_REQUIRED' : 'MFA_SETUP_REQUIRED';
    return { kind: 'step', result: { status, session } };
  }

  private async open(session: string, pool: IdentityPool) {
    const challenge = await this.challenges.open(session, pool);
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
