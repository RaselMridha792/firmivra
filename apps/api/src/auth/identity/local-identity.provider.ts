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
/** A well-known example TOTP key, so the setup screen has a real QR code to show. */
export const LOCAL_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

/**
 * Local stand-in for Cognito: same steps and errors, so the screens run end to end without AWS.
 * Each user's first sign-in after the API starts asks for authenticator setup; later ones for a code.
 */
export class LocalIdentityProvider implements IdentityProvider {
  private readonly mfaReady = new Set<string>();

  constructor(private readonly tokens: TokenService) {}

  signIn(_pool: IdentityPool, sub: string | undefined, password: string): Promise<AuthStep> {
    if (!sub || password !== LOCAL_PASSWORD) {
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

  private async issue(sub: string, pool: IdentityPool): Promise<SessionTokens> {
    const { token, expiresIn } = await this.tokens.signLocal(sub, pool);
    return { accessToken: token, expiresIn };
  }
}
