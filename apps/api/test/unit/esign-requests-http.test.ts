// R13 step 6, requests API part 1b, over HTTP: EsignModule's status and draft routes, pipes
// and the module switch with the in-memory ports (no database). A stand-in for TenantGuard
// puts the caller's firm and role on the request, as the global guards do in the app; the
// guards themselves are tested in guards.test.ts and the e2e suite. Synthetic data only.
import { randomUUID } from 'node:crypto';
import {
  Controller,
  ExecutionContext,
  Get,
  Global,
  type INestApplication,
  Module,
  type ModuleMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EsignRequestDetail, EsignStatus } from '@firmivra/types';
import { AuditService } from '../../src/audit/audit.service.js';
import { ApiExceptionFilter } from '../../src/common/api-exception.filter.js';
import {
  BUSINESS_MODULES,
  ModuleGuard,
  ModulesModule,
  RequiresModule,
} from '../../src/common/modules/requires-module.js';
import { CODE_HASHER, ESIGN_STORE } from '../../src/esign/engine/engine.types.js';
import { EsignModule } from '../../src/esign/esign.module.js';
import { ESIGN_DIRECTORY } from '../../src/esign/requests/esign-directory.js';
import { ESIGN_REPOSITORY, notMigrated } from '../../src/esign/requests/esign.repository.js';
import { ConfigModule } from '../../src/config/config.module.js';
import { loadEnv } from '../../src/config/env.js';
import { esignWorld, fakeHasher } from './esign-fakes.js';

const w = esignWorld();

@Global()
@Module({ providers: [{ provide: AuditService, useValue: w.audit }], exports: [AuditService] })
class FakeAuditModule {}

/** A route behind the module switch, as the requests routes are (part 1b). */
@Controller('probe')
@RequiresModule('esign')
class ProbeController {
  @Get()
  probe() {
    return { ok: true };
  }
}

let app: INestApplication;

