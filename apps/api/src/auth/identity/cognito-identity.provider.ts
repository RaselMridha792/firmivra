import { createHmac, randomUUID } from 'node:crypto';
import {
  AdminCreateUserCommand,
  AdminDisableUserCommand,
  AdminSetUserPasswordCommand,
  AdminInitiateAuthCommand,
  AdminRespondToAuthChallengeCommand,
  AdminUserGlobalSignOutCommand,
  AssociateSoftwareTokenCommand,
  type AuthenticationResultType,
  type CognitoIdentityProviderClient,
  ListUsersCommand,
  type UserType,
  ConfirmForgotPasswordCommand,
  ForgotPasswordCommand,
  RevokeTokenCommand,
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
const REFRESH_ERRORS: Record<string, AuthFlowErrorCode> = {
  NotAuthorizedException: 'SESSION_EXPIRED',
  UserNotFoundException: 'SESSION_EXPIRED',
};

const errorName = (e: unknown) => (e instanceof Error ? e.name : 'unknown error');

/**
 * Cognito user pools through the API's confidential app clients (ADMIN_USER_PASSWORD_AUTH with
 * the client secret). Usernames are UUIDs and the username is the pools' sign-in attribute, so the
 * Admin* calls need the username itself, not the `sub` we store (AdminGetUser takes a sub only
 * where the username is not a sign-in attribute). ListUsers finds the username by sub.
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
      return { kind: 'tokens', tokens: toTokens(out.AuthenticationResult), username };
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

  async refresh(
    pool: IdentityPool,
    username: string,
    refreshToken: string,
  ): Promise<SessionTokens> {
    const p = this.pool(pool);
    const out = await this.client
      .send(
        new AdminInitiateAuthCommand({
          UserPoolId: p.userPoolId,
          ClientId: p.clientId,
          AuthFlow: 'REFRESH_TOKEN_AUTH',
          // The hash uses the Cognito username, which is why the refresh envelope keeps it.
          AuthParameters: { REFRESH_TOKEN: refreshToken, SECRET_HASH: secretHash(p, username) },
        }),
      )
      .catch((e: unknown) => fail(e, REFRESH_ERRORS));
    if (!out.AuthenticationResult) throw new AuthFlowError('SESSION_EXPIRED');
    return toTokens(out.AuthenticationResult);
  }

  async revoke(pool: IdentityPool, refreshToken: string): Promise<void> {
    const p = this.pool(pool);
    await this.client
      .send(
        new RevokeTokenCommand({
          Token: refreshToken,
          ClientId: p.clientId,
          ClientSecret: p.clientSecret,
        }),
      )
      .catch((e: unknown) => this.logger.warn(`Refresh token not revoked: ${errorName(e)}`));
  }

  async signOutEverywhere(pool: IdentityPool, username: string): Promise<void> {
    const p = this.pool(pool);
    await this.client
      .send(new AdminUserGlobalSignOutCommand({ UserPoolId: p.userPoolId, Username: username }))
      .catch((e: unknown) => this.logger.warn(`Global sign-out failed: ${errorName(e)}`));
  }

  async forgotPassword(pool: IdentityPool, sub: string | undefined): Promise<void> {
    const p = this.pool(pool);
    const username = (await this.usernameFor(p, sub ?? randomUUID())) ?? randomUUID();
    // Every failure here can depend on whether the account exists, so none reaches the caller.
    await this.client
      .send(
        new ForgotPasswordCommand({
          ClientId: p.clientId,
          Username: username,
          SecretHash: secretHash(p, username),
        }),
      )
      .catch((e: unknown) => this.logger.warn(`No reset code sent: ${errorName(e)}`));
  }

  async resetPassword(
    pool: IdentityPool,
    sub: string | undefined,
    code: string,
    password: string,
  ): Promise<void> {
    const p = this.pool(pool);
    const username = (await this.usernameFor(p, sub ?? randomUUID())) ?? randomUUID();
    await this.client
      .send(
        new ConfirmForgotPasswordCommand({
          ClientId: p.clientId,
          Username: username,
          ConfirmationCode: code,
          Password: password,
          SecretHash: secretHash(p, username),
        }),
      )
      .catch((e: unknown) => {
        // Every failure answers the same: Cognito's per-user attempt limit and other errors only
        // a real account can hit would otherwise tell real emails apart. The API keeps its own
        // per-email limit, the same for every email (SignInService.resetPassword).
        this.logger.warn(`Password reset refused: ${errorName(e)}`);
        throw new AuthFlowError('RESET_CODE_INVALID');
      });
    // docs/AUTH-DESIGN.md: a password reset ends every session.
    await this.signOutEverywhere(pool, username);
  }

  async createUser(pool: IdentityPool, email: string): Promise<string> {
    const p = this.pool(pool);
    const out = await this.client.send(
      new AdminCreateUserCommand({
        UserPoolId: p.userPoolId,
        Username: randomUUID(),
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
        ],
        // Our API sends the activation email (docs/AUTH-DESIGN.md); Cognito sends nothing.
        MessageAction: 'SUPPRESS',
      }),
    );
    const sub = out.User?.Attributes?.find((a) => a.Name === 'sub')?.Value;
    if (!sub) throw new Error('Cognito created a user without a sub');
    return sub;
  }

  async setPassword(pool: IdentityPool, sub: string, password: string): Promise<void> {
    const p = this.pool(pool);
    const username = await this.usernameFor(p, sub);
    if (!username) throw new Error('No Cognito user for this invite');
    await this.client
      .send(
        new AdminSetUserPasswordCommand({
          UserPoolId: p.userPoolId,
          Username: username,
          Password: password,
          Permanent: true,
        }),
      )
      .catch((e: unknown) => fail(e, { InvalidPasswordException: 'PASSWORD_REJECTED' }));
  }

  async hasPassword(pool: IdentityPool, sub: string): Promise<boolean> {
    const p = this.pool(pool);
    const user = await this.userBySub(p, sub);
    // Invited users wait in FORCE_CHANGE_PASSWORD (the generated password nobody knows).
    return !!user && !['FORCE_CHANGE_PASSWORD', 'UNCONFIRMED'].includes(user.UserStatus ?? '');
  }

  async disableUser(pool: IdentityPool, sub: string): Promise<void> {
    const p = this.pool(pool);
    const user = await this.userBySub(p, sub);
    if (!user?.Username || user.Enabled === false) return;
    await this.client
      .send(new AdminDisableUserCommand({ UserPoolId: p.userPoolId, Username: user.Username }))
      .catch((e: unknown) => fail(e, {}));
  }

  /** The Cognito username for a sub, or undefined for an unknown or disabled user. */
  private async usernameFor(p: CognitoPool, sub: string): Promise<string | undefined> {
    const user = await this.userBySub(p, sub);
    return user?.Enabled === false ? undefined : user?.Username;
  }

  /**
   * The user with this sub (ListUsers, filter `sub = "..."`, one result). Unknown and random subs
   * make the same single call, so timing stays the same for unknown emails.
   */
  private async userBySub(p: CognitoPool, sub: string): Promise<UserType | undefined> {
    // Subs are UUIDs; anything else could break out of the filter's quotes, so it finds no one.
    if (!/^[A-Za-z0-9-]{1,128}$/.test(sub)) return undefined;
    const out = await this.client
      .send(new ListUsersCommand({ UserPoolId: p.userPoolId, Filter: `sub = "${sub}"`, Limit: 1 }))
      .catch((e: unknown) => fail(e, {}));
    return out.Users?.[0];
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
