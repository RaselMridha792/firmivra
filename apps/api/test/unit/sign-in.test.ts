// Unit tests for R2 sign-in: Cognito calls (fake SDK client), challenge sessions, per-site cookies.
import { createHmac, hkdfSync } from 'node:crypto';
import type { Response as ExpressResponse } from 'express';
import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@firmivra/db';
import { LogActivationMailer } from '../../src/auth/activation-mailer.js';
import { AuthGuard } from '../../src/auth/auth.guard.js';
import {
  CHALLENGE_KEY_LABEL,
  type Challenge,
  ChallengeSessions,
  deriveChallengeKey,
} from '../../src/auth/challenge-session.js';
import { isPublic, Roles } from '../../src/auth/decorators.js';
import {
  type CognitoClient,
  CognitoIdentityProvider,
  type CognitoPool,
  cognitoPoolsFromEnv,
} from '../../src/auth/identity/cognito-identity.provider.js';
import { AuthFlowError } from '../../src/auth/identity/identity-provider.js';
import { deriveKey } from '../../src/auth/sealed.js';
import {
  REFRESH_KEY_LABEL,
  RefreshEnvelopes,
  SessionService,
} from '../../src/auth/session.service.js';
import { AdminSignInController, StaffSignInController } from '../../src/auth/sign-in.controller.js';
import { otpauthUri, SignInService } from '../../src/auth/sign-in.service.js';
import { siteOf, sitePlace } from '../../src/auth/site.js';
import { TokenService } from '../../src/auth/token.service.js';
import { requestContext, requestContextMiddleware } from '../../src/common/request-context.js';
import { loadEnv } from '../../src/config/env.js';

const STAFF_POOL: CognitoPool = {
  userPoolId: 'us-east-1_staff',
  clientId: 'staff-client',
  clientSecret: 'staff-secret',
};

const awsError = (name: string) => Object.assign(new Error(name), { name });

