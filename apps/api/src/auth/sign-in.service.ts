import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Database } from '@firmivra/db';
import type { AuthSite, IdentityPool, MfaSetupResponse, SignInResult } from '@firmivra/types';
import { DATABASE } from '../database/database.module.js';
import { ChallengeSessions } from './challenge-session.js';
import {
  AuthFlowError,
  type AuthStep,
  IDENTITY_PROVIDER,
  type IdentityProvider,
} from './identity/identity-provider.js';
import type { SessionTokens } from './site.js';

/** Who signs in on each site's /auth routes. Clients sign in on the portal (R3). */
const SITE_POOL: Record<AuthSite, IdentityPool> = { firm: 'STAFF', admin: 'ADMIN' };
const TOTP_ISSUER: Record<AuthSite, string> = { firm: 'Firmivra', admin: 'Firmivra Admin' };

/** The next step for the browser, or tokens for the controller to put in cookies. */
export type SignInOutcome =
  | { kind: 'step'; result: Exclude<SignInResult, { status: 'SIGNED_IN' }> }
  | { kind: 'signed-in'; userId: string; tokens: SessionTokens };

const ERRORS = {
  INVALID_CREDENTIALS: () =>
    new UnauthorizedException({
      code: 'INVALID_CREDENTIALS',
      message: 'Email or password is incorrect',
    }),
  MFA_CODE_INVALID: () =>
    new UnauthorizedException({ code: 'MFA_CODE_INVALID', message: 'That code is not right' }),
  CHALLENGE_EXPIRED: () =>
    new UnauthorizedException({
      code: 'CHALLENGE_EXPIRED',
      message: 'Sign-in timed out. Please sign in again.',
    }),
  RATE_LIMITED: () =>
    new HttpException(
      { code: 'RATE_LIMITED', message: 'Too many attempts. Wait a few minutes and try again.' },
      HttpStatus.TOO_MANY_REQUESTS,
    ),
} as const;

const wrongStep = () =>
  new BadRequestException({
    code: 'VALIDATION_FAILED',
    message: 'This sign-in step does not take that request. Follow the status from the last step.',
  });

/**
 * Staff and Super Admin sign-in (docs/api/auth.yaml): password, then MFA or first-time MFA setup.
 * Errors never reveal whether an account exists.
 */
@Injectable()
export class SignInService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
    private readonly challenges: ChallengeSessions,
  ) {}

  async signIn(site: AuthSite, email: string, password: string): Promise<SignInOutcome> {
    const pool = SITE_POOL[site];
    const user = await this.findUser(pool, email);
    const step = await this.run(() => this.identity.signIn(pool, user?.cognitoSub, password));
    if (!user) throw ERRORS.INVALID_CREDENTIALS();
    return this.next(step, user.id, pool);
  }

  async mfa(site: AuthSite, session: string, code: string): Promise<SignInOutcome> {
    const pool = SITE_POOL[site];
    const c = await this.open(session, pool);
    if (c.step === 'MFA_SETUP') throw wrongStep();
    const tokens = await this.run(() =>
      c.step === 'MFA'
        ? this.identity.answerMfa(pool, c.username, c.session, code)
        : this.identity.finishMfaSetup(pool, c.username, c.session, code),
    );
    return { kind: 'signed-in', userId: c.userId, tokens };
  }

  async startMfaSetup(site: AuthSite, session: string): Promise<MfaSetupResponse> {
    const pool = SITE_POOL[site];
    const c = await this.open(session, pool);
    if (c.step !== 'MFA_SETUP') throw wrongStep();
    const setup = await this.run(() => this.identity.startMfaSetup(pool, c.username, c.session));
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
    if (step.kind === 'tokens') return { kind: 'signed-in', userId, tokens: step.tokens };
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
    if (!challenge) throw ERRORS.CHALLENGE_EXPIRED();
    return challenge;
  }

  /** Runs a provider call and turns its expected failures into API errors. */
  private async run<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (e) {
      if (e instanceof AuthFlowError) throw ERRORS[e.code]();
      throw e;
    }
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