beforeAll(async () => {
  const metadata: ModuleMetadata = {
    imports: [ConfigModule.forRoot(loadEnv()), EsignModule, FakeAuditModule, ModulesModule],
    controllers: [ProbeController],
  };
  const moduleRef = await Test.createTestingModule(metadata)
    .overrideProvider(ESIGN_REPOSITORY)
    .useValue(w.repo)
    .overrideProvider(ESIGN_DIRECTORY)
    .useValue(w.directory)
    .overrideProvider(BUSINESS_MODULES)
    .useValue(w.modules)
    .overrideProvider(CODE_HASHER)
    .useValue(fakeHasher)
    .overrideProvider(ESIGN_STORE)
    .useValue(w.store)
    .compile();
  app = moduleRef.createNestApplication();
  // What AuthGuard and TenantGuard set, from test headers.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const user = req.get('x-test-user');
    const firm = req.get('x-test-firm');
    const role = req.get('x-test-role') as 'OWNER' | 'ADMIN' | 'STAFF' | 'CLIENT';
    if (user && firm) {
      req.auth = { userId: user, cognitoSub: user, pool: role === 'CLIENT' ? 'CLIENT' : 'STAFF' };
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

type Caller = { user: string; firm: string; role: 'OWNER' | 'STAFF' | 'CLIENT' };
const ownerA = (): Caller => ({ user: w.users.ownerA, firm: w.a, role: 'OWNER' });
const staffA2 = (): Caller => ({ user: w.users.staffA2, firm: w.a, role: 'STAFF' });
const ownerB = (): Caller => ({ user: w.users.ownerB, firm: w.b, role: 'OWNER' });
const clientA = (): Caller => ({ user: randomUUID(), firm: w.a, role: 'CLIENT' });

function send(
  method: 'get' | 'post' | 'patch' | 'put' | 'delete',
  path: string,
  who: Caller,
  body?: object,
) {
  const req = request(app.getHttpServer())
    [method](`/api/v1${path}`)
    .set('x-test-user', who.user)
    .set('x-test-firm', who.firm)
    .set('x-test-role', who.role);
  return body === undefined ? req : req.send(body);
}
const call = (path: string, who: Caller) => send('get', path, who);
const errorOf = (res: request.Response) => [
  res.status,
  (res.body as { error?: { code: string } }).error?.code,
];

describe('Firm Sign over HTTP', () => {
  it('answers status in every case: on with the role, off with none (never MODULE_OFF)', async () => {
    const on = await call('/esign/status', ownerA());
    expect(EsignStatus.parse(on.body)).toEqual({ enabled: true, myEsignRole: 'OWNER' });
    const staff = await call('/esign/status', staffA2());
    expect(staff.body).toEqual({ enabled: true, myEsignRole: 'STAFF' });
    w.modules.set(w.a, 'esign', false);
    try {
      const off = await call('/esign/status', ownerA());
      expect([off.status, off.body]).toEqual([200, { enabled: false, myEsignRole: null }]);
      // Firm B's switch is its own.
      expect((await call('/esign/status', ownerB())).body).toEqual({
        enabled: true,
        myEsignRole: 'OWNER',
      });
    } finally {
      w.modules.set(w.a, 'esign', true);
    }
  });

  it('closes @RequiresModule routes when off: 403 MODULE_OFF for staff, 404 for clients', async () => {
    expect((await call('/probe', ownerA())).status).toBe(200);
    w.modules.set(w.a, 'esign', false);
    try {
      expect(errorOf(await call('/probe', ownerA()))).toEqual([403, 'MODULE_OFF']);
      expect(errorOf(await call('/probe', clientA()))).toEqual([404, 'NOT_FOUND']);
      expect((await call('/probe', ownerB())).status).toBe(200);
    } finally {
      w.modules.set(w.a, 'esign', true);
    }
  });
});

describe('Firm Sign drafts over HTTP', () => {
  it('answers MODULE_OFF (403) on every draft route when off', async () => {
    const created = await send('post', '/esign/requests', ownerA(), { title: 'Fake letter' });
    expect(created.status).toBe(201);
    const { id } = EsignRequestDetail.parse(created.body);
    w.modules.set(w.a, 'esign', false);
    try {
      for (const res of [
        await send('post', '/esign/requests', ownerA(), { title: 'Fake letter' }),
        await send('get', `/esign/requests/${id}`, ownerA()),
        await send('patch', `/esign/requests/${id}`, ownerA(), { title: 'x' }),
        await send('delete', `/esign/requests/${id}`, ownerA()),
      ]) {
        expect(errorOf(res)).toEqual([403, 'MODULE_OFF']);
      }
    } finally {
      w.modules.set(w.a, 'esign', true);
    }
  });

  it('runs a draft through create, update, get and delete, validating bodies with the contract', async () => {
    const created = await send('post', '/esign/requests', ownerA(), {
      title: 'Form 8879',
      source: 'CLIENT_RECORD',
      clientId: w.ids.c1,
      engagementId: w.ids.e1,
    });
    const { id } = EsignRequestDetail.parse(created.body);
    const bad = await send('post', '/esign/requests', ownerA(), {
      title: 'x',
      source: 'CLIENT_RECORD',
    });
    expect(errorOf(bad)).toEqual([400, 'VALIDATION_FAILED']);
    expect(errorOf(await call('/esign/requests/not-a-uuid', ownerA()))).toEqual([
      400,
      'VALIDATION_FAILED',
    ]);
    const patched = await send('patch', `/esign/requests/${id}`, ownerA(), {
      emailSubject: 'Sign me',
    });
    expect([patched.status, patched.body.emailSubject]).toEqual([200, 'Sign me']);
    const detail = EsignRequestDetail.parse((await call(`/esign/requests/${id}`, ownerA())).body);
    expect(detail.client?.id).toBe(w.ids.c1);

    // Another firm, and Staff not assigned to the client: 404 as if it did not exist.
    expect(errorOf(await call(`/esign/requests/${id}`, ownerB()))).toEqual([404, 'NOT_FOUND']);
    expect(errorOf(await call(`/esign/requests/${id}`, staffA2()))).toEqual([404, 'NOT_FOUND']);

    const gone = await send('delete', `/esign/requests/${id}`, ownerA());
    expect([gone.status, gone.body]).toEqual([200, { ok: true }]);
    expect(errorOf(await call(`/esign/requests/${id}`, ownerA()))).toEqual([404, 'NOT_FOUND']);
  });
});

describe('the module switch (ModuleGuard)', () => {
  const guardFor = (enabled: boolean) => {
    const modules = { isEnabled: () => Promise.resolve(enabled) };
    return new ModuleGuard(new Reflector(), modules);
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

  it('fails loudly in a port that is not on main yet', () => {
    const stand = notMigrated<{ findRequest(): Promise<unknown>; then?: unknown }>('Repo');
    expect(stand.then).toBeUndefined();
    expect(() => stand.findRequest()).toThrow(/Repo.findRequest is not available yet/);
  });
});