/** A Cognito client that answers each command by name and records what was sent. */
function fakeCognito(
  handlers: Record<string, (input: Record<string, unknown>) => unknown>,
  pool: CognitoPool = STAFF_POOL,
) {
  const sent: { command: string; input: Record<string, unknown> }[] = [];
  const send = vi.fn((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
    const command = cmd.constructor.name.replace(/Command$/, '');
    sent.push({ command, input: cmd.input });
    const handler = handlers[command];
    if (!handler) return Promise.reject(new Error(`unexpected ${command}`));
    try {
      return Promise.resolve(handler(cmd.input));
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
  const provider = new CognitoIdentityProvider({ send } as unknown as CognitoClient, {
    STAFF: pool,
  });
  return { provider, sent };
}

const expectedHash = (username: string) =>
  createHmac('sha256', STAFF_POOL.clientSecret)
    .update(username + STAFF_POOL.clientId)
    .digest('base64');

/** ListUsers by sub: the username is the pools' sign-in attribute, so Admin calls cannot take a sub. */
const knownUser = () => ({ Users: [{ Username: 'cognito-user-1', Enabled: true }] });
const noUser = () => ({ Users: [] });
const tokens = { AccessToken: 'acc', IdToken: 'id', RefreshToken: 'ref', ExpiresIn: 900 };

async function flowError(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  if (!(e instanceof AuthFlowError)) throw new Error(`expected AuthFlowError, got ${String(e)}`);
  return e.code;
}

describe('CognitoIdentityProvider: sign-in', () => {
  it('signs in with the username for the sub and the secret hash, then asks for the code', async () => {
    const { provider, sent } = fakeCognito({
      ListUsers: knownUser,
      AdminInitiateAuth: () => ({ ChallengeName: 'SOFTWARE_TOKEN_MFA', Session: 'cog-s1' }),
    });
    await expect(provider.signIn('STAFF', 'sub-1', 'pw')).resolves.toEqual({
      kind: 'challenge',
      step: 'MFA',
      username: 'cognito-user-1',
      session: 'cog-s1',
    });
    expect(sent[0]).toEqual({
      command: 'ListUsers',
      input: { UserPoolId: STAFF_POOL.userPoolId, Filter: 'sub = "sub-1"', Limit: 1 },
    });
    expect(sent[1]?.input).toMatchObject({
      AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
      ClientId: STAFF_POOL.clientId,
      AuthParameters: {
        USERNAME: 'cognito-user-1',
        PASSWORD: 'pw',
        SECRET_HASH: expectedHash('cognito-user-1'),
      },
    });
  });

  it('asks for first-time MFA setup', async () => {
    const { provider } = fakeCognito({
      ListUsers: knownUser,
      AdminInitiateAuth: () => ({ ChallengeName: 'MFA_SETUP', Session: 'cog-s1' }),
    });
    await expect(provider.signIn('STAFF', 'sub-1', 'pw')).resolves.toMatchObject({
      step: 'MFA_SETUP',
    });
  });

  it('makes the same two calls for an unknown email and answers INVALID_CREDENTIALS', async () => {
    const { provider, sent } = fakeCognito({
      ListUsers: noUser,
      AdminInitiateAuth: () => {
        throw awsError('NotAuthorizedException');
      },
    });
    expect(await flowError(provider.signIn('STAFF', undefined, 'pw'))).toBe('INVALID_CREDENTIALS');
    expect(sent.map((s) => s.command)).toEqual(['ListUsers', 'AdminInitiateAuth']);
  });

  it('never signs in a disabled user, even with the right password', async () => {
    const { provider, sent } = fakeCognito({
      ListUsers: () => ({ Users: [{ Username: 'cognito-user-1', Enabled: false }] }),
      AdminInitiateAuth: () => {
        throw awsError('NotAuthorizedException');
      },
    });
    expect(await flowError(provider.signIn('STAFF', 'sub-1', 'pw'))).toBe('INVALID_CREDENTIALS');
    const params = sent[1]?.input['AuthParameters'] as { USERNAME: string };
    expect(params.USERNAME).not.toBe('cognito-user-1');
  });

  it('never puts anything but a plain id into the ListUsers filter', async () => {
    const { provider, sent } = fakeCognito({
      ListUsers: knownUser,
      AdminInitiateAuth: () => {
        throw awsError('NotAuthorizedException');
      },
    });
    expect(await flowError(provider.signIn('STAFF', 'x" or sub = "y', 'pw'))).toBe(
      'INVALID_CREDENTIALS',
    );
    // No lookup at all: a random username goes to Cognito, as for an unknown email.
    expect(sent.map((s) => s.command)).toEqual(['AdminInitiateAuth']);
  });

  it.each([
    ['NotAuthorizedException', 'INVALID_CREDENTIALS'],
    ['PasswordResetRequiredException', 'INVALID_CREDENTIALS'],
    ['TooManyRequestsException', 'RATE_LIMITED'],
  ])('maps %s to %s', async (name, code) => {
    const { provider } = fakeCognito({
      ListUsers: knownUser,
      AdminInitiateAuth: () => {
        throw awsError(name);
      },
    });
    expect(await flowError(provider.signIn('STAFF', 'sub-1', 'pw'))).toBe(code);
  });

  it('lets unexpected Cognito errors through as 500s', async () => {
    const { provider } = fakeCognito({
      ListUsers: knownUser,
      AdminInitiateAuth: () => {
        throw awsError('InternalErrorException');
      },
    });
    await expect(provider.signIn('STAFF', 'sub-1', 'pw')).rejects.toThrow('InternalErrorException');
  });

  it('refuses challenges we do not support', async () => {
    const { provider } = fakeCognito({
      ListUsers: knownUser,
      AdminInitiateAuth: () => ({ ChallengeName: 'NEW_PASSWORD_REQUIRED', Session: 's' }),
    });
    expect(await flowError(provider.signIn('STAFF', 'sub-1', 'pw'))).toBe('INVALID_CREDENTIALS');
  });
});

describe('CognitoIdentityProvider: MFA', () => {
  it('answers the code and returns the tokens', async () => {
    const { provider, sent } = fakeCognito({
      AdminRespondToAuthChallenge: () => ({ AuthenticationResult: tokens }),
    });
    await expect(
      provider.answerMfa('STAFF', 'cognito-user-1', 'cog-s1', '123456'),
    ).resolves.toEqual({ accessToken: 'acc', idToken: 'id', refreshToken: 'ref', expiresIn: 900 });
    expect(sent[0]?.input).toMatchObject({
      ChallengeName: 'SOFTWARE_TOKEN_MFA',
      Session: 'cog-s1',
      ChallengeResponses: {
        USERNAME: 'cognito-user-1',
        SOFTWARE_TOKEN_MFA_CODE: '123456',
        SECRET_HASH: expectedHash('cognito-user-1'),
      },
    });
  });

  it.each([
    ['CodeMismatchException', 'MFA_CODE_INVALID'],
    ['NotAuthorizedException', 'CHALLENGE_EXPIRED'],
  ])('maps %s to %s', async (name, code) => {
    const { provider } = fakeCognito({
      AdminRespondToAuthChallenge: () => {
        throw awsError(name);
      },
    });
    expect(await flowError(provider.answerMfa('STAFF', 'u', 's', '000000'))).toBe(code);
  });

  it('sets up the authenticator: associate, verify, then answer MFA_SETUP', async () => {
    const { provider, sent } = fakeCognito({
      AssociateSoftwareToken: () => ({ SecretCode: 'BASE32KEY', Session: 'cog-s2' }),
      VerifySoftwareToken: () => ({ Status: 'SUCCESS', Session: 'cog-s3' }),
      AdminRespondToAuthChallenge: () => ({ AuthenticationResult: tokens }),
    });
    await expect(provider.startMfaSetup('STAFF', 'cognito-user-1', 'cog-s1')).resolves.toEqual({
      session: 'cog-s2',
      secret: 'BASE32KEY',
    });
    await provider.finishMfaSetup('STAFF', 'cognito-user-1', 'cog-s2', '123456');
    expect(sent.map((s) => s.command)).toEqual([
      'AssociateSoftwareToken',
      'VerifySoftwareToken',
      'AdminRespondToAuthChallenge',
    ]);
    expect(sent[1]?.input).toMatchObject({ Session: 'cog-s2', UserCode: '123456' });
    expect(sent[2]?.input).toMatchObject({ ChallengeName: 'MFA_SETUP', Session: 'cog-s3' });
  });

  it('reports a wrong first code as MFA_CODE_INVALID', async () => {
    const { provider } = fakeCognito({
      VerifySoftwareToken: () => {
        throw awsError('EnableSoftwareTokenMFAException');
      },
    });
    expect(await flowError(provider.finishMfaSetup('STAFF', 'u', 's', '000000'))).toBe(
      'MFA_CODE_INVALID',
    );
  });
});

describe('ChallengeSessions', () => {
  const sessions = ChallengeSessions.fromSecrets({
    STAFF: 'client-secret',
    ADMIN: 'client-secret',
  });
  const challenge: Challenge = {
    userId: 'u1',
    username: 'cognito-user-1',
    session: 'cog-s1',
    step: 'MFA',
    pool: 'STAFF',
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it('derives the key with HKDF and its own label, never the secret itself', () => {
    const key = deriveChallengeKey('client-secret', 'STAFF');
    expect(CHALLENGE_KEY_LABEL).toBe('fv-auth-challenge-v1');
    expect(Buffer.from(key)).toEqual(
      Buffer.from(hkdfSync('sha256', 'client-secret', 'STAFF', 'fv-auth-challenge-v1', 32)),
    );
    expect(Buffer.from(key).toString()).not.toContain('client-secret');
    expect(Buffer.from(deriveChallengeKey('client-secret', 'ADMIN'))).not.toEqual(Buffer.from(key));
  });

  it('round-trips, and the browser cannot read the Cognito username', async () => {
    const sealed = await sessions.seal(challenge);
    expect(sealed.split('.')).toHaveLength(5); // JWE compact: encrypted, not just signed
    expect(sealed).not.toContain(Buffer.from('cognito-user-1').toString('base64url'));
    await expect(sessions.open(sealed, 'STAFF')).resolves.toEqual(challenge);
  });

  it('cannot be opened on the other site', async () => {
    await expect(sessions.open(await sessions.seal(challenge), 'ADMIN')).resolves.toBeUndefined();
  });

  it('refuses a tampered or expired session', async () => {
    const sealed = await sessions.seal(challenge);
    const parts = sealed.split('.');
    // Change the first character: it always changes the decoded bytes (#72 review nit).
    const body = parts[3] ?? '';
    parts[3] = `${body.startsWith('A') ? 'B' : 'A'}${body.slice(1)}`;
    await expect(sessions.open(parts.join('.'), 'STAFF')).resolves.toBeUndefined();

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 181_000);
    await expect(sessions.open(sealed, 'STAFF')).resolves.toBeUndefined();
  });
});

describe('otpauthUri', () => {
  it('builds the URI authenticator apps read from a QR code', () => {
    expect(otpauthUri('Firmivra', 'owner@lvp.test', 'BASE32KEY')).toBe(
      'otpauth://totp/Firmivra%3Aowner%40lvp.test?secret=BASE32KEY&issuer=Firmivra&algorithm=SHA1&digits=6&period=30',
    );
  });
});

describe('AuthGuard: each site accepts only its own cookie and pools', () => {
  class Probe {
    @Roles('AUTHENTICATED') anyUser() {}
  }
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOCAL_AUTH_SECRET: 'unit-test-secret-unit-test-secret-1234',
    DATABASE_URL_APP: 'postgresql://unused',
    APP_BASE_URL: 'http://app.localhost:3000',
    PORTAL_BASE_URL: 'http://portal.localhost:3000',
    ADMIN_BASE_URL: 'http://admin.localhost:3000',
  });
  const tokenService = new TokenService(env);

  function guardFor(pool: 'STAFF' | 'ADMIN') {
    const db = {
      forPlatform: () => ({
        user: { findUnique: vi.fn().mockResolvedValue({ id: 'u1', pool }) },
      }),
    } as unknown as Database;
    return new AuthGuard(new Reflector(), tokenService, db);
  }

  function ctx(req: Record<string, unknown>): ExecutionContext {
    return {
      getHandler: () => Probe.prototype.anyUser,
      getClass: () => Probe,
      switchToHttp: () => ({ getRequest: () => ({ get: () => undefined, ...req }) }),
    } as unknown as ExecutionContext;
  }

  it('accepts the admin cookie on /api/v1/admin/*', async () => {
    const { token } = await tokenService.signLocal('sub-a', 'ADMIN');
    const req = { path: '/api/v1/admin/me', cookies: { fv_admin_access: token } };
    await expect(guardFor('ADMIN').canActivate(ctx(req))).resolves.toBe(true);
  });

  it('ignores the admin cookie on firm routes', async () => {
    const { token } = await tokenService.signLocal('sub-a', 'ADMIN');
    const req = { path: '/api/v1/me', cookies: { fv_admin_access: token } };
    await expect(guardFor('ADMIN').canActivate(ctx(req))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('refuses an admin token on firm routes, even in the firm cookie or as Bearer', async () => {
    const { token } = await tokenService.signLocal('sub-a', 'ADMIN');
    const asCookie = { path: '/api/v1/me', cookies: { fv_access: token } };
    const asBearer = {
      path: '/api/v1/me',
      get: (h: string) => (h === 'authorization' ? `Bearer ${token}` : undefined),
    };
    for (const req of [asCookie, asBearer]) {
      await expect(guardFor('ADMIN').canActivate(ctx(req))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }
  });

  it('refuses a staff session on admin routes', async () => {
    const { token } = await tokenService.signLocal('sub-s', 'STAFF');
    const req = { path: '/api/v1/admin/me', cookies: { fv_access: token, fv_admin_access: token } };
    await expect(guardFor('STAFF').canActivate(ctx(req))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

describe('CognitoIdentityProvider: sessions and password reset', () => {
  it('refreshes with REFRESH_TOKEN_AUTH and the hash of the Cognito username', async () => {
    const { provider, sent } = fakeCognito({
      AdminInitiateAuth: () => ({ AuthenticationResult: { AccessToken: 'acc2', ExpiresIn: 900 } }),
    });
    await expect(provider.refresh('STAFF', 'cognito-user-1', 'ref-1')).resolves.toEqual({
      accessToken: 'acc2',
      idToken: undefined,
      refreshToken: undefined,
      expiresIn: 900,
    });
    expect(sent[0]?.input).toMatchObject({
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      AuthParameters: { REFRESH_TOKEN: 'ref-1', SECRET_HASH: expectedHash('cognito-user-1') },
    });
  });

  it('reports a revoked or expired refresh token as SESSION_EXPIRED', async () => {
    const { provider } = fakeCognito({
      AdminInitiateAuth: () => {
        throw awsError('NotAuthorizedException');
      },
    });
    expect(await flowError(provider.refresh('STAFF', 'u', 'r'))).toBe('SESSION_EXPIRED');
  });

  it('revokes this device and signs out everywhere, without ever failing sign-out', async () => {
    const { provider, sent } = fakeCognito({
      RevokeToken: () => {
        throw awsError('UnsupportedTokenTypeException');
      },
      AdminUserGlobalSignOut: () => {
        throw awsError('UserNotFoundException');
      },
    });
    await expect(provider.revoke('STAFF', 'ref-1')).resolves.toBeUndefined();
    await expect(provider.signOutEverywhere('STAFF', 'cognito-user-1')).resolves.toBeUndefined();
    expect(sent[0]?.input).toEqual({
      Token: 'ref-1',
      ClientId: STAFF_POOL.clientId,
      ClientSecret: STAFF_POOL.clientSecret,
    });
    expect(sent[1]?.input).toEqual({
      UserPoolId: STAFF_POOL.userPoolId,
      Username: 'cognito-user-1',
    });
  });

  it('asks Cognito for a reset code the same way for unknown emails, and never fails', async () => {
    const { provider, sent } = fakeCognito({
      ListUsers: noUser,
      ForgotPassword: () => {
        throw awsError('LimitExceededException');
      },
    });
    await expect(provider.forgotPassword('STAFF', undefined)).resolves.toBeUndefined();
    expect(sent.map((s) => s.command)).toEqual(['ListUsers', 'ForgotPassword']);
    const username = sent[1]?.input['Username'] as string;
    expect(sent[1]?.input['SecretHash']).toBe(expectedHash(username));
  });

  it('resets the password, then ends every session', async () => {
    const { provider, sent } = fakeCognito({
      ListUsers: knownUser,
      ConfirmForgotPassword: () => ({}),
      AdminUserGlobalSignOut: () => ({}),
    });
    await provider.resetPassword('STAFF', 'sub-1', '123456', 'New-password-12');
    expect(sent.map((s) => s.command)).toEqual([
      'ListUsers',
      'ConfirmForgotPassword',
      'AdminUserGlobalSignOut',
    ]);
    expect(sent[1]?.input).toMatchObject({
      Username: 'cognito-user-1',
      ConfirmationCode: '123456',
      Password: 'New-password-12',
      SecretHash: expectedHash('cognito-user-1'),
    });
  });

  // Cognito's attempt limits and unexpected errors only ever hit real accounts: answering them
  // differently would tell real emails apart, so every reset failure is RESET_CODE_INVALID.
  it.each([
    'CodeMismatchException',
    'ExpiredCodeException',
    'InvalidPasswordException',
    'LimitExceededException',
    'TooManyFailedAttemptsException',
    'InternalErrorException',
  ])('answers a reset failure %s with RESET_CODE_INVALID and keeps the sessions', async (name) => {
    const { provider, sent } = fakeCognito({
      ListUsers: knownUser,
      ConfirmForgotPassword: () => {
        throw awsError(name);
      },
    });
    expect(await flowError(provider.resetPassword('STAFF', 'sub-1', '1', 'p'))).toBe(
      'RESET_CODE_INVALID',
    );
    expect(sent.map((s) => s.command)).not.toContain('AdminUserGlobalSignOut');
  });
});

describe('RefreshEnvelopes', () => {
  const envelopes = new RefreshEnvelopes({ STAFF: 'client-secret', ADMIN: 'client-secret' });
  const envelope = {
    userId: '0190a000-0000-7000-8000-000000000001',
    username: '0190a000-0000-7000-8000-000000000002',
    // Cognito refresh tokens are encrypted JWTs of about 1.8 KB.
    refreshToken: 'r'.repeat(2000),
    pool: 'STAFF' as const,
  };

  it('uses its own HKDF label, so its key differs from the challenge key', () => {
    expect(REFRESH_KEY_LABEL).toBe('fv-auth-refresh-v1');
    expect(Buffer.from(deriveKey('client-secret', 'STAFF', REFRESH_KEY_LABEL))).not.toEqual(
      Buffer.from(deriveChallengeKey('client-secret', 'STAFF')),
    );
  });

  it('fits in one cookie with room for its attributes', async () => {
    const sealed = await envelopes.seal(envelope, 30 * 24 * 60 * 60);
    expect(sealed.length).toBeLessThan(3800);
    await expect(envelopes.open(sealed, 'STAFF')).resolves.toMatchObject({ value: envelope });
  });

  it('can keep a fixed end, so a rotated token never lengthens the session', async () => {
    const end = Math.floor(Date.now() / 1000) + 3600;
    const opened = await envelopes.open(await envelopes.sealUntil(envelope, end), 'STAFF');
    expect(opened?.expiresAt).toBe(end);
  });

  it('never opens on the other site', async () => {
    const sealed = await envelopes.seal(envelope, 60);
    await expect(envelopes.open(sealed, 'ADMIN')).resolves.toBeUndefined();
  });
});

describe('sign-in routes are public one by one, never by class (#16 fix)', () => {
  const reflector = new Reflector();
  const routes = [
    'signIn',
    'mfa',
    'mfaSetup',
    'refresh',
    'signOut',
    'forgotPassword',
    'resetPassword',
  ] as const;
  const ctxFor = (cls: object, handler: unknown) =>
    ({ getHandler: () => handler, getClass: () => cls }) as unknown as ExecutionContext;

  it.each([
    ['StaffSignInController', StaffSignInController],
    ['AdminSignInController', AdminSignInController],
  ])('%s', (_name, cls) => {
    const proto = cls.prototype as unknown as Record<string, unknown>;
    for (const route of routes) {
      expect([route, isPublic(reflector, ctxFor(cls, proto[route]))]).toEqual([route, true]);
    }
    // A route added later (for example POST /auth/invites) is not public unless it says so.
    expect(
      isPublic(
        reflector,
        ctxFor(cls, function addedLater() {}),
      ),
    ).toBe(false);
  });
});

describe('siteOf (#16 fix)', () => {
  it('recognises the Super Admin API whatever the letter case, as Express routes it', () => {
    for (const path of [
      '/api/v1/admin/me',
      '/API/V1/ADMIN/me',
      '/Api/v1/Admin',
      '/api/v1/admin/',
    ]) {
      expect([path, siteOf({ path })]).toEqual([path, 'admin']);
    }
    for (const path of ['/api/v1/me', '/api/v1/administrators', '/api/v1/auth/sign-in']) {
      expect([path, siteOf({ path })]).toEqual([path, 'firm']);
    }
  });
});

describe('SessionService.refresh (#23 review)', () => {
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOCAL_AUTH_SECRET: 'unit-test-secret-unit-test-secret-1234',
    DATABASE_URL_APP: 'postgresql://unused',
    APP_BASE_URL: 'http://app.localhost:3000',
    PORTAL_BASE_URL: 'http://portal.localhost:3000',
    ADMIN_BASE_URL: 'http://admin.localhost:3000',
  });
  const envelopes = new RefreshEnvelopes({
    STAFF: env.LOCAL_AUTH_SECRET,
    ADMIN: env.LOCAL_AUTH_SECRET,
  });
  const envelope = {
    userId: 'u1',
    username: 'cognito-user-1',
    refreshToken: 'ref-1',
    pool: 'STAFF' as const,
  };

  function setup(user: { pool: string } | null, rotated?: string) {
    const identity = {
      refresh: vi
        .fn()
        .mockResolvedValue({ accessToken: 'acc2', refreshToken: rotated, expiresIn: 900 }),
      revoke: vi.fn().mockResolvedValue(undefined),
    };
    const db = {
      forPlatform: () => ({
        user: { findUnique: vi.fn().mockResolvedValue(user) },
        platformAdmin: { findUnique: vi.fn().mockResolvedValue(null) },
      }),
    } as unknown as Database;
    const cookies: Record<string, { value: string; maxAge?: number }> = {};
    const res = {
      cookie: (name: string, value: string, opts: { maxAge?: number }) => {
        cookies[name] = { value, maxAge: opts.maxAge };
      },
      clearCookie: (name: string) => {
        cookies[name] = { value: '' };
      },
    } as unknown as ExpressResponse;
    const audit = { log: vi.fn(() => Promise.resolve()) };
    const service = new SessionService(identity as never, envelopes, db, audit as never, env);
    return { service, identity, cookies, res };
  }

  it('keeps the original end when Cognito rotates the refresh token', async () => {
    const end = Math.floor(Date.now() / 1000) + 3600;
    const { service, cookies, res } = setup({ pool: 'STAFF' }, 'ref-2');
    const req = { cookies: { fv_refresh: await envelopes.sealUntil(envelope, end) } };
    await service.refresh(req as never, res, sitePlace('firm'));

    const maxAge = cookies['fv_refresh']?.maxAge ?? 0;
    expect(maxAge).toBeLessThanOrEqual(3600 * 1000);
    expect(maxAge).toBeGreaterThan(3590 * 1000); // not a fresh 7 days
    const reopened = await envelopes.open(cookies['fv_refresh']?.value ?? '', 'STAFF');
    expect(reopened).toEqual({ value: { ...envelope, refreshToken: 'ref-2' }, expiresAt: end });
  });

  it('revokes the token and clears the cookies when the user is gone', async () => {
    const { service, identity, cookies, res } = setup(null);
    const req = { cookies: { fv_refresh: await envelopes.seal(envelope, 3600) } };
    await expect(service.refresh(req as never, res, sitePlace('firm'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(identity.revoke).toHaveBeenCalledWith('STAFF', 'ref-1');
    expect(identity.refresh).not.toHaveBeenCalled();
    expect(cookies['fv_refresh']).toEqual({ value: '' });
  });
});

describe('SignInService: MFA is never skipped for staff and Super Admins (#16 item 7)', () => {
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOCAL_AUTH_SECRET: 'unit-test-secret-unit-test-secret-1234',
    DATABASE_URL_APP: 'postgresql://unused',
    APP_BASE_URL: 'http://app.localhost:3000',
    PORTAL_BASE_URL: 'http://portal.localhost:3000',
    ADMIN_BASE_URL: 'http://admin.localhost:3000',
  });

  it.each(['firm', 'admin'] as const)('refuses tokens without MFA on the %s site', async (site) => {
    const user = { id: 'u1', cognitoSub: 'sub-1' };
    // The reservation's transaction: the try-lock is free, then no open attempts counted.
    const tx = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ ok: true }])
        .mockResolvedValueOnce([{ open: [0] }]),
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const db = {
      withScope: (_scope: unknown, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
      forPlatform: () => ({
        user: { findMany: vi.fn().mockResolvedValue([user]) },
        platformAdmin: { findUnique: vi.fn().mockResolvedValue({ userId: 'u1' }) },
        auditLog: { count: vi.fn().mockResolvedValue(0) },
      }),
    } as unknown as Database;
    const identity = {
      signIn: vi.fn().mockResolvedValue({
        kind: 'tokens',
        username: 'cognito-user-1',
        tokens: { accessToken: 'acc', refreshToken: 'ref', expiresIn: 900 },
      }),
      revoke: vi.fn().mockResolvedValue(undefined),
    };
    const service = new SignInService(
      db,
      identity as never,
      ChallengeSessions.fromEnv(env),
      { log: vi.fn() } as never,
      env,
    );
    await expect(service.signIn(sitePlace(site), 'owner@lvp.test', 'pw')).rejects.toThrow(
      /skipped MFA/,
    );
    expect(identity.revoke).toHaveBeenCalledWith(site === 'admin' ? 'ADMIN' : 'STAFF', 'ref');
  });
});

describe('Cognito ContextData for threat protection (step 7)', () => {
  const pool = { ...STAFF_POOL, serverName: 'app.firmivra.test' };
  const store = {
    requestId: 'r1',
    ip: '203.0.113.9',
    userAgent: 'Mozilla/5.0 (test)',
    acceptLanguage: 'en-US,en;q=0.9',
    path: '/api/v1/auth/sign-in',
  };
  const expected = {
    IpAddress: '203.0.113.9',
    ServerName: 'app.firmivra.test',
    ServerPath: '/api/v1/auth/sign-in',
    HttpHeaders: [
      { headerName: 'user-agent', headerValue: 'Mozilla/5.0 (test)' },
      { headerName: 'accept-language', headerValue: 'en-US,en;q=0.9' },
    ],
  };

  it('sends the viewer, the site and only User-Agent and Accept-Language on sign-in and MFA', async () => {
    const { provider, sent } = fakeCognito(
      {
        ListUsers: knownUser,
        AdminInitiateAuth: () => ({ ChallengeName: 'SOFTWARE_TOKEN_MFA', Session: 's1' }),
        AdminRespondToAuthChallenge: () => ({ AuthenticationResult: tokens }),
      },
      pool,
    );
    await requestContext.run(store, async () => {
      await provider.signIn('STAFF', 'sub-1', 'pw');
      await provider.answerMfa('STAFF', 'cognito-user-1', 's1', '123456');
    });
    expect(sent.find((c) => c.command === 'AdminInitiateAuth')?.input['ContextData']).toEqual(
      expected,
    );
    expect(
      sent.find((c) => c.command === 'AdminRespondToAuthChallenge')?.input['ContextData'],
    ).toEqual(expected);
  });

  it('sends none outside a request', async () => {
    const { provider, sent } = fakeCognito(
      { ListUsers: knownUser, AdminInitiateAuth: () => ({ AuthenticationResult: tokens }) },
      pool,
    );
    await provider.signIn('STAFF', 'sub-1', 'pw');
    expect(sent.find((c) => c.command === 'AdminInitiateAuth')?.input['ContextData']).toBe(
      undefined,
    );
  });

  it('keeps req.ip (trust proxy) and never a raw X-Forwarded-For, Cookie or Authorization', () => {
    const headers: Record<string, string> = {
      'x-forwarded-for': '198.51.100.66, 10.0.0.5',
      cookie: 'fv_access=secret',
      authorization: 'Bearer secret',
      'user-agent': 'UA',
    };
    const req = {
      ip: '203.0.113.9',
      path: '/api/v1/auth/sign-in',
      get: (name: string) => headers[name.toLowerCase()],
    };
    const res = { setHeader: vi.fn() };
    let seen: unknown;
    requestContextMiddleware(req as never, res as never, () => {
      seen = requestContext.getStore();
    });
    expect(seen).toMatchObject({ ip: '203.0.113.9', userAgent: 'UA' });
    expect(JSON.stringify(seen)).not.toMatch(/secret|198\.51\.100\.66/);
  });

  it("takes each pool's host from its site's base URL", () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      AUTH_MODE: 'cognito',
      DATABASE_URL_APP: 'postgresql://unused',
      APP_BASE_URL: 'https://app.dev.firmivra.test',
      PORTAL_BASE_URL: 'https://portal.dev.firmivra.test',
      ADMIN_BASE_URL: 'https://admin.dev.firmivra.test',
      COGNITO_REGION: 'us-east-1',
      COGNITO_STAFF_USER_POOL_ID: 'p1',
      COGNITO_STAFF_CLIENT_ID: 'c1',
      COGNITO_STAFF_CLIENT_SECRET: 'fake-secret-1',
      COGNITO_CLIENTS_USER_POOL_ID: 'p2',
      COGNITO_CLIENTS_CLIENT_ID: 'c2',
      COGNITO_CLIENTS_CLIENT_SECRET: 'fake-secret-2',
      COGNITO_ADMINS_USER_POOL_ID: 'p3',
      COGNITO_ADMINS_CLIENT_ID: 'c3',
      COGNITO_ADMINS_CLIENT_SECRET: 'fake-secret-3',
    });
    const pools = cognitoPoolsFromEnv(env);
    expect([pools.STAFF?.serverName, pools.CLIENT?.serverName, pools.ADMIN?.serverName]).toEqual([
      'app.dev.firmivra.test',
      'portal.dev.firmivra.test',
      'admin.dev.firmivra.test',
    ]);
  });
});

describe('CognitoIdentityProvider: invites and activation (step 6)', () => {
  it('disables a login found by sub, and skips one that is unknown or already disabled', async () => {
    const enabled = fakeCognito({ ListUsers: knownUser, AdminDisableUser: () => ({}) });
    await enabled.provider.disableUser('STAFF', 'sub-1');
    expect(enabled.sent[1]).toEqual({
      command: 'AdminDisableUser',
      input: { UserPoolId: STAFF_POOL.userPoolId, Username: 'cognito-user-1' },
    });
    for (const list of [
      noUser,
      () => ({ Users: [{ Username: 'cognito-user-1', Enabled: false }] }),
    ]) {
      const other = fakeCognito({ ListUsers: list });
      await other.provider.disableUser('STAFF', 'sub-1');
      expect(other.sent.map((c) => c.command)).toEqual(['ListUsers']);
    }
  });

  it('creates a login with a verified email and no Cognito email, and returns its sub', async () => {
    const { provider, sent } = fakeCognito({
      AdminCreateUser: () => ({ User: { Attributes: [{ Name: 'sub', Value: 'new-sub' }] } }),
    });
    await expect(provider.createUser('STAFF', 'new@lvp.test')).resolves.toBe('new-sub');
    expect(sent[0]?.input).toMatchObject({
      UserPoolId: STAFF_POOL.userPoolId,
      MessageAction: 'SUPPRESS',
      UserAttributes: [
        { Name: 'email', Value: 'new@lvp.test' },
        { Name: 'email_verified', Value: 'true' },
      ],
    });
    expect(sent[0]?.input['Username']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sets a permanent first password; a refused one is PASSWORD_REJECTED', async () => {
    const ok = fakeCognito({ ListUsers: knownUser, AdminSetUserPassword: () => ({}) });
    await ok.provider.setPassword('STAFF', 'sub-1', 'New-password-12');
    expect(ok.sent[1]).toEqual({
      command: 'AdminSetUserPassword',
      input: {
        UserPoolId: STAFF_POOL.userPoolId,
        Username: 'cognito-user-1',
        Password: 'New-password-12',
        Permanent: true,
      },
    });

    const refused = fakeCognito({
      ListUsers: knownUser,
      AdminSetUserPassword: () => {
        throw awsError('InvalidPasswordException');
      },
    });
    expect(await flowError(refused.provider.setPassword('STAFF', 'sub-1', 'p'))).toBe(
      'PASSWORD_REJECTED',
    );
  });

  it.each([
    ['CONFIRMED', true],
    ['RESET_REQUIRED', true],
    ['FORCE_CHANGE_PASSWORD', false],
    ['UNCONFIRMED', false],
  ])('a login in status %s has a password: %s', async (status, expected) => {
    const { provider } = fakeCognito({
      ListUsers: () => ({ Users: [{ Username: 'u', Enabled: true, UserStatus: status }] }),
    });
    await expect(provider.hasPassword('STAFF', 'sub-1')).resolves.toBe(expected);
  });

  it('an unknown login has no password', async () => {
    const { provider } = fakeCognito({
      ListUsers: noUser,
    });
    await expect(provider.hasPassword('STAFF', 'sub-1')).resolves.toBe(false);
  });
});

describe('LogActivationMailer (until R6)', () => {
  const email = {
    inviteId: 'invite-1',
    to: 'new@lvp.test',
    name: 'New',
    businessName: 'LVP',
    link: 'https://app.dev.firmivra.com/activate#token=SECRET-TOKEN',
    expiresAt: new Date(),
  };

  it('logs the link only in local mode', async () => {
    const logger = { log: vi.fn(), warn: vi.fn() };
    await new LogActivationMailer(true, logger).send(email);
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('#token=SECRET-TOKEN'));
  });

  it('never logs the token or the address anywhere else', async () => {
    const logger = { log: vi.fn(), warn: vi.fn() };
    await new LogActivationMailer(false, logger).send(email);
    const logged = JSON.stringify([...logger.log.mock.calls, ...logger.warn.mock.calls]);
    expect(logged).toContain('invite-1');
    expect(logged).not.toContain('SECRET-TOKEN');
    expect(logged).not.toContain('new@lvp.test');
  });
});
