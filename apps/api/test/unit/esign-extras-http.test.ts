// R13 extras (contract 3) over HTTP: EsignExtrasController's routes, their pipes, status codes
// (every action POST is 200), the module switch and the 404s across firms and clients, with the
// in-memory ports (no database). A stand-in for TenantGuard puts the caller's firm and role on the
// request, as in esign-lifecycle-http.test.ts. Synthetic data only.
import { randomUUID } from 'node:crypto';
import { Global, type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EsignApproverList, EsignRequestDetail } from '@firmivra/types';
import { AuditService } from '../../src/audit/audit.service.js';
import { ApiExceptionFilter } from '../../src/common/api-exception.filter.js';
import { BUSINESS_MODULES, ModulesModule } from '../../src/common/modules/requires-module.js';
import { ConfigModule } from '../../src/config/config.module.js';
import { loadEnv } from '../../src/config/env.js';
import { CODE_HASHER, ESIGN_STORE, PDF_ENGINE } from '../../src/esign/engine/engine.types.js';
import { EsignModule } from '../../src/esign/esign.module.js';
import { EXTRAS_REPOSITORY } from '../../src/esign/extras/extras.repository.js';
import { LIFECYCLE_REPOSITORY } from '../../src/esign/lifecycle/lifecycle.repository.js';
import { ESIGN_DIRECTORY } from '../../src/esign/requests/esign-directory.js';
import { ESIGN_REPOSITORY } from '../../src/esign/requests/esign.repository.js';
import { NOTIFY_SERVICE } from '../../src/notify/notify.types.js';
import {
  esignWorld,
  fakeHasher,
  FakeNotify,
  fakePdf,
  InMemoryExtrasRepository,
  InMemoryLifecycleRepository,
  sentRecipient,
} from './esign-fakes.js';

const w = esignWorld();
const notify = new FakeNotify();

@Global()
@Module({
  providers: [
    { provide: AuditService, useValue: w.audit },
    { provide: NOTIFY_SERVICE, useValue: notify },
  ],
  exports: [AuditService, NOTIFY_SERVICE],
})
class FakeAuditModule {}

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot(loadEnv()), EsignModule, FakeAuditModule, ModulesModule],
  })
    .overrideProvider(ESIGN_REPOSITORY)
    .useValue(w.repo)
    .overrideProvider(LIFECYCLE_REPOSITORY)
    .useValue(new InMemoryLifecycleRepository(w.repo))
    .overrideProvider(EXTRAS_REPOSITORY)
    .useValue(new InMemoryExtrasRepository(w.repo))
    .overrideProvider(ESIGN_DIRECTORY)
    .useValue(w.directory)
    .overrideProvider(BUSINESS_MODULES)
    .useValue(w.modules)
    .overrideProvider(CODE_HASHER)
    .useValue(fakeHasher)
    .overrideProvider(ESIGN_STORE)
    .useValue(w.store)
    .overrideProvider(PDF_ENGINE)
    .useValue(fakePdf)
    .compile();
  app = moduleRef.createNestApplication();
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

type Caller = { user: string; firm: string; role: 'OWNER' | 'ADMIN' | 'STAFF' | 'CLIENT' };
const ownerA = (): Caller => ({ user: w.users.ownerA, firm: w.a, role: 'OWNER' });
const managerA = (): Caller => ({ user: w.users.managerA, firm: w.a, role: 'STAFF' });
const staffA = (): Caller => ({ user: w.users.staffA, firm: w.a, role: 'STAFF' });
const ownerB = (): Caller => ({ user: w.users.ownerB, firm: w.b, role: 'OWNER' });
const clientA = (): Caller => ({ user: randomUUID(), firm: w.a, role: 'CLIENT' });

function call(method: 'get' | 'post' | 'put', path: string, who: Caller, body?: object) {
  const req = request(app.getHttpServer())
    [method](`/api/v1/esign/${path}`)
    .set('x-test-user', who.user)
    .set('x-test-firm', who.firm)
    .set('x-test-role', who.role);
  return body ? req.send(body) : req;
}
const post = (path: string, who: Caller, body: object) => call('post', path, who, body);
const errorOf = (res: request.Response) => [
  res.status,
  (res.body as { error?: { code: string } }).error?.code,
];

