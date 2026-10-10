// R13 step 10, bulk send over HTTP: POST /esign/templates/{id}/bulk-send (202) and GET
// /esign/bulk/{batchId}, their pipes (BULK_LIMIT before the contract's own checks, duplicates,
// access codes refused, confirm), the 404s across firms for the template and the batch, and the
// module switch, with the in-memory ports (no database). A stand-in for TenantGuard puts the
// caller's firm and role on the request, as in esign-templates-http.test.ts. Synthetic data only.
import { PortalInfoService } from '../../src/client-auth/portal-info.controller.js';
import { randomUUID } from 'node:crypto';
import { Global, type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EsignBulkBatch } from '@firmivra/types';
import { AuditService } from '../../src/audit/audit.service.js';
import { ApiExceptionFilter } from '../../src/common/api-exception.filter.js';
import { BUSINESS_MODULES, ModulesModule } from '../../src/common/modules/requires-module.js';
import { ConfigModule } from '../../src/config/config.module.js';
import { loadEnv } from '../../src/config/env.js';
import { BULK_REPOSITORY } from '../../src/esign/bulk/bulk.repository.js';
import { CODE_HASHER, ESIGN_STORE, PDF_ENGINE } from '../../src/esign/engine/engine.types.js';
import { EXTRAS_REPOSITORY } from '../../src/esign/extras/extras.repository.js';
import { EsignModule } from '../../src/esign/esign.module.js';
import { ESIGN_DIRECTORY } from '../../src/esign/requests/esign-directory.js';
import { ESIGN_REPOSITORY } from '../../src/esign/requests/esign.repository.js';
import { TEMPLATE_REPOSITORY } from '../../src/esign/templates/templates.repository.js';
import { NOTIFY_SERVICE } from '../../src/notify/notify.types.js';
import {
  esignWorld,
  fakeHasher,
  FakeNotify,
  fakePdf,
  InMemoryBulkRepository,
  InMemoryTemplateRepository,
  seedTemplate,
  NO_KIOSK,
  NoDatabaseModule,
} from './esign-fakes.js';

const w = esignWorld();
const templates = new InMemoryTemplateRepository(w.repo);
const bulk = new InMemoryBulkRepository();

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
    imports: [
      ConfigModule.forRoot(loadEnv()),
      EsignModule,
      NoDatabaseModule,
      FakeAuditModule,
      ModulesModule,
    ],
  })
    .overrideProvider(EXTRAS_REPOSITORY)
    .useValue(NO_KIOSK)
    .overrideProvider(BULK_REPOSITORY)
    .useValue(bulk)
    .overrideProvider(TEMPLATE_REPOSITORY)
    .useValue(templates)
    .overrideProvider(ESIGN_DIRECTORY)
    .useValue(w.directory)
    .overrideProvider(BUSINESS_MODULES)
    .useValue(w.modules)
    .overrideProvider(ESIGN_STORE)
    .useValue(w.store)
    .overrideProvider(ESIGN_REPOSITORY)
    .useValue(w.repo)
    .overrideProvider(PDF_ENGINE)
    .useValue(fakePdf)
    .overrideProvider(CODE_HASHER)
    .useValue(fakeHasher)
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
const staffA2 = (): Caller => ({ user: w.users.staffA2, firm: w.a, role: 'STAFF' });
const ownerB = (): Caller => ({ user: w.users.ownerB, firm: w.b, role: 'OWNER' });
const clientA = (): Caller => ({ user: randomUUID(), firm: w.a, role: 'CLIENT' });

const sendPath = (id: string) => `/api/v1/esign/templates/${id}/bulk-send`;
const batchPath = (id: string) => `/api/v1/esign/bulk/${id}`;
function call(method: 'get' | 'post', path: string, who: Caller, body?: object) {
  const req = request(app.getHttpServer())
    [method](path)
    .set('x-test-user', who.user)
    .set('x-test-firm', who.firm)
    .set('x-test-role', who.role);
  return body ? req.send(body) : req;
}
const errorOf = (res: request.Response) => [
  res.status,
  (res.body as { error?: { code: string } }).error?.code,
];
const valid = (clientId: string) => ({ clients: [{ clientId }], confirm: true });

