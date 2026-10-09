// R3 step 5: client sign-in on a firm's portal. Which routes are portal routes, and the rule that
// a client's challenge and refresh envelope work only on the firm they were sealed for.
import type { Response as ExpressResponse } from 'express';
import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@firmivra/db';
import { portalCookies } from '@firmivra/types';
import { ChallengeSessions } from '../../src/auth/challenge-session.js';
import { LocalIdentityProvider } from '../../src/auth/identity/local-identity.provider.js';
import { RefreshEnvelopes, SessionService } from '../../src/auth/session.service.js';
import { portalPlace, portalSlugOf } from '../../src/auth/site.js';
import { TokenService } from '../../src/auth/token.service.js';
import { loadEnv } from '../../src/config/env.js';

const env = loadEnv({
  NODE_ENV: 'test',
  AUTH_MODE: 'local',
  LOCAL_AUTH_SECRET: 'unit-test-secret-unit-test-secret-1234',
  DATABASE_URL_APP: 'postgresql://unused',
  APP_BASE_URL: 'http://app.localhost:3000',
  PORTAL_BASE_URL: 'http://portal.localhost:3000',
  ADMIN_BASE_URL: 'http://admin.localhost:3000',
});
const secrets = { CLIENT: env.LOCAL_AUTH_SECRET, STAFF: env.LOCAL_AUTH_SECRET };
const firmA = { id: 'firm-a', slug: 'lvp', name: 'LVP Accounting: Taxes' };
const firmB = { id: 'firm-b', slug: 'other', name: 'Other Firm' };

describe('portal routes', () => {
  it('reads the firm slug of a portal route, lower-cased, and nothing else', () => {
    expect(portalSlugOf({ path: '/api/v1/portal/LVP/auth/sign-in' })).toBe('lvp');
    expect(portalSlugOf({ path: '/API/V1/Portal/lvp' })).toBe('lvp');
    for (const path of ['/api/v1/auth/sign-in', '/api/v1/portals/lvp', '/api/v1/portal/', '/']) {
      expect([path, portalSlugOf({ path })]).toEqual([path, undefined]);
    }
  });

  it("signs in with the clients pool, the firm's own cookies and its name as issuer", () => {
    const place = portalPlace(firmA);
    expect(place).toEqual({
      pool: 'CLIENT',
      cookies: portalCookies('lvp'),
      // otpauth labels are "issuer:email", so the colon goes.
      issuer: 'LVP Accounting Taxes',
      businessId: 'firm-a',
    });
  });
});

describe("a client's challenge belongs to one firm", () => {
  const challenges = ChallengeSessions.fromSecrets(secrets);
  const challenge = {
    userId: 'u1',
    username: 'cognito-user-1',
    session: 'cognito-session',
    step: 'MFA' as const,
    pool: 'CLIENT' as const,
  };

  it("opens only on the firm it was sealed for, never on another firm's portal", async () => {
    const sealed = await challenges.seal({ ...challenge, businessId: firmA.id });
    expect(await challenges.open(sealed, 'CLIENT', firmA.id)).toMatchObject({ userId: 'u1' });
    expect(await challenges.open(sealed, 'CLIENT', firmB.id)).toBeUndefined();
    expect(await challenges.open(sealed, 'CLIENT')).toBeUndefined();
  });

  it('never opens a challenge without a firm on a portal', async () => {
    const sealed = await challenges.seal(challenge);
    expect(await challenges.open(sealed, 'CLIENT', firmA.id)).toBeUndefined();
  });
});

describe("a client's refresh envelope belongs to one firm", () => {
  const envelopes = new RefreshEnvelopes(secrets);
  const envelope = {
    userId: 'u1',
    username: 'cognito-user-1',
    refreshToken: 'ref-1',
    pool: 'CLIENT' as const,
    businessId: firmA.id,
  };

  function setup(account: { status: string } | null) {
    const identity = {
      refresh: vi.fn().mockResolvedValue({ accessToken: 'acc2', expiresIn: 900 }),
      revoke: vi.fn().mockResolvedValue(undefined),
    };
    const findAccount = vi.fn().mockResolvedValue(
      account && {
        id: 'ca1',
        status: account.status,
        emailVerifiedAt: new Date(),
        phoneVerifiedAt: new Date(),
        user: { id: 'u1', cognitoSub: 'sub-1' },
      },
    );
    const db = {
      forPlatform: () => ({ user: { findUnique: vi.fn().mockResolvedValue({ pool: 'CLIENT' }) } }),
      forBusiness: () => ({ clientAccount: { findUnique: findAccount } }),
    } as unknown as Database;
    const cookies: Record<string, string> = {};
    const res = {
      cookie: (name: string, value: string) => {
        cookies[name] = value;
      },
      clearCookie: (name: string) => {
        cookies[name] = '';
      },
    } as unknown as ExpressResponse;
    const audit = { log: vi.fn(() => Promise.resolve()) };
    const service = new SessionService(identity as never, envelopes, db, audit as never, env);
    return { service, identity, findAccount, cookies, res };
  }

  it('refreshes on its own firm while the client may sign in', async () => {
    const { service, identity, findAccount, cookies, res } = setup({ status: 'ACTIVE' });
    const req = { cookies: { [portalCookies('lvp').refresh]: await envelopes.seal(envelope, 60) } };
    await service.refresh(req as never, res, portalPlace(firmA));
    expect(findAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId_userId: { businessId: firmA.id, userId: 'u1' } },
      }),
    );
    expect(identity.refresh).toHaveBeenCalledWith('CLIENT', 'cognito-user-1', 'ref-1');
    expect(cookies[portalCookies('lvp').access]).toBe('acc2');
  });

  it("is refused under another firm's cookie name", async () => {
    const { service, identity, cookies, res } = setup({ status: 'ACTIVE' });
    const req = {
      cookies: { [portalCookies('other').refresh]: await envelopes.seal(envelope, 60) },
    };
    await expect(service.refresh(req as never, res, portalPlace(firmB))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(identity.refresh).not.toHaveBeenCalled();
    expect(cookies[portalCookies('other').refresh]).toBe('');
  });

  it('signs out a client who may no longer sign in, and revokes the token', async () => {
    const { service, identity, res } = setup({ status: 'DISABLED' });
    const req = { cookies: { [portalCookies('lvp').refresh]: await envelopes.seal(envelope, 60) } };
    await expect(service.refresh(req as never, res, portalPlace(firmA))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(identity.revoke).toHaveBeenCalledWith('CLIENT', 'ref-1');
    expect(identity.refresh).not.toHaveBeenCalled();
  });
});

describe('LocalIdentityProvider: MFA is optional for clients', () => {
  const provider = new LocalIdentityProvider(new TokenService(env));

  it('signs a client in at once, and asks staff for authenticator setup', async () => {
    const client = await provider.signIn('CLIENT', 'client-sub', 'Firmivra-local-1');
    expect(client).toMatchObject({ kind: 'tokens', username: 'client-sub' });
    const staff = await provider.signIn('STAFF', 'staff-sub', 'Firmivra-local-1');
    expect(staff).toMatchObject({ kind: 'challenge', step: 'MFA_SETUP' });
  });
});
