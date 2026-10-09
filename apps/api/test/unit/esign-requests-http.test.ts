// R13 step 6, requests API part 1: the module switch over HTTP, with an in-memory switch (no
// database). A stand-in for TenantGuard puts the caller's firm and role on the request, as the
// global guards do in the app; the real guard stack is in test/e2e/esign-status.e2e.test.ts.
// Synthetic data only.
import { randomUUID } from 'node:crypto';
import { Controller, ExecutionContext, Get, type INestApplication, Module } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiExceptionFilter } from '../../src/common/api-exception.filter.js';
import {
  BUSINESS_MODULES,
  type FirmModule,
  ModuleGuard,
  ModulesModule,
  RequiresModule,
} from '../../src/common/modules/requires-module.js';

const firmA = randomUUID();
const firmB = randomUUID();
const on = new Set([`${firmA}:esign`, `${firmB}:esign`]);
const modules = {
  isEnabled: (businessId: string, module: FirmModule) =>
    Promise.resolve(on.has(`${businessId}:${module}`)),
};

/** A route behind the module switch, as the requests routes are (part 1b). */
@Controller('probe')
@RequiresModule('esign')
class ProbeController {
  @Get()
  probe() {
    return { ok: true };
  }
}

@Module({ imports: [ModulesModule], controllers: [ProbeController] })
class ProbeModule {}

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] })
    .overrideProvider(BUSINESS_MODULES)
    .useValue(modules)
    .compile();
  app = moduleRef.createNestApplication();
  // What AuthGuard and TenantGuard set, from test headers.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const firm = req.get('x-test-firm');
    const role = req.get('x-test-role') as 'OWNER' | 'CLIENT';
    if (firm) {
      req.tenant =
        role === 'CLIENT'
          ? { businessId: firm, role, kind: 'client', clientAccountId: randomUUID() }
          : { businessId: firm, role, kind: 'staff' };
    }
    next();
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();
});

afterAll(async () => {
  await app.close();
});

const probe = (firm: string, role: 'OWNER' | 'CLIENT') =>
  request(app.getHttpServer())
    .get('/api/v1/probe')
    .set('x-test-firm', firm)
    .set('x-test-role', role);
const errorOf = (res: request.Response) => [
  res.status,
  (res.body as { error?: { code: string } }).error?.code,
];

describe('@RequiresModule over HTTP', () => {
  it('closes the route when off: 403 MODULE_OFF for staff, 404 for clients, per firm', async () => {
    expect((await probe(firmA, 'OWNER')).status).toBe(200);
    on.delete(`${firmA}:esign`);
    try {
      expect(errorOf(await probe(firmA, 'OWNER'))).toEqual([403, 'MODULE_OFF']);
      expect(errorOf(await probe(firmA, 'CLIENT'))).toEqual([404, 'NOT_FOUND']);
      expect((await probe(firmB, 'OWNER')).status).toBe(200);
    } finally {
      on.add(`${firmA}:esign`);
    }
  });
});

describe('the module switch (ModuleGuard)', () => {
  const guardFor = (enabled: boolean) => {
    const fixed = { isEnabled: () => Promise.resolve(enabled) };
    return new ModuleGuard(new Reflector(), fixed);
  };
  const handler = () => undefined;
  Reflect.defineMetadata('firmivra:module', 'esign', handler);
  const ctx = (tenant: Request['tenant'], h: () => void = handler) =>
    ({
      getHandler: () => h,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ tenant }) }),
    }) as unknown as ExecutionContext;
  const staffTenant = { businessId: randomUUID(), role: 'STAFF' as const, kind: 'staff' as const };
  const clientTenant = {
    businessId: randomUUID(),
    role: 'CLIENT' as const,
    kind: 'client' as const,
    clientAccountId: randomUUID(),
  };
  const answer = async (work: Promise<boolean>) =>
    work.then(
      () => 'allowed',
      (e: { getStatus(): number; getResponse(): { code: string } }) =>
        `${e.getStatus()} ${e.getResponse().code}`,
    );

  it('lets a firm through when on; off is 403 MODULE_OFF for staff, 404 for clients and public routes', async () => {
    expect(await answer(guardFor(true).canActivate(ctx(staffTenant)))).toBe('allowed');
    expect(await answer(guardFor(true).canActivate(ctx(clientTenant)))).toBe('allowed');
    expect(await answer(guardFor(false).canActivate(ctx(staffTenant)))).toBe('403 MODULE_OFF');
    expect(await answer(guardFor(false).canActivate(ctx(clientTenant)))).toBe('404 NOT_FOUND');
    expect(await answer(guardFor(true).canActivate(ctx(undefined)))).toBe('404 NOT_FOUND');
    // A route without @RequiresModule is not the guard's business.
    expect(await answer(guardFor(false).canActivate(ctx(staffTenant, () => 1)))).toBe('allowed');
  });
});