describe('Firm Sign bulk send over HTTP', () => {
  it('answers 202 with the batch, then GET answers it (200)', async () => {
    const t = await seedTemplate(w.a, templates, w.store, w.users.ownerA);
    const res = await call('post', sendPath(t.record.id), ownerA(), {
      ...valid(w.ids.c2),
      title: 'Fake bulk',
      roles: [{ key: 'client', authMethod: 'LINK' }],
    });
    expect(res.status).toBe(202);
    const b = EsignBulkBatch.parse(res.body);
    expect(b.items.map((i) => [i.clientId, i.state])).toEqual([[w.ids.c2, 'QUEUED']]);
    const got = await call('get', batchPath(b.id), ownerA());
    expect([got.status, EsignBulkBatch.parse(got.body).id]).toEqual([200, b.id]);
  });

  it('answers BULK_LIMIT for more than 200 clients, before any other check', async () => {
    const t = await seedTemplate(w.a, templates, w.store, w.users.ownerA);
    const clients = Array.from({ length: 201 }, () => ({ clientId: w.ids.c2 }));
    const res = await call('post', sendPath(t.record.id), ownerA(), { clients, confirm: true });
    expect(errorOf(res)).toEqual([400, 'BULK_LIMIT']);
    expect(bulk.batches.of(w.a).size).toBe(1); // only the batch of the first test
  });

  it('validates ids and bodies with the contract (400), access codes refused', async () => {
    const t = await seedTemplate(w.a, templates, w.store, w.users.ownerA);
    const p = sendPath(t.record.id);
    const id = w.ids.c2;
    const bad: [string, object][] = [
      [sendPath('not-a-uuid'), valid(id)],
      [p, { clients: [{ clientId: id }] }],
      [p, { clients: [{ clientId: id }], confirm: false }],
      [p, { clients: [], confirm: true }],
      [p, { clients: [{ clientId: id }, { clientId: id }], confirm: true }],
      [p, { clients: [{ clientId: 'nope' }], confirm: true }],
      [p, { ...valid(id), extra: 1 }],
      [p, { ...valid(id), roles: [{ key: 'client', authMethod: 'ACCESS_CODE' }] }],
      [p, { ...valid(id), roles: [{ key: 'client', authMethod: 'LINK', accessCode: 'FAKE1234' }] }],
      [
        p,
        {
          ...valid(id),
          roles: [{ key: 'client', who: { type: 'CLIENT_LOGIN', clientAccountId: w.ids.c2Login } }],
        },
      ],
      [p, { ...valid(id), roles: [{ key: 'client' }, { key: 'client', delivery: 'EMAIL' }] }],
    ];
    for (const [path, body] of bad) {
      expect(errorOf(await call('post', path, ownerA(), body))).toEqual([400, 'VALIDATION_FAILED']);
    }
    expect(errorOf(await call('get', batchPath('not-a-uuid'), ownerA()))).toEqual([
      400,
      'VALIDATION_FAILED',
    ]);
  });

  it('answers 404 across firms (template and batch), to another member and to a client', async () => {
    const t = await seedTemplate(w.a, templates, w.store, w.users.ownerA);
    const b = EsignBulkBatch.parse(
      (await call('post', sendPath(t.record.id), ownerA(), valid(w.ids.c2))).body,
    );
    const before = bulk.batches.of(w.b).size;
    for (const who of [ownerB(), clientA()]) {
      const res = await call('post', sendPath(t.record.id), who, valid(w.ids.cB));
      expect(errorOf(res)).toEqual([404, 'NOT_FOUND']);
    }
    for (const who of [ownerB(), staffA2(), clientA()]) {
      expect(errorOf(await call('get', batchPath(b.id), who))).toEqual([404, 'NOT_FOUND']);
    }
    expect(bulk.batches.of(w.b).size).toBe(before);
  });

  it('answers MODULE_OFF (403) when off', async () => {
    w.modules.set(w.a, 'esign', false);
    try {
      const res = await call('post', sendPath(randomUUID()), ownerA(), valid(w.ids.c2));
      expect(errorOf(res)).toEqual([403, 'MODULE_OFF']);
      expect(errorOf(await call('get', batchPath(randomUUID()), ownerA()))).toEqual([
        403,
        'MODULE_OFF',
      ]);
    } finally {
      w.modules.set(w.a, 'esign', true);
    }
  });
});
