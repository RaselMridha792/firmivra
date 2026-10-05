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
    @Get('me') @Roles('AUTHENTICATED') me() {}
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

  it('reports exactly the routes nobody could reach', () => {
    expect(routeSiteProblems([AdminRoutes, FirmRoutes], reflector, new MetadataScanner())).toEqual([
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
