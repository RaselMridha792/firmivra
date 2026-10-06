import { randomUUID } from 'node:crypto';
import type { IdentityPool } from '@firmivra/types';
import type { SessionTokens } from '../site.js';
import type { TokenService } from '../token.service.js';
import { AuthFlowError, type AuthStep, type IdentityProvider } from './identity-provider.js';

/**
 * AUTH_MODE=local only (development and test, synthetic seeded users; the config refuses local
 * mode in production). Not secrets: they open nothing outside a developer's machine.
 */
export const LOCAL_PASSWORD = 'Firmivra-local-1';
export const LOCAL_MFA_CODE = '000000';
/** The reset code for every forgot-password request (nothing is emailed locally). */
export const LOCAL_RESET_CODE = '000000';
/** A well-known example TOTP key, so the setup screen has a real QR code to show. */
export const LOCAL_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

/**
 * Local stand-in for Cognito: same steps and errors, so the screens run end to end without AWS.
 * Each user's first sign-in after the API starts asks for authenticator setup; later ones for a code.
 * Passwords set by reset or activation last until the API restarts (then the dev password works
 * again). Refresh tokens are not revoked locally.
 */
export class LocalIdentityProvider implements IdentityProvider {
  private readonly mfaReady = new Set<string>();
  /** Passwords changed with reset-password or set at activation, by sub. */
  private readonly passwords = new Map<string, string>();
  /** Logins created by an invite: no password until activation (seeded users have the dev one). */
  private readonly invited = new Set<string>();
  private readonly disabled = new Set<string>();

  constructor(private readonly tokens: TokenService) {}

  signIn(_pool: IdentityPool, sub: string | undefined, password: string): Promise<AuthStep> {
    const expected =
      this.passwords.get(sub ?? '') ?? (this.invited.has(sub ?? '') ? undefined : LOCAL_PASSWORD);
    if (!sub || password !== expected || this.disabled.has(sub)) {
      return Promise.reject(new AuthFlowError('INVALID_CREDENTIALS'));
    }
    const step = this.mfaReady.has(sub) ? 'MFA' : 'MFA_SETUP';
    return Promise.resolve({ kind: 'challenge', step, username: sub, session: randomUUID() });
  }

  async answerMfa(
    pool: IdentityPool,
    username: string,
    _session: string,
    code: string,
  ): Promise<SessionTokens> {
    if (code !== LOCAL_MFA_CODE) throw new AuthFlowError('MFA_CODE_INVALID');
    return this.issue(username, pool);
  }

  startMfaSetup(): Promise<{ session: string; secret: string }> {
    return Promise.resolve({ session: randomUUID(), secret: LOCAL_TOTP_SECRET });
  }

  async finishMfaSetup(
    pool: IdentityPool,
    username: string,
    _session: string,
    code: string,
  ): Promise<SessionTokens> {
    if (code !== LOCAL_MFA_CODE) throw new AuthFlowError('MFA_CODE_INVALID');
    this.mfaReady.add(username);
    return this.issue(username, pool);
  }

  async refresh(pool: IdentityPool, username: string): Promise<SessionTokens> {
    const { token, expiresIn } = await this.tokens.signLocal(username, pool);
    return { accessToken: token, expiresIn };
  }

  revoke(): Promise<void> {
    return Promise.resolve();
  }

  signOutEverywhere(): Promise<void> {
    return Promise.resolve();
  }

  forgotPassword(): Promise<void> {
    return Promise.resolve();
  }

  resetPassword(
    _pool: IdentityPool,
    sub: string | undefined,
    code: string,
    password: string,
  ): Promise<void> {
    if (!sub || code !== LOCAL_RESET_CODE) {
      return Promise.reject(new AuthFlowError('RESET_CODE_INVALID'));
    }
    this.passwords.set(sub, password);
    return Promise.resolve();
  }

  createUser(): Promise<string> {
    const sub = randomUUID();
    this.invited.add(sub);
    return Promise.resolve(sub);
  }

  setPassword(_pool: IdentityPool, sub: string, password: string): Promise<void> {
    this.passwords.set(sub, password);
    this.invited.delete(sub);
    return Promise.resolve();
  }

  hasPassword(_pool: IdentityPool, sub: string): Promise<boolean> {
    return Promise.resolve(!this.invited.has(sub));
  }

  disableUser(_pool: IdentityPool, sub: string): Promise<void> {
    this.disabled.add(sub);
    return Promise.resolve();
  }

  private async issue(sub: string, pool: IdentityPool): Promise<SessionTokens> {
    const { token, expiresIn } = await this.tokens.signLocal(sub, pool);
    // The refresh token only has to exist: the sealed envelope around it is what is checked.
    return { accessToken: token, refreshToken: `local-${randomUUID()}`, expiresIn };
  }
}
