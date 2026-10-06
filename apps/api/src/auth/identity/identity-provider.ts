import type { IdentityPool } from '@firmivra/types';
import type { SessionTokens } from '../site.js';

/** Nest injection token for the IdentityProvider picked by AUTH_MODE. */
export const IDENTITY_PROVIDER = Symbol('IDENTITY_PROVIDER');

/** Signed in, or the next challenge with the provider's session and the user's provider username. */
export type AuthStep =
  | { kind: 'tokens'; tokens: SessionTokens; username: string }
  | { kind: 'challenge'; step: 'MFA' | 'MFA_SETUP'; username: string; session: string };

export type AuthFlowErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'MFA_CODE_INVALID'
  | 'CHALLENGE_EXPIRED'
  | 'RATE_LIMITED'
  | 'SESSION_EXPIRED'
  | 'RESET_CODE_INVALID'
  | 'PASSWORD_REJECTED';

export interface NewUserContact {
  /** E.164. */
  phone?: string;
  /** Default true (staff invites). */
  emailVerified?: boolean;
}

export interface ContactUpdate {
  email?: string;
  emailVerified?: boolean;
  /** E.164. */
  phone?: string;
  phoneVerified?: boolean;
}

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
  /** New access and id tokens (and a new refresh token if rotated). Throws SESSION_EXPIRED. */
  refresh(pool: IdentityPool, username: string, refreshToken: string): Promise<SessionTokens>;
  /** Revokes one refresh token (this device). Never throws: sign-out always succeeds. */
  revoke(pool: IdentityPool, refreshToken: string): Promise<void>;
  /** Ends every session of the person, on every device. Never throws. */
  signOutEverywhere(pool: IdentityPool, username: string): Promise<void>;
  /** Emails a reset code. Same outcome whether or not `sub` exists; never throws for that. */
  forgotPassword(pool: IdentityPool, sub: string | undefined): Promise<void>;
  /**
   * Sets a new password with the emailed code, then ends every session. Throws
   * RESET_CODE_INVALID (also for an unknown user) or PASSWORD_REJECTED.
   */
  resetPassword(
    pool: IdentityPool,
    sub: string | undefined,
    code: string,
    password: string,
  ): Promise<void>;
  /**
   * A new login with no usable password yet. Sends no email or SMS. Returns its `sub`.
   * Staff invites: the email counts as verified. Client sign-up: unverified until our codes match.
   */
  createUser(pool: IdentityPool, email: string, contact?: NewUserContact): Promise<string>;
  /** Changes the login's email or phone, or marks them verified (client sign-up). */
  updateContact(pool: IdentityPool, sub: string, contact: ContactUpdate): Promise<void>;
  /** Sets the first password (activation). Throws PASSWORD_REJECTED. */
  setPassword(pool: IdentityPool, sub: string, password: string): Promise<void>;
  /** Whether the login has a password, i.e. the person can already sign in. */
  hasPassword(pool: IdentityPool, sub: string): Promise<boolean>;
}
