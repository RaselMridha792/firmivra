import { createHmac, randomUUID } from 'node:crypto';
import {
  AdminGetUserCommand,
  AdminInitiateAuthCommand,
  AdminRespondToAuthChallengeCommand,
  AssociateSoftwareTokenCommand,
  type AuthenticationResultType,
  type CognitoIdentityProviderClient,
  VerifySoftwareTokenCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { Logger } from '@nestjs/common';
import type { IdentityPool } from '@firmivra/types';
import type { Env } from '../../config/env.js';
import type { SessionTokens } from '../site.js';
import {
  AuthFlowError,
  type AuthFlowErrorCode,
  type AuthStep,
  type IdentityProvider,
} from './identity-provider.js';

export type CognitoClient = Pick<CognitoIdentityProviderClient, 'send'>;

export interface CognitoPool {
  userPoolId: string;
  clientId: string;
  clientSecret: string;
}

export function cognitoPoolsFromEnv(env: Env): Partial<Record<IdentityPool, CognitoPool>> {
  const pool = (userPoolId?: string, clientId?: string, clientSecret?: string) =>
    userPoolId && clientId && clientSecret ? { userPoolId, clientId, clientSecret } : undefined;
  return {
    STAFF: pool(
      env.COGNITO_STAFF_USER_POOL_ID,
      env.COGNITO_STAFF_CLIENT_ID,
      env.COGNITO_STAFF_CLIENT_SECRET,
    ),
    CLIENT: pool(
      env.COGNITO_CLIENTS_USER_POOL_ID,
      env.COGNITO_CLIENTS_CLIENT_ID,
      env.COGNITO_CLIENTS_CLIENT_SECRET,
    ),
    ADMIN: pool(
      env.COGNITO_ADMINS_USER_POOL_ID,
      env.COGNITO_ADMINS_CLIENT_ID,
      env.COGNITO_ADMINS_CLIENT_SECRET,
    ),
  };
}

const THROTTLED = new Set([
  'TooManyRequestsException',
  'LimitExceededException',
  'TooManyFailedAttemptsException',
]);

/** Maps Cognito's error names to our codes; anything not listed is rethrown as a 500. */
function fail(error: unknown, codes: Record<string, AuthFlowErrorCode>): never {
  const name = error instanceof Error ? error.name : '';
  if (THROTTLED.has(name)) throw new AuthFlowError('RATE_LIMITED');
  const code = codes[name];
  if (code) throw new AuthFlowError(code);
  throw error;
}

const SIGN_IN_ERRORS: Record<string, AuthFlowErrorCode> = {
  NotAuthorizedException: 'INVALID_CREDENTIALS',
  UserNotFoundException: 'INVALID_CREDENTIALS',
  UserNotConfirmedException: 'INVALID_CREDENTIALS',
  PasswordResetRequiredException: 'INVALID_CREDENTIALS',
};
const CODE_ERRORS: Record<string, AuthFlowErrorCode> = {
  CodeMismatchException: 'MFA_CODE_INVALID',
  ExpiredCodeException: 'MFA_CODE_INVALID',
  EnableSoftwareTokenMFAException: 'MFA_CODE_INVALID',
  // Cognito's answer once the 3-minute session is gone or used up.
  NotAuthorizedException: 'CHALLENGE_EXPIRED',
};

/**
 * Cognito user pools through the API's confidential app clients (ADMIN_USER_PASSWORD_AUTH with
 * the client secret). Usernames are UUIDs Cognito knows; we store the `sub`, which AdminGetUser
 * accepts in place of the username.
 */
export class CognitoIdentityProvider implements IdentityProvider {
  private readonly logger = new Logger(CognitoIdentityProvider.name);

  constructor(
    private readonly client: CognitoClient,
    private readonly pools: Partial<Record<IdentityPool, CognitoPool>>,
  ) {}

  async signIn(pool: IdentityPool, sub: string | undefined, password: string): Promise<AuthStep> {
    const p = this.pool(pool);
    // Unknown emails make the same two calls with a random user, so timing reveals nothing.
    const username = (await this.usernameFor(p, sub ?? randomUUID())) ?? randomUUID();
    const out = await this.client
      .send(
        new AdminInitiateAuthCommand({
          UserPoolId: p.userPoolId,
          ClientId: p.clientId,
          AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
          AuthParameters: {
            USERNAME: username,
            PASSWORD: password,
            SECRET_HASH: secretHash(p, username),
          },
        }),
      )
      .catch((e: unknown) => fail(e, SIGN_IN_ERRORS));

    if (out.AuthenticationResult) {
      return { kind: 'tokens', tokens: toTokens(out.AuthenticationResult) };
    }
    if (out.Session && out.ChallengeName === 'SOFTWARE_TOKEN_MFA') {
      return { kind: 'challenge', step: 'MFA', username, session: out.Session };
    }
    if (out.Session && out.ChallengeName === 'MFA_SETUP') {
      return { kind: 'challenge', step: 'MFA_SETUP', username, session: out.Session };
    }
    // For example NEW_PASSWORD_REQUIRED for a user created by hand in the console.
    this.logger.warn(`Sign-in stopped at an unsupported Cognito challenge: ${out.ChallengeName}`);
    throw new AuthFlowError('INVALID_CREDENTIALS');
  }

  async answerMfa(
    pool: IdentityPool,
    username: string,
    session: string,
    code: string,
  ): Promise<SessionTokens> {
    const p = this.pool(pool);
    const out = await this.client
      .send(
        new AdminRespondToAuthChallengeCommand({
          UserPoolId: p.userPoolId,
          ClientId: p.clientId,
          ChallengeName: 'SOFTWARE_TOKEN_MFA',
          Session: session,
          ChallengeResponses: {
            USERNAME: username,
            SOFTWARE_TOKEN_MFA_CODE: code,
            SECRET_HASH: secretHash(p, username),
          },
        }),
      )
      .catch((e: unknown) => fail(e, CODE_ERRORS));
    return this.signedIn(out.AuthenticationResult);
  }

  async startMfaSetup(
    pool: IdentityPool,
    _username: string,
    session: string,
  ): Promise<{ session: string; secret: string }> {
    this.pool(pool);
    const out = await this.client
      .send(new AssociateSoftwareTokenCommand({ Session: session }))
      .catch((e: unknown) => fail(e, CODE_ERRORS));
    if (!out.SecretCode || !out.Session) throw new AuthFlowError('CHALLENGE_EXPIRED');
    return { session: out.Session, secret: out.SecretCode };
  }

  async finishMfaSetup(
    pool: IdentityPool,
    username: string,
    session: string,
    code: string,
  ): Promise<SessionTokens> {
    const p = this.pool(pool);
    const verified = await this.client
      .send(
        new VerifySoftwareTokenCommand({
          Session: session,
          UserCode: code,
          FriendlyDeviceName: 'Authenticator app',
        }),
      )
      .catch((e: unknown) => fail(e, CODE_ERRORS));
    if (verified.Status !== 'SUCCESS' || !verified.Session) {
      throw new AuthFlowError('MFA_CODE_INVALID');
    }
    const out = await this.client
      .send(
        new AdminRespondToAuthChallengeCommand({
          UserPoolId: p.userPoolId,
          ClientId: p.clientId,
          ChallengeName: 'MFA_SETUP',
          Session: verified.Session,
          ChallengeResponses: { USERNAME: username, SECRET_HASH: secretHash(p, username) },
        }),
      )
      .catch((e: unknown) => fail(e, CODE_ERRORS));
    return this.signedIn(out.AuthenticationResult);
  }

  /** The Cognito username for a sub, or undefined for an unknown or disabled user. */
  private async usernameFor(p: CognitoPool, sub: string): Promise<string | undefined> {
    const user = await this.client
      .send(new AdminGetUserCommand({ UserPoolId: p.userPoolId, Username: sub }))
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === 'UserNotFoundException') return undefined;
        return fail(e, {});
      });
    return user?.Enabled === false ? undefined : user?.Username;
  }

  private signedIn(result: AuthenticationResultType | undefined): SessionTokens {
    if (!result) {
      this.logger.warn('Cognito answered a challenge without tokens');
      throw new AuthFlowError('CHALLENGE_EXPIRED');
    }
    return toTokens(result);
  }

  private pool(pool: IdentityPool): CognitoPool {
    const p = this.pools[pool];
    if (!p) throw new Error(`Cognito is not configured for the ${pool} pool`);
    return p;
  }
}

/** SECRET_HASH for app clients with a secret: Base64(HMAC-SHA256(secret, username + clientId)). */
export function secretHash(p: CognitoPool, username: string): string {
  return createHmac('sha256', p.clientSecret)
    .update(username + p.clientId)
    .digest('base64');
}

function toTokens(result: AuthenticationResultType): SessionTokens {
  if (!result.AccessToken) throw new Error('Cognito returned no access token');
  return {
    accessToken: result.AccessToken,
    idToken: result.IdToken,
    refreshToken: result.RefreshToken,
    expiresIn: result.ExpiresIn ?? 900,
  };
}
