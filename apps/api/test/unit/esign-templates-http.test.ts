// R13 steps 9 and 10, templates over HTTP: the list, get, PATCH, archive, packet, use, duplicate,
// versions and restore routes and save-as-template and save-as-version, their pipes, the status
// codes (archive 200; use, duplicate, restore and both saves 201), the packet's headers, the
// module switch and the 404s across firms and for another member's PRIVATE template, with the
// in-memory ports (no database). A stand-in for TenantGuard puts the caller's firm and role on the
// request, as in esign-requests-http.test.ts. Synthetic data only.
import { PortalInfoService } from '../../src/client-auth/portal-info.controller.js';
import { randomUUID } from 'node:crypto';
import { Global, type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EsignRequestDetail,
  EsignTemplateDetail,
  EsignTemplateList,
  EsignTemplateVersionList,
} from '@firmivra/types';
import { AuditService } from '../../src/audit/audit.service.js';
import { ApiExceptionFilter } from '../../src/common/api-exception.filter.js';
import { BUSINESS_MODULES, ModulesModule } from '../../src/common/modules/requires-module.js';
import { ConfigModule } from '../../src/config/config.module.js';
import { loadEnv } from '../../src/config/env.js';
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
  InMemoryTemplateRepository,
  seedTemplate,
  NO_KIOSK,
  NoDatabaseModule,
} from './esign-fakes.js';

const w = esignWorld();
const templates = new InMemoryTemplateRepository(w.repo);

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
const staffA = (): Caller => ({ user: w.users.staffA, firm: w.a, role: 'STAFF' });
const ownerB = (): Caller => ({ user: w.users.ownerB, firm: w.b, role: 'OWNER' });
const clientA = (): Caller => ({ user: randomUUID(), firm: w.a, role: 'CLIENT' });

type Method = 'get' | 'post' | 'patch';
function call(method: Method, path: string, who: Caller, body?: object) {
  const req = request(app.getHttpServer())
    [method](path.startsWith('/api/') ? path : `/api/v1/esign/templates${path}`)
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
  ['post', `/${id}/use`, { roles: [] }],
  ['post', `/${id}/duplicate`, { name: 'Fake copy' }],
  ['get', `/${id}/versions`, undefined],
  ['post', `/${id}/versions/1/restore`, {}],
];
const saveAs = (requestId: string) => `/api/v1/esign/requests/${requestId}/save-as-template`;
const saveVersion = (requestId: string) => `/api/v1/esign/requests/${requestId}/save-as-version`;

