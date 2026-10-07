// Unit tests for R2 step 5: route/site check, firm statuses per route, platform scope.
import {
  Controller,
  type ExecutionContext,
  ForbiddenException,
  Get,
  NotFoundException,
} from '@nestjs/common';
import { MetadataScanner, Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@firmivra/db';
import {
  AllowBusinessStatuses,
  FIRM_MANAGERS,
  FIRM_STAFF,
  Public,
  Roles,
} from '../../src/auth/decorators.js';
import { RolesGuard } from '../../src/auth/roles.guard.js';
import { routeSiteProblems } from '../../src/auth/route-sites.js';
import { TenantGuard } from '../../src/auth/tenant.guard.js';
import { requestContext } from '../../src/common/request-context.js';
import { PlatformPrisma } from '../../src/database/database.module.js';

const reflector = new Reflector();
const FIRM = '0190a000-0000-7000-8000-000000000001';

describe('routeSiteProblems', () => {
  @Controller('admin/firms')
  class AdminRoutes {
    @Get() @Roles('SUPER_ADMIN') list() {}
    @Get('me') @Roles('SUPER_ADMIN') me() {}
    @Get('mixed') @Roles('OWNER') firmRoleOnAdmin() {}
  }

  @Controller()
  class FirmRoutes {
    @Get('team') @Roles(...FIRM_MANAGERS) team() {}
    @Get('open') @Public() open() {}
    @Get('forgotten') forgotten() {}
    @Get('reports') @Roles('SUPER_ADMIN') superAdminOutside() {}
    @Get('admin/stats') @Roles('SUPER_ADMIN') superAdminInside() {}
    helper() {}
  }

  /** Express routes /api/v1/ADMIN/... to the same handler, and siteOf() ignores case too. */
  @Controller('Admin/Reports')
  class MixedCaseAdminRoutes {
    @Get() @Roles('SUPER_ADMIN') list() {}
  }

  it('reports exactly the routes nobody could reach', () => {
    expect(
      routeSiteProblems(
        [AdminRoutes, FirmRoutes, MixedCaseAdminRoutes],
        reflector,
        new MetadataScanner(),
      ),
    ).toEqual([
      'AdminRoutes.firmRoleOnAdmin (/admin/firms/mixed): firm role on a Super Admin route',
      'FirmRoutes.superAdminOutside (/reports): SUPER_ADMIN outside /admin/',
    ]);
  });

  it('has role groups that read as the firm hierarchy', () => {
    expect(FIRM_STAFF).toEqual(['OWNER', 'ADMIN', 'STAFF']);
    expect(FIRM_MANAGERS).toEqual(['OWNER', 'ADMIN']);
  });
});

class Probe {
  @Roles('OWNER') ownerDefault() {}
  @Roles('OWNER') @AllowBusinessStatuses('PENDING_SETUP', 'ACTIVE') setupWizard() {}
  @Roles('SUPER_ADMIN') superAdmin() {}
}

/** The guards see `req` itself (with the selected firm header), so tests can read what they set. */
function ctx(method: keyof Probe, req: Record<string, unknown>): ExecutionContext {
  const request = Object.assign(req, { get: () => FIRM, params: {} });
  return {
    getHandler: () => Probe.prototype[method],
    getClass: () => Probe,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function tenantDb(status: string, member: boolean) {
  return {
    forPlatform: () => ({
      business: { findUnique: vi.fn().mockResolvedValue({ id: FIRM, status }) },
    }),
    forBusiness: () => ({
      membership: { findFirst: vi.fn().mockResolvedValue(member ? { role: 'OWNER' } : null) },
    }),
  } as unknown as Database;
}

const staff = { userId: 'u1', cognitoSub: 's1', pool: 'STAFF' };

async function codeOf(p: Promise<unknown>) {
  const e: unknown = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  if (!(e instanceof ForbiddenException)) throw e instanceof Error ? e : new Error('no error');
  return (e.getResponse() as { code: string }).code;
}

describe('TenantGuard: firm statuses per route', () => {
  it('lets an ACTIVE firm through by default', async () => {
    const guard = new TenantGuard(reflector, tenantDb('ACTIVE', true));
    await expect(guard.canActivate(ctx('ownerDefault', { auth: staff }))).resolves.toBe(true);
  });

  it('refuses a firm still in setup, unless the route allows it', async () => {
    const guard = new TenantGuard(reflector, tenantDb('PENDING_SETUP', true));
    expect(await codeOf(guard.canActivate(ctx('ownerDefault', { auth: staff })))).toBe(
      'BUSINESS_SETUP_REQUIRED',
    );
    await expect(guard.canActivate(ctx('setupWizard', { auth: staff }))).resolves.toBe(true);
  });

  it('refuses a suspended firm even on a route that allows setup', async () => {
    const guard = new TenantGuard(reflector, tenantDb('SUSPENDED', true));
    expect(await codeOf(guard.canActivate(ctx('setupWizard', { auth: staff })))).toBe(
      'BUSINESS_INACTIVE',
    );
  });

  it('answers 404 to an outsider, so the status of their firm never shows', async () => {
    const guard = new TenantGuard(reflector, tenantDb('PENDING_SETUP', false));
    await expect(guard.canActivate(ctx('ownerDefault', { auth: staff }))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('RolesGuard: platform scope', () => {
  const admin = { userId: 'a1', cognitoSub: 'sa', pool: 'ADMIN' };
  const db = (row: unknown) =>
    ({
      forPlatform: () => ({ platformAdmin: { findUnique: vi.fn().mockResolvedValue(row) } }),
    }) as unknown as Database;

  it('admits a Super Admin and records the platform scope', async () => {
    const req: Record<string, unknown> = { auth: admin };
    await requestContext.run({ requestId: 'r1' }, async () => {
      await expect(
        new RolesGuard(reflector, db({ role: 'SUPER_ADMIN' })).canActivate(ctx('superAdmin', req)),
      ).resolves.toBe(true);
      expect(requestContext.getStore()?.platform).toEqual({ role: 'SUPER_ADMIN' });
    });
    expect(req['platform']).toEqual({ role: 'SUPER_ADMIN' });
  });

  it.each([
    ['no platform_admins row', null],
    ['another platform role', { role: 'SUPPORT' }],
  ])('refuses %s', async (_case, row) => {
    const req: Record<string, unknown> = { auth: admin };
    await expect(
      new RolesGuard(reflector, db(row)).canActivate(ctx('superAdmin', req)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(req['platform']).toBeUndefined();
  });
});

describe('PlatformPrisma', () => {
  const platformClient = { marker: 'platform' };
  const database = { forPlatform: () => platformClient } as unknown as Database;
  const platform = new PlatformPrisma(database);

  it('opens platform tables only in a verified Super Admin request', () => {
    expect(() => platform.db).toThrow(/outside a Super Admin request/);
    requestContext.run(
      { requestId: 'r1', tenant: { businessId: FIRM, role: 'OWNER', kind: 'staff' } },
      () => expect(() => platform.db).toThrow(/outside a Super Admin request/),
    );
    requestContext.run({ requestId: 'r2', platform: { role: 'SUPER_ADMIN' } }, () =>
      expect(platform.db).toBe(platformClient),
    );
  });
});

describe('routeSiteProblems (#25 review)', () => {
  @Controller('admin/reports')
  class AdminAuthenticated {
    @Get() @Roles('AUTHENTICATED') list() {}
  }

  @Controller('things')
  @Public()
  class PublicClassWithRoles {
    @Get() @Roles(...FIRM_STAFF) list() {}
  }

  @Controller('others')
  @Roles(...FIRM_STAFF)
  class RolesClassWithPublicHandler {
    @Get('open') @Public() open() {}
  }

  it('refuses AUTHENTICATED on Super Admin routes and routes with both @Public and @Roles', () => {
    expect(
      routeSiteProblems(
        [AdminAuthenticated, PublicClassWithRoles, RolesClassWithPublicHandler],
        reflector,
        new MetadataScanner(),
      ),
    ).toEqual([
      'AdminAuthenticated.list (/admin/reports): AUTHENTICATED on a Super Admin route (use SUPER_ADMIN)',
      'PublicClassWithRoles.list (/things): both @Public() and @Roles()',
      'RolesClassWithPublicHandler.open (/others/open): both @Public() and @Roles()',
    ]);
  });
});

describe('TenantGuard: firm from the portal slug only, client account in the context (#25)', () => {
  class Routes {
    @Roles('CLIENT') portal() {}
    @Roles(...FIRM_STAFF) staffWithSlug() {}
  }
  const OTHER_FIRM = '0190a000-0000-7000-8000-000000000002';
  const client = { userId: 'c1', cognitoSub: 'sc', pool: 'CLIENT' };

  function guardWith(findBusiness: ReturnType<typeof vi.fn>) {
    const db = {
      forPlatform: () => ({ business: { findUnique: findBusiness } }),
      forBusiness: () => ({
        clientAccount: { findFirst: vi.fn().mockResolvedValue({ id: 'client-account-1' }) },
        membership: { findFirst: vi.fn().mockResolvedValue({ role: 'STAFF' }) },
      }),
      forUser: () => ({
        membership: { findMany: vi.fn().mockResolvedValue([{ businessId: FIRM }]) },
      }),
    } as unknown as Database;
    return new TenantGuard(reflector, db);
  }

  function ctxFor(method: keyof Routes, req: Record<string, unknown>): ExecutionContext {
    const request = Object.assign(req, { get: () => undefined });
    return {
      getHandler: () => Routes.prototype[method],
      getClass: () => Routes,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  it('puts the client account id from the database into the context', async () => {
    const find = vi.fn(({ where }: { where: { slug?: string } }) =>
      Promise.resolve(where.slug ? { id: FIRM } : { id: FIRM, status: 'ACTIVE' }),
    );
    const req: Record<string, unknown> = {
      auth: client,
      path: '/api/v1/portal/LVP/documents',
      params: { firmSlug: 'LVP' },
    };
    await expect(guardWith(find).canActivate(ctxFor('portal', req))).resolves.toBe(true);
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ where: { slug: 'lvp' } }));
    expect(req['tenant']).toEqual({
      businessId: FIRM,
      role: 'CLIENT',
      kind: 'client',
      clientAccountId: 'client-account-1',
    });
  });

  it('never lets a :slug param on a staff route choose the firm', async () => {
    const find = vi.fn().mockResolvedValue({ id: FIRM, status: 'ACTIVE' });
    const req: Record<string, unknown> = {
      auth: { userId: 's1', cognitoSub: 'ss', pool: 'STAFF' },
      path: '/api/v1/things/other-firm',
      params: { slug: 'other-firm', firmSlug: 'other-firm' },
    };
    await expect(guardWith(find).canActivate(ctxFor('staffWithSlug', req))).resolves.toBe(true);
    expect(find).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: expect.anything() } }),
    );
    expect((req['tenant'] as { businessId: string }).businessId).toBe(FIRM);
    expect(OTHER_FIRM).not.toBe(FIRM);
  });
});
