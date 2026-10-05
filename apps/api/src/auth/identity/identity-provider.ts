import type { IdentityPool } from '@firmivra/types';
import type { SessionTokens } from '../site.js';

/** Nest injection token for the IdentityProvider picked by AUTH_MODE. */
export const IDENTITY_PROVIDER = Symbol('IDENTITY_PROVIDER');

/** Signed in, or the next challenge with the provider's session and the user's provider username. */
export type AuthStep =
  | { kind: 'tokens'; tokens: SessionTokens }
  | { kind: 'challenge'; step: 'MFA' | 'MFA_SETUP'; username: string; session: string };

export type AuthFlowErrorCode =
  'INVALID_CREDENTIALS' | 'MFA_CODE_INVALID' | 'CHALLENGE_EXPIRED' | 'RATE_LIMITED';

/** An expected sign-in failure. Anything else a provider throws is a 500. */
export class AuthFlowError extends Error {
  constructor(readonly code: AuthFlowErrorCode) {
    super(code);
    this.name = 'AuthFlowError';
  }
}

/**
 * Talks to the identity service: Cognito in AWS, a local stand-in in development
 * (docs/AUTH-DESIGN.md). It only proves who someone is; firm and role come from our database.
 */
export interface IdentityProvider {
  /**
   * `sub` is undefined when we have no such user: the provider still does the same work, so the
   * answer time does not reveal which emails have accounts. Throws INVALID_CREDENTIALS.
   */
  signIn(pool: IdentityPool, sub: string | undefined, password: string): Promise<AuthStep>;
  /** Answers MFA with an authenticator code. */
  answerMfa(
    pool: IdentityPool,
    username: string,
    session: string,
    code: string,
  ): Promise<SessionTokens>;
  /** Starts authenticator setup: the secret to show, and the session for finishMfaSetup. */
  startMfaSetup(
    pool: IdentityPool,
    username: string,
    session: string,
  ): Promise<{ session: string; secret: string }>;
  /** Checks the first code from the new authenticator and completes sign-in. */
  finishMfaSetup(
    pool: IdentityPool,
    username: string,
    session: string,
    code: string,
  ): Promise<SessionTokens>;
}