/** A DRAFT for c2 (assigned to nobody) waiting only on manager-a's approval. */
async function draft() {
  const created = await post('requests', ownerA(), {
    title: 'Fake approval',
    source: 'CLIENT_RECORD',
    clientId: w.ids.c2,
    engagementId: w.ids.e2,
  });
  const { id } = EsignRequestDetail.parse(created.body);
  const documentId = randomUUID();
  const key = w.store.keyFor(w.a, id, `source/${documentId}`);
  await w.store.put(w.a, key, new TextEncoder().encode('pdf:1'), 'application/pdf');
  const signer = sentRecipient(w, {
    name: 'Fake outside',
    email: 'outside@example.test',
    link: { type: 'EXTERNAL' },
    status: 'WAITING',
    sentAt: null,
  });
  const approver = sentRecipient(w, {
    kind: 'APPROVER',
    role: 'MANAGER',
    name: 'manager-a',
    email: 'manager-a@firm.test',
    link: { type: 'STAFF', userId: w.users.managerA },
    status: 'WAITING',
    sentAt: null,
  });
  w.repo.seed(w.a, id, (row) => {
    row.parts.documents = [
      {
        id: documentId,
        position: 0,
        fileName: 'letter.pdf',
        contentType: 'application/pdf',
        sizeBytes: 5,
        pageCount: 1,
        pageSizes: [{ width: 612, height: 792 }],
        sourceDocumentId: null,
        scanStatus: 'CLEAN',
        createdAt: new Date(),
        s3Key: key,
        sha256: '0'.repeat(64),
      },
    ];
    row.parts.pagePlan = [{ documentId, page: 0, rotation: 0 }];
    row.parts.recipients = [signer, approver];
    row.parts.fields = [
      {
        id: randomUUID(),
        recipientId: signer.id,
        type: 'SIGNATURE',
        pageIndex: 0,
        ...{ x: 0.1, y: 0.1, w: 0.2, h: 0.05 },
        required: true,
        label: null,
        mergeKey: null,
        options: [],
        groupKey: null,
        value: null,
        filled: false,
      },
    ];
  });
  return id;
}

describe('Firm Sign approvals over HTTP', () => {
  it('submits (200), and the approver (reached only as approver) approves it into SENT', async () => {
    const id = await draft();
    const submitted = await post(`requests/${id}/submit-for-approval`, ownerA(), { confirm: true });
    expect([submitted.status, EsignRequestDetail.parse(submitted.body).status]).toEqual([
      200,
      'NEEDS_APPROVAL',
    ]);
    // manager-a is not assigned to c2: reached only to decide.
    expect(errorOf(await post(`requests/${id}/send`, managerA(), { confirm: true }))).toEqual([
      404,
      'NOT_FOUND',
    ]);
    const decided = await post(`requests/${id}/approval`, managerA(), { decision: 'APPROVE' });
    expect([decided.status, EsignRequestDetail.parse(decided.body).status]).toEqual([200, 'SENT']);
  });

  it('rejects with a note (200) back to DRAFT', async () => {
    const id = await draft();
    await post(`requests/${id}/submit-for-approval`, ownerA(), { confirm: true });
    const res = await post(`requests/${id}/approval`, managerA(), {
      decision: 'REJECT',
      note: 'Fake: change the date',
    });
    expect([res.status, EsignRequestDetail.parse(res.body).status]).toEqual([200, 'DRAFT']);
  });

  it('validates ids and bodies with the contract (400)', async () => {
    const id = await draft();
    const bad: [string, object][] = [
      ['requests/not-a-uuid/submit-for-approval', { confirm: true }],
      [`requests/${id}/submit-for-approval`, { confirm: false }],
      [`requests/${id}/submit-for-approval`, {}],
      ['requests/not-a-uuid/approval', { decision: 'APPROVE' }],
      [`requests/${id}/approval`, { decision: 'REJECT' }],
      [`requests/${id}/approval`, { decision: 'MAYBE' }],
      [`requests/${id}/approval`, { decision: 'APPROVE', note: 'x'.repeat(501) }],
    ];
    for (const [path, body] of bad) {
      expect(errorOf(await post(path, ownerA(), body))).toEqual([400, 'VALIDATION_FAILED']);
    }
  });

  it('answers 404 across firms, to unassigned Staff and to a client; 403 to a non-approver', async () => {
    const id = await draft();
    for (const who of [ownerB(), staffA(), clientA()]) {
      const submit = await post(`requests/${id}/submit-for-approval`, who, { confirm: true });
      expect(errorOf(submit)).toEqual([404, 'NOT_FOUND']);
      const decide = await post(`requests/${id}/approval`, who, { decision: 'APPROVE' });
      expect(errorOf(decide)).toEqual([404, 'NOT_FOUND']);
    }
    await post(`requests/${id}/submit-for-approval`, ownerA(), { confirm: true });
    const owner = await post(`requests/${id}/approval`, ownerA(), { decision: 'APPROVE' });
    expect(errorOf(owner)).toEqual([403, 'NOT_AN_APPROVER']);
  });

  it('lists the approvers (200) for staff, never the caller', async () => {
    const res = await call('get', 'approvers', staffA());
    expect(res.status).toBe(200);
    const names = EsignApproverList.parse(res.body).items.map((i) => i.user.name);
    expect(names).toEqual(['admin-a', 'manager-a', 'owner-a']);
    expect(errorOf(await call('get', 'approvers', clientA()))).toEqual([404, 'NOT_FOUND']);
  });

  it('answers MODULE_OFF (403) when off', async () => {
    const id = randomUUID();
    w.modules.set(w.a, 'esign', false);
    try {
      for (const [method, path, body] of [
        ['post', `requests/${id}/submit-for-approval`, { confirm: true }],
        ['post', `requests/${id}/approval`, { decision: 'APPROVE' }],
        ['get', 'approvers', undefined],
      ] as const) {
        expect(errorOf(await call(method, path, ownerA(), body))).toEqual([403, 'MODULE_OFF']);
      }
    } finally {
      w.modules.set(w.a, 'esign', true);
    }
  });
});