/** A DRAFT for c1 by the owner with one uploaded 1-page file. */
async function draft() {
  const created = await call('post', '/api/v1/esign/requests', ownerA(), {
    title: 'Fake letter',
    source: 'CLIENT_RECORD',
    clientId: w.ids.c1,
  });
  const { id } = EsignRequestDetail.parse(created.body);
  const documentId = randomUUID();
  const s3Key = w.store.keyFor(w.a, id, `source/${documentId}`);
  await w.store.put(w.a, s3Key, new Uint8Array(Buffer.from('pdf:1')), 'application/pdf');
  w.repo.seed(w.a, id, (row) => {
    row.parts.documents = [
      {
        id: documentId,
        position: 0,
        fileName: 'Fake.pdf',
        contentType: 'application/pdf',
        sizeBytes: 5,
        pageCount: 1,
        pageSizes: [{ width: 612, height: 792 }],
        sourceDocumentId: null,
        scanStatus: 'CLEAN',
        createdAt: new Date(),
        s3Key,
        sha256: '0'.repeat(64),
      },
    ];
    row.parts.pagePlan = [{ documentId, page: 0, rotation: 0 }];
  });
  return id;
}

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

  it('saves a request as a template, uses it and duplicates it (201 each)', async () => {
    const requestId = await draft();
    const saved = await call('post', saveAs(requestId), ownerA(), { name: 'Fake saved' });
    expect(saved.status).toBe(201);
    const t = EsignTemplateDetail.parse(saved.body);
    expect([t.visibility, t.pageCount]).toEqual(['PRIVATE', 1]);
    const used = await call('post', `/${t.id}/use`, ownerA(), { clientId: w.ids.c2 });
    expect(used.status).toBe(201);
    expect(EsignRequestDetail.parse(used.body)).toMatchObject({
      status: 'DRAFT',
      source: 'TEMPLATE',
      template: { id: t.id, version: 1 },
    });
    const dup = await call('post', `/${t.id}/duplicate`, ownerA(), { name: 'Fake dup' });
    expect([dup.status, EsignTemplateDetail.parse(dup.body).version]).toEqual([201, 1]);
    const taken = await call('post', saveAs(requestId), ownerA(), { name: 'Fake saved' });
    expect(errorOf(taken)).toEqual([409, 'TEMPLATE_NAME_TAKEN']);
  });

  it('saves a version, lists versions and restores one (201, 200, 201)', async () => {
    const requestId = await draft();
    const t = EsignTemplateDetail.parse(
      (await call('post', saveAs(requestId), ownerA(), { name: 'Fake versioned' })).body,
    );
    const v2 = await call('post', saveVersion(requestId), ownerA(), { templateId: t.id });
    expect([v2.status, EsignTemplateDetail.parse(v2.body).version]).toEqual([201, 2]);
    const list = await call('get', `/${t.id}/versions`, ownerA());
    expect(list.status).toBe(200);
    const versions = EsignTemplateVersionList.parse(list.body).items;
    expect(versions.map((v) => [v.version, v.current])).toEqual([
      [2, true],
      [1, false],
    ]);
    const restored = await call('post', `/${t.id}/versions/1/restore`, ownerA(), {
      note: 'Fake back',
    });
    expect([restored.status, EsignTemplateDetail.parse(restored.body).version]).toEqual([201, 3]);
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
      ['post', `/${t.record.id}/use`, { roles: 'all' }],
      ['post', `/${t.record.id}/use`, { engagementId: randomUUID() }],
      ['post', `/${t.record.id}/use`, { roles: [{ key: 'client' }, { key: 'client' }] }],
      ['post', `/${t.record.id}/use`, { roles: [{ key: 'client', authMethod: 'ACCESS_CODE' }] }],
      ['post', `/${t.record.id}/duplicate`, {}],
      ['post', `/${t.record.id}/duplicate`, { name: 'Fake', visibility: 'ALL' }],
      ['post', saveAs('not-a-uuid'), { name: 'Fake' }],
      ['post', saveAs(randomUUID()), { name: '' }],
      ['post', saveAs(randomUUID()), { name: 'Fake', keepSenderValues: 'yes' }],
      ...['0', 'abc', '1.5', '-1'].map((v): [Method, string, object] => [
        'post',
        `/${t.record.id}/versions/${v}/restore`,
        {},
      ]),
      ['post', `/${t.record.id}/versions/1/restore`, { extra: 1 }],
      ['post', saveVersion(randomUUID()), {}],
      ['post', saveVersion(randomUUID()), { templateId: 'not-a-uuid' }],
      ['post', saveVersion('not-a-uuid'), { templateId: t.record.id }],
    ];
    for (const [method, path, body] of bad) {
      expect(errorOf(await call(method, path, ownerA(), body))).toEqual([400, 'VALIDATION_FAILED']);
    }
  });

  it('answers 404 across firms, for another member’s PRIVATE template and to a client', async () => {
    const t = await seedTemplate(w.a, templates, w.store, w.users.staffA2, {
      visibility: 'PRIVATE',
    });
    const requestId = await draft();
    for (const who of [ownerB(), staffA(), clientA()]) {
      for (const [method, path, body] of routes(t.record.id)) {
        expect(errorOf(await call(method, path, who, body))).toEqual([404, 'NOT_FOUND']);
      }
    }
    for (const who of [ownerB(), clientA()]) {
      const res = await call('post', saveAs(requestId), who, { name: 'Fake cross' });
      expect(errorOf(res)).toEqual([404, 'NOT_FOUND']);
      const version = await call('post', saveVersion(requestId), who, { templateId: t.record.id });
      expect(errorOf(version)).toEqual([404, 'NOT_FOUND']);
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
        ['post', saveAs(randomUUID()), { name: 'Fake' }] as const,
        ['post', saveVersion(randomUUID()), { templateId: randomUUID() }] as const,
      ]) {
        expect(errorOf(await call(method, path, ownerA(), body))).toEqual([403, 'MODULE_OFF']);
      }
    } finally {
      w.modules.set(w.a, 'esign', true);
    }
  });
});
