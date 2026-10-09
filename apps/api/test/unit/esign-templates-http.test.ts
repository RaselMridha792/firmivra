// R13 step 9, templates over HTTP: EsignTemplatesController's list, get, PATCH, archive and packet
// routes, their pipes, the status codes (archive is 200), the packet's headers, the module switch
// and the 404s across firms and for another member's PRIVATE template, with the in-memory ports
// (no database). A stand-in for TenantGuard puts the caller's firm and role on the request, as in
// esign-requests-http.test.ts. Synthetic data only.
import { PortalInfoService } from '../../src/client-auth/portal-info.controller.js';
import { randomUUID } from 'node:crypto';
import { Global, type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EsignTemplateDetail, EsignTemplateList } from '@firmivra/types';
import { AuditService } from '../../src/audit/audit.service.js';
import { ApiExceptionFilter } from '../../src/common/api-exception.filter.js';
import { BUSINESS_MODULES, ModulesModule } from '../../src/common/modules/requires-module.js';
import { ConfigModule } from '../../src/config/config.module.js';
import { loadEnv } from '../../src/config/env.js';
import { ESIGN_STORE } from '../../src/esign/engine/engine.types.js';
import { EsignModule } from '../../src/esign/esign.module.js';
import { ESIGN_DIRECTORY } from '../../src/esign/requests/esign-directory.js';
import { TEMPLATE_REPOSITORY } from '../../src/esign/templates/templates.repository.js';
import { NOTIFY_SERVICE } from '../../src/notify/notify.types.js';
import { esignWorld, FakeNotify, InMemoryTemplateRepository, seedTemplate } from './esign-fakes.js';

const w = esignWorld();
const templates = new InMemoryTemplateRepository();

@Global()
@Module({
  providers: [
    { provide: AuditService, useValue: w.audit },
    { provide: NOTIFY_SERVICE, useValue: new FakeNotify() },
  ],
  exports: [AuditService, NOTIFY_SERVICE],
})
class FakeAuditModule {}

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot(loadEnv()), EsignModule, FakeAuditModule, ModulesModule],
  })
    .overrideProvider(TEMPLATE_REPOSITORY)
    .useValue(templates)
    .overrideProvider(ESIGN_DIRECTORY)
    .useValue(w.directory)
    .overrideProvider(BUSINESS_MODULES)
    .useValue(w.modules)
    .overrideProvider(ESIGN_STORE)
    .useValue(w.store)
    // The signer routes' firm lookup (not used by these routes).
    .overrideProvider(PortalInfoService)
    .useValue({ activeFirm: () => Promise.reject(new Error('not used here')) })
    .compile();
  app = moduleRef.createNestApplication();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const user = req.get('x-test-user');
    const firm = req.get('x-test-firm');
    const role = req.get('x-test-role') as 'OWNER' | 'STAFF' | 'CLIENT';
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
const staffA = (): Caller => ({ user: w.users.staffA, firm: w.a, role: 'STAFF' });
const ownerB = (): Caller => ({ user: w.users.ownerB, firm: w.b, role: 'OWNER' });
const clientA = (): Caller => ({ user: randomUUID(), firm: w.a, role: 'CLIENT' });

type Method = 'get' | 'post' | 'patch';
function call(method: Method, path: string, who: Caller, body?: object) {
  const req = request(app.getHttpServer())
    [method](`/api/v1/esign/templates${path}`)
    .set('x-test-user', who.user)
    .set('x-test-firm', who.firm)
    .set('x-test-role', who.role);
  return body ? req.send(body) : req;
}
const errorOf = (res: request.Response) => [
  res.status,
  (res.body as { error?: { code: string } }).error?.code,
];
const routes = (id: string): [Method, string, object | undefined][] => [
  ['get', `/${id}`, undefined],
  ['patch', `/${id}`, { name: 'Fake name' }],
  ['post', `/${id}/archive`, {}],
  ['get', `/${id}/packet`, undefined],
];

describe('Firm Sign templates over HTTP', () => {
  it('lists, reads, renames and archives (200)', async () => {
    const t = await seedTemplate(w.a, templates, w.store, w.users.staffA, { name: 'Fake list' });
    const listed = await call('get', '?q=fake%20list', staffA());
    expect(listed.status).toBe(200);
    expect(EsignTemplateList.parse(listed.body).items.map((x) => x.id)).toEqual([t.record.id]);
    const got = await call('get', `/${t.record.id}`, staffA());
    expect([got.status, EsignTemplateDetail.parse(got.body).roles.length]).toEqual([200, 2]);
    const renamed = await call('patch', `/${t.record.id}`, staffA(), { name: 'Fake renamed' });
    expect([renamed.status, EsignTemplateDetail.parse(renamed.body).name]).toEqual([
      200,
      'Fake renamed',
    ]);
    const archived = await call('post', `/${t.record.id}/archive`, staffA(), {});
    expect(archived.status).toBe(200);
    expect(EsignTemplateDetail.parse(archived.body).archivedAt).not.toBeNull();
    const listedArchived = await call('get', '?archived=true', staffA());
    expect(EsignTemplateList.parse(listedArchived.body).items.map((x) => x.id)).toContain(
      t.record.id,
    );
    expect(errorOf(await call('post', `/${t.record.id}/archive`, staffA(), {}))).toEqual([
      409,
      'TEMPLATE_ARCHIVED',
    ]);
  });

  it('answers the packet as a PDF that is never cached', async () => {
    const t = await seedTemplate(w.a, templates, w.store, w.users.ownerA);
    const res = await call('get', `/${t.record.id}/packet`, staffA()).buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(Buffer.from(res.body as Buffer).toString()).toBe('pdf:2');
  });

  it('validates ids, bodies and the query with the contract (400)', async () => {
    const t = await seedTemplate(w.a, templates, w.store, w.users.ownerA);
    const bad: [Method, string, object | undefined][] = [
      ...routes('not-a-uuid'),
      ['patch', `/${t.record.id}`, {}],
      ['patch', `/${t.record.id}`, { name: '' }],
      ['patch', `/${t.record.id}`, { visibility: 'EVERYONE' }],
      ['patch', `/${t.record.id}`, { name: 'Fake', extra: 1 }],
      ['get', '?archived=maybe', undefined],
      ['get', '?extra=1', undefined],
    ];
    for (const [method, path, body] of bad) {
      expect(errorOf(await call(method, path, ownerA(), body))).toEqual([400, 'VALIDATION_FAILED']);
    }
  });

  it('answers 404 across firms, for another member’s PRIVATE template and to a client', async () => {
    const t = await seedTemplate(w.a, templates, w.store, w.users.staffA2, {
      visibility: 'PRIVATE',
    });
    for (const who of [ownerB(), staffA(), clientA()]) {
      for (const [method, path, body] of routes(t.record.id)) {
        expect(errorOf(await call(method, path, who, body))).toEqual([404, 'NOT_FOUND']);
      }
    }
    expect(EsignTemplateList.parse((await call('get', '', ownerB())).body).items).toEqual([]);
    expect((await templates.find(w.a, t.record.id))?.name).toBe(t.record.name);
  });

  it('answers MODULE_OFF (403) when off', async () => {
    w.modules.set(w.a, 'esign', false);
    try {
      for (const [method, path, body] of [
        ['get', '', undefined] as const,
        ...routes(randomUUID()),
      ]) {
        expect(errorOf(await call(method, path, ownerA(), body))).toEqual([403, 'MODULE_OFF']);
      }
    } finally {
      w.modules.set(w.a, 'esign', true);
    }
  });
});
