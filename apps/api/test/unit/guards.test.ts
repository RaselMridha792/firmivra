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
import { Access, Public, Roles } from '../../src/auth/decorators.js';
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

  const client = { userId: 'c1', cognitoSub: 's', pool: 'CLIENT' };
  const portalReq = (firmSlug: string): Req => ({
    auth: client,
    path: `/api/v1/portal/${encodeURIComponent(firmSlug)}/me`,
    params: { firmSlug },
    get: headers({}),
  });

  it('finds a portal firm by its slug in any letter case', async () => {
    const db = fakeDb({
      businessBySlug: { id: FIRM },
      businessById: { id: FIRM, status: 'ACTIVE' },
      clientAccount: { id: 'acct-1' },
    });
    const req = portalReq('LVP');
    await expect(
      new TenantGuard(reflector, db).canActivate(ctx('ownerOrAdmin', req)),
    ).resolves.toBe(true);
    expect(db.forPlatform().business.findUnique).toHaveBeenCalledWith({
      where: { slug: 'lvp' },
      select: { id: true },
    });
    expect(req['tenant']).toEqual({
      businessId: FIRM,
      role: 'CLIENT',
      kind: 'client',
      clientAccountId: 'acct-1',
    });
  });

  it('404s a portal slug that cannot be a firm address, before any query (#84 review)', async () => {
    for (const firmSlug of [
      'lvp' + String.fromCharCode(0),
      String.fromCharCode(0),
      'a;b',
      'l v p',
    ]) {
      const db = fakeDb({
        businessBySlug: { id: FIRM },
        businessById: { id: FIRM, status: 'ACTIVE' },
      });
      await expect(
        new TenantGuard(reflector, db).canActivate(ctx('ownerOrAdmin', portalReq(firmSlug))),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(db.forPlatform().business.findUnique).not.toHaveBeenCalled();
    }
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

// Staff Management's per-member changes (member_permissions, R55): the guard asks for the
// member's own cell of the route; none means the role decides exactly as before.
class GridProbe {
  @Access('TAX_RETURNS') @Roles('OWNER', 'ADMIN', 'STAFF') view() {}
  @Access('PAYROLL') @Roles('OWNER', 'ADMIN', 'STAFF') payroll() {}
  @Roles('OWNER', 'ADMIN', 'STAFF') noModule() {}
}
const gridCtx = (method: keyof GridProbe, req: Req): ExecutionContext =>
  ({
    getHandler: () => GridProbe.prototype[method],
    getClass: () => GridProbe,
    switchToHttp: () => ({ getRequest: () => ({ method: 'GET', ...req }) }),
  }) as unknown as ExecutionContext;

describe('RolesGuard and a member’s own permissions', () => {
  const guardWith = (own: boolean | undefined, roleCanIt = true) => {
    const grants = {
      memberCell: vi.fn().mockResolvedValue(own),
      can: vi.fn().mockResolvedValue(roleCanIt),
    };
    return { guard: new RolesGuard(reflector, fakeDb({}), grants as never), grants };
  };
  const as = (role: string) => ({
    auth: { userId: 'u1' },
    tenant: { kind: 'staff', role, businessId: FIRM },
  });

  it('keeps a member without own changes as before', async () => {
    const { guard, grants } = guardWith(undefined);
    await expect(guard.canActivate(gridCtx('view', as('STAFF')))).resolves.toBe(true);
    await expect(guard.canActivate(gridCtx('view', as('MANAGER')))).resolves.toBe(true);
    expect(grants.memberCell).toHaveBeenCalledWith(FIRM, 'u1', 'TAX_RETURNS', 'VIEW');
  });

  it("refuses a Staff or Admin member whose own change takes the route's cell away", async () => {
    const { guard } = guardWith(false);
    await expect(guard.canActivate(gridCtx('view', as('STAFF')))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(guard.canActivate(gridCtx('view', as('ADMIN')))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("lets a grid role in by its own grant when the role's grid says no", async () => {
    const { guard } = guardWith(true, false);
    await expect(guard.canActivate(gridCtx('view', as('BOOKKEEPER')))).resolves.toBe(true);
  });

  it("refuses a grid role whose own change takes away what the role's grid gives", async () => {
    const { guard, grants } = guardWith(false, true);
    await expect(guard.canActivate(gridCtx('view', as('MANAGER')))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(grants.can).not.toHaveBeenCalled();
  });

  it('never asks for an Owner, a client, or a route that names no module', async () => {
    const { guard, grants } = guardWith(false);
    await expect(guard.canActivate(gridCtx('view', as('OWNER')))).resolves.toBe(true);
    await expect(guard.canActivate(gridCtx('noModule', as('STAFF')))).resolves.toBe(true);
    expect(grants.memberCell).not.toHaveBeenCalled();
  });
});

describe('RolesGuard and the Admin role grid', () => {
  // Octavia's review (Oct 20): a cell the firm takes away from the Admin role is enforced.
  const guardWith = (removed: string[], own: boolean | undefined = undefined) => {
    const grants = {
      memberCell: vi.fn().mockResolvedValue(own),
      can: vi.fn().mockResolvedValue(true),
      changes: vi.fn().mockResolvedValue(new Map(removed.map((k) => [k, false]))),
    };
    return { guard: new RolesGuard(reflector, fakeDb({}), grants as never), grants };
  };
  const as = (role: string) => ({
    auth: { userId: 'u1' },
    tenant: { kind: 'staff', role, businessId: FIRM },
  });

  it('refuses an Admin a cell the firm took away from the Admin role', async () => {
    const { guard, grants } = guardWith(['TAX_RETURNS:VIEW']);
    await expect(guard.canActivate(gridCtx('view', as('ADMIN')))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(grants.changes).toHaveBeenCalledWith(FIRM, 'ADMIN');
  });

  it('keeps an Admin in when the firm changed nothing, or another cell', async () => {
    await expect(guardWith([]).guard.canActivate(gridCtx('view', as('ADMIN')))).resolves.toBe(true);
    await expect(
      guardWith(['TAX_RETURNS:EDIT']).guard.canActivate(gridCtx('view', as('ADMIN'))),
    ).resolves.toBe(true);
  });

  it("lets the Admin's own grant win over the role, and never touches Owner or Staff", async () => {
    const own = guardWith(['TAX_RETURNS:VIEW'], true);
    await expect(own.guard.canActivate(gridCtx('view', as('ADMIN')))).resolves.toBe(true);
    const other = guardWith(['TAX_RETURNS:VIEW']);
    await expect(other.guard.canActivate(gridCtx('view', as('OWNER')))).resolves.toBe(true);
    await expect(other.guard.canActivate(gridCtx('view', as('STAFF')))).resolves.toBe(true);
    expect(other.grants.changes).not.toHaveBeenCalled();
  });
});

describe('RolesGuard and a custom role', () => {
  // Settings > Users & Roles (R55): a custom role's grid stands in for its role's; the member's
  // own change still wins.
  const guardWith = (
    custom: boolean | undefined,
    { own, roleCanIt = false }: { own?: boolean; roleCanIt?: boolean } = {},
  ) => {
    const grants = {
      memberCell: vi.fn().mockResolvedValue(own),
      customCell: vi.fn().mockResolvedValue(custom),
      can: vi.fn().mockResolvedValue(roleCanIt),
      changes: vi.fn().mockResolvedValue(new Map([['TAX_RETURNS:VIEW', false]])),
    };
    return { guard: new RolesGuard(reflector, fakeDb({}), grants as never), grants };
  };
  const as = (role: string, customRoleId: string | null = 'c1') => ({
    auth: { userId: 'u1' },
    tenant: { kind: 'staff', role, businessId: FIRM, ...(customRoleId ? { customRoleId } : {}) },
  });

  it("lets a grid role in, or keeps it out, by its custom role's grid", async () => {
    const yes = guardWith(true);
    await expect(yes.guard.canActivate(gridCtx('view', as('BOOKKEEPER')))).resolves.toBe(true);
    expect(yes.grants.customCell).toHaveBeenCalledWith(FIRM, 'c1', 'TAX_RETURNS', 'VIEW');
    expect(yes.grants.can).not.toHaveBeenCalled();
    const no = guardWith(false, { roleCanIt: true });
    await expect(no.guard.canActivate(gridCtx('view', as('BOOKKEEPER')))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("takes a Staff or Admin route away only where the role's default gives it", async () => {
    const { guard, grants } = guardWith(false);
    await expect(guard.canActivate(gridCtx('view', as('STAFF')))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(guard.canActivate(gridCtx('view', as('ADMIN')))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    // Staff has no Payroll by default, yet passes by @Roles: so does its custom role.
    await expect(guard.canActivate(gridCtx('payroll', as('STAFF')))).resolves.toBe(true);
    expect(grants.changes).not.toHaveBeenCalled();
  });

  it("stands in for the Admin role's grid, and the member's own change still wins", async () => {
    // The firm took Tax Returns view from the Admin role; this Admin's custom role gives it.
    const admin = guardWith(true);
    await expect(admin.guard.canActivate(gridCtx('view', as('ADMIN')))).resolves.toBe(true);
    expect(admin.grants.changes).not.toHaveBeenCalled();
    const own = guardWith(false, { own: true });
    await expect(own.guard.canActivate(gridCtx('view', as('STAFF')))).resolves.toBe(true);
    await expect(own.guard.canActivate(gridCtx('view', as('BOOKKEEPER')))).resolves.toBe(true);
  });

  it('never asks without a custom role', async () => {
    const { guard, grants } = guardWith(false, { roleCanIt: true });
    await expect(guard.canActivate(gridCtx('view', as('STAFF', null)))).resolves.toBe(true);
    await expect(guard.canActivate(gridCtx('view', as('MANAGER', null)))).resolves.toBe(true);
    expect(grants.customCell).not.toHaveBeenCalled();
  });
});
