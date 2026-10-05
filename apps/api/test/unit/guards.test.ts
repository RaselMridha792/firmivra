// Unit tests for the three global guards, with a fake database and real Nest metadata.
import {
  type ExecutionContext,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@firmivra/db';
import { AuthGuard } from '../../src/auth/auth.guard.js';
import { Public, Roles } from '../../src/auth/decorators.js';
import { RolesGuard } from '../../src/auth/roles.guard.js';
import { TenantGuard } from '../../src/auth/tenant.guard.js';
import { TokenService } from '../../src/auth/token.service.js';
import { loadEnv } from '../../src/config/env.js';

class Probe {
  @Public() open() {}
  @Roles('AUTHENTICATED') anyUser() {}
  @Roles('OWNER', 'ADMIN') ownerOrAdmin() {}
  @Roles('SUPER_ADMIN') superAdmin() {}
  noRoles() {}
}

type Req = Record<string, unknown> & { get?: (h: string) => string | undefined };

function ctx(method: keyof Probe, req: Req): ExecutionContext {
  return {
    getHandler: () => Probe.prototype[method],
    getClass: () => Probe,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

const headers = (h: Record<string, string>) => (name: string) => h[name.toLowerCase()];
const reflector = new Reflector();
const env = loadEnv({
  NODE_ENV: 'test',
  AUTH_MODE: 'local',
  LOCAL_AUTH_SECRET: 'unit-test-secret-unit-test-secret-1234',
  DATABASE_URL_APP: 'postgresql://unused',
  APP_BASE_URL: 'http://app.localhost:3000',
  PORTAL_BASE_URL: 'http://portal.localhost:3000',
  ADMIN_BASE_URL: 'http://admin.localhost:3000',
});
const tokens = new TokenService(env);

/** Fake scoped clients: each model method is a vi.fn the test configures. */
function fakeDb(over: {
  userBySub?: unknown;
  businessBySlug?: unknown;
  businessById?: unknown;
  membership?: unknown;
  clientAccount?: unknown;
  platformAdmin?: unknown;
  ownFirms?: unknown[];
}) {
  const platform = {
    user: { findUnique: vi.fn().mockResolvedValue(over.userBySub ?? null) },
    business: {
      findUnique: vi.fn(({ where }: { where: { slug?: string; id?: string } }) =>
        Promise.resolve(where.slug ? (over.businessBySlug ?? null) : (over.businessById ?? null)),
      ),
    },
    platformAdmin: { findUnique: vi.fn().mockResolvedValue(over.platformAdmin ?? null) },
  };
  const business = {
    membership: { findFirst: vi.fn().mockResolvedValue(over.membership ?? null) },
    clientAccount: { findFirst: vi.fn().mockResolvedValue(over.clientAccount ?? null) },
  };
  const user = {
    membership: { findMany: vi.fn().mockResolvedValue(over.ownFirms ?? []) },
    clientAccount: { findMany: vi.fn().mockResolvedValue(over.ownFirms ?? []) },
  };
  return {
    forPlatform: () => platform,
    forBusiness: vi.fn(() => business),
    forUser: () => user,
  } as unknown as Database & { forBusiness: ReturnType<typeof vi.fn> };
}

const FIRM = '0190a000-0000-7000-8000-000000000001';

describe('AuthGuard', () => {
  it('lets public routes through without a token', async () => {
    const guard = new AuthGuard(reflector, tokens, fakeDb({}));
    await expect(guard.canActivate(ctx('open', { get: headers({}) }))).resolves.toBe(true);
  });

  it('rejects a missing token', async () => {
    const guard = new AuthGuard(reflector, tokens, fakeDb({}));
    await expect(guard.canActivate(ctx('anyUser', { get: headers({}) }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a valid token whose user is not in the database', async () => {
    const { token } = await tokens.signLocal('sub-1', 'STAFF');
    const guard = new AuthGuard(reflector, tokens, fakeDb({ userBySub: null }));
    const req = { get: headers({ authorization: `Bearer ${token}` }) };
    await expect(guard.canActivate(ctx('anyUser', req))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a token from a different pool than the user', async () => {
    const { token } = await tokens.signLocal('sub-1', 'ADMIN');
    const guard = new AuthGuard(
      reflector,
      tokens,
      fakeDb({ userBySub: { id: 'u1', pool: 'STAFF' } }),
    );
    const req = { get: headers({ authorization: `Bearer ${token}` }) };
    await expect(guard.canActivate(ctx('anyUser', req))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('accepts the cookie and sets req.auth', async () => {
    const { token } = await tokens.signLocal('sub-1', 'STAFF');
    const guard = new AuthGuard(
      reflector,
      tokens,
      fakeDb({ userBySub: { id: 'u1', pool: 'STAFF' } }),
    );
    const req: Req = { cookies: { fv_access: token }, get: headers({}) };
    await expect(guard.canActivate(ctx('anyUser', req))).resolves.toBe(true);
    expect(req['auth']).toEqual({ userId: 'u1', cognitoSub: 'sub-1', pool: 'STAFF' });
  });
});

describe('TenantGuard', () => {
  const staff = { userId: 'u1', cognitoSub: 's', pool: 'STAFF' };

  it('skips routes without a firm role', async () => {
    const guard = new TenantGuard(reflector, fakeDb({}));
    await expect(
      guard.canActivate(ctx('anyUser', { auth: staff, get: headers({}) })),
    ).resolves.toBe(true);
  });

  it('404s when the caller has no membership in the firm', async () => {
    const guard = new TenantGuard(
      reflector,
      fakeDb({ businessById: { id: FIRM, status: 'ACTIVE' } }),
    );
    const req = { auth: staff, params: {}, get: headers({ 'x-business-id': FIRM }) };
    await expect(guard.canActivate(ctx('ownerOrAdmin', req))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('sets the tenant from the membership role', async () => {
    const db = fakeDb({
      businessById: { id: FIRM, status: 'ACTIVE' },
      membership: { role: 'ADMIN' },
    });
    const guard = new TenantGuard(reflector, db);
    const req: Req = { auth: staff, params: {}, get: headers({ 'x-business-id': FIRM }) };
    await expect(guard.canActivate(ctx('ownerOrAdmin', req))).resolves.toBe(true);
    expect(req['tenant']).toEqual({ businessId: FIRM, role: 'ADMIN', kind: 'staff' });
    expect(db.forBusiness).toHaveBeenCalledWith(FIRM);
  });

  it('uses the only firm when no header is sent', async () => {
    const db = fakeDb({
      ownFirms: [{ businessId: FIRM }],
      businessById: { id: FIRM, status: 'ACTIVE' },
      membership: { role: 'OWNER' },
    });
    const req: Req = { auth: staff, params: {}, get: headers({}) };
    await expect(
      new TenantGuard(reflector, db).canActivate(ctx('ownerOrAdmin', req)),
    ).resolves.toBe(true);
    expect((req['tenant'] as { businessId: string }).businessId).toBe(FIRM);
  });

  it('403s a member of a suspended firm, but only after confirming membership', async () => {
    const db = fakeDb({
      businessById: { id: FIRM, status: 'SUSPENDED' },
      membership: { role: 'OWNER' },
    });
    const req = { auth: staff, params: {}, get: headers({ 'x-business-id': FIRM }) };
    await expect(
      new TenantGuard(reflector, db).canActivate(ctx('ownerOrAdmin', req)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const outsider = fakeDb({ businessById: { id: FIRM, status: 'SUSPENDED' } });
    await expect(
      new TenantGuard(reflector, outsider).canActivate(ctx('ownerOrAdmin', req)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('RolesGuard (default deny)', () => {
  it('denies a route without @Roles()', async () => {
    const guard = new RolesGuard(reflector, fakeDb({}));
    await expect(
      guard.canActivate(ctx('noRoles', { auth: { userId: 'u1' } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows AUTHENTICATED for any signed-in user', async () => {
    const guard = new RolesGuard(reflector, fakeDb({}));
    await expect(guard.canActivate(ctx('anyUser', { auth: { userId: 'u1' } }))).resolves.toBe(true);
  });

  it('checks the tenant role', async () => {
    const guard = new RolesGuard(reflector, fakeDb({}));
    const staffReq = { auth: { userId: 'u1' }, tenant: { role: 'STAFF' } };
    await expect(guard.canActivate(ctx('ownerOrAdmin', staffReq))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    const ownerReq = { auth: { userId: 'u1' }, tenant: { role: 'OWNER' } };
    await expect(guard.canActivate(ctx('ownerOrAdmin', ownerReq))).resolves.toBe(true);
  });

  it('requires a platform_admins row for SUPER_ADMIN', async () => {
    const req = { auth: { userId: 'u1', pool: 'ADMIN' } };
    await expect(
      new RolesGuard(reflector, fakeDb({})).canActivate(ctx('superAdmin', req)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      new RolesGuard(reflector, fakeDb({ platformAdmin: { role: 'SUPER_ADMIN' } })).canActivate(
        ctx('superAdmin', req),
      ),
    ).resolves.toBe(true);
  });
});

describe('config', () => {
  const parts = {
    NODE_ENV: 'production',
    AUTH_MODE: 'cognito',
    APP_BASE_URL: 'https://d222.cloudfront.net',
    PORTAL_BASE_URL: 'https://d333.cloudfront.net',
    ADMIN_BASE_URL: 'https://d111.cloudfront.net',
    COGNITO_STAFF_USER_POOL_ID: 'p1',
    COGNITO_STAFF_CLIENT_ID: 'c1',
    COGNITO_STAFF_CLIENT_SECRET: 'fake-secret-1',
    COGNITO_CLIENTS_USER_POOL_ID: 'p2',
    COGNITO_CLIENTS_CLIENT_ID: 'c2',
    COGNITO_CLIENTS_CLIENT_SECRET: 'fake-secret-2',
    COGNITO_ADMINS_USER_POOL_ID: 'p3',
    COGNITO_ADMINS_CLIENT_ID: 'c3',
    COGNITO_ADMINS_CLIENT_SECRET: 'fake-secret-3',
    DB_HOST: 'db.internal',
    DB_PORT: '5432',
    DB_NAME: 'firmivra',
    DB_APP_USER: 'firmivra_app',
    DB_APP_PASSWORD: 'p@ss/word',
  };

  it('builds the database URL from the AWS task parts, with TLS verification', () => {
    expect(loadEnv(parts).DATABASE_URL_APP).toBe(
      'postgresql://firmivra_app:p%40ss%2Fword@db.internal:5432/firmivra?sslmode=verify-full',
    );
  });

  it('prefers an explicit DATABASE_URL_APP (local development)', () => {
    expect(loadEnv({ ...parts, DATABASE_URL_APP: 'postgresql://x@y/z' }).DATABASE_URL_APP).toBe(
      'postgresql://x@y/z',
    );
  });

  it('refuses AUTH_MODE=local in production', () => {
    expect(() => loadEnv({ ...env, NODE_ENV: 'production', AUTH_MODE: 'local' } as never)).toThrow(
      /AUTH_MODE=local/,
    );
  });

  it('defaults to Cognito and then requires the pool settings', () => {
    const { AUTH_MODE: _ignored, ...rest } = env;
    expect(() => loadEnv(rest as never)).toThrow(/COGNITO_STAFF_USER_POOL_ID/);
  });
});
