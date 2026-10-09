// R13 step 8, lifecycle over HTTP: EsignLifecycleController's remind, void, correct and replace
// routes, their pipes, the status codes (replace is 201), the module switch and the 404s across
// firms and clients, with the in-memory ports (no database). A stand-in for TenantGuard puts the
// caller's firm and role on the request, as in esign-requests-http.test.ts. Synthetic data only.
import { PortalInfoService } from '../../src/client-auth/portal-info.controller.js';
import { randomUUID } from 'node:crypto';
import { Global, type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EsignRequestDetail } from '@firmivra/types';
import { AuditService } from '../../src/audit/audit.service.js';
import { ApiExceptionFilter } from '../../src/common/api-exception.filter.js';
import { BUSINESS_MODULES, ModulesModule } from '../../src/common/modules/requires-module.js';
import { ConfigModule } from '../../src/config/config.module.js';
import { loadEnv } from '../../src/config/env.js';
import { CODE_HASHER, ESIGN_STORE, PDF_ENGINE } from '../../src/esign/engine/engine.types.js';
import { EsignModule } from '../../src/esign/esign.module.js';
import { LIFECYCLE_REPOSITORY } from '../../src/esign/lifecycle/lifecycle.repository.js';
import { ESIGN_DIRECTORY } from '../../src/esign/requests/esign-directory.js';
import { ESIGN_REPOSITORY } from '../../src/esign/requests/esign.repository.js';
import { NOTIFY_SERVICE } from '../../src/notify/notify.types.js';
import {
  esignWorld,
  fakeHasher,
  FakeNotify,
  fakePdf,
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

function post(path: string, who: Caller, body: object) {
  return request(app.getHttpServer())
    .post(`/api/v1/esign/requests/${path}`)
    .set('x-test-user', who.user)
    .set('x-test-firm', who.firm)
    .set('x-test-role', who.role)
    .send(body);
}
const errorOf = (res: request.Response) => [
  res.status,
  (res.body as { error?: { code: string } }).error?.code,
];

/** A SENT request for `clientId` with one external signer whose turn it is. */
async function sent(clientId = w.ids.c1) {
  const created = await request(app.getHttpServer())
    .post('/api/v1/esign/requests')
    .set('x-test-user', w.users.ownerA)
    .set('x-test-firm', w.a)
    .set('x-test-role', 'OWNER')
    .send({ title: 'Fake lifecycle', source: 'CLIENT_RECORD', clientId });
  const { id } = EsignRequestDetail.parse(created.body);
  const signer = sentRecipient(w, {
    name: 'Fake outside',
    email: 'outside@example.test',
    link: { type: 'EXTERNAL' },
  });
  w.repo.seed(w.a, id, (row) => {
    Object.assign(row.record, { status: 'SENT', sentAt: new Date(), expiresAt: new Date() });
    row.parts.recipients = [signer];
  });
  return { id, signerId: signer.id };
}

describe('Firm Sign lifecycle over HTTP', () => {
  it('reminds, corrects and voids (200), then refuses a closed request (409 REQUEST_CLOSED)', async () => {
    const { id, signerId } = await sent();
    const reminded = await post(`${id}/remind`, ownerA(), { recipientId: signerId });
    expect(reminded.status).toBe(200);
    expect(EsignRequestDetail.parse(reminded.body).recipients[0]!.reminderCount).toBe(1);
    expect(errorOf(await post(`${id}/remind`, ownerA(), {}))).toEqual([409, 'REMIND_TOO_SOON']);
    const corrected = await post(`${id}/recipients/${signerId}/correct`, staffA(), {
      email: 'fixed@example.test',
    });
    expect(corrected.status).toBe(200);
    expect(EsignRequestDetail.parse(corrected.body).recipients[0]!.email).toBe(
      'fixed@example.test',
    );
    const voided = await post(`${id}/void`, ownerA(), { reason: 'Fake reason' });
    expect([voided.status, EsignRequestDetail.parse(voided.body).status]).toEqual([200, 'VOIDED']);
    expect(errorOf(await post(`${id}/void`, ownerA(), { reason: 'Fake reason' }))).toEqual([
      409,
      'REQUEST_CLOSED',
    ]);
    expect(notify.sent.map((m) => m.template)).toEqual([
      'esign.reminder',
      'esign.request',
      'esign.voided',
    ]);
  });

  it('replaces with 201 and the new DRAFT', async () => {
    const { id } = await sent();
    const res = await post(`${id}/replace`, ownerA(), { reason: 'Fake reason' });
    const created = EsignRequestDetail.parse(res.body);
    expect([res.status, created.status, created.replacesRequestId]).toEqual([201, 'DRAFT', id]);
  });

  it('validates ids and bodies with the contract (400)', async () => {
    const { id, signerId } = await sent();
    const bad: [string, object][] = [
      ['not-a-uuid/remind', {}],
      [`${id}/remind`, { recipientId: 'nope' }],
      [`${id}/remind`, { extra: 1 }],
      [`${id}/void`, { reason: '' }],
      [`${id}/void`, {}],
      [`${id}/replace`, { reason: 'x'.repeat(501) }],
      [`${id}/recipients/${signerId}/correct`, {}],
      [`${id}/recipients/not-a-uuid/correct`, { name: 'Fake' }],
      [`${id}/recipients/${signerId}/correct`, { email: 'not-an-email' }],
    ];
    for (const [path, body] of bad) {
      expect(errorOf(await post(path, ownerA(), body))).toEqual([400, 'VALIDATION_FAILED']);
    }
  });

  it('answers 404 across firms, across clients (Staff of another client) and to a client', async () => {
    const { id, signerId } = await sent(w.ids.c2);
    for (const who of [ownerB(), staffA(), clientA()]) {
      for (const [path, body] of [
        [`${id}/remind`, {}],
        [`${id}/void`, { reason: 'Fake reason' }],
        [`${id}/recipients/${signerId}/correct`, { name: 'Fake' }],
        [`${id}/replace`, { reason: 'Fake reason' }],
      ] as const) {
        expect(errorOf(await post(path, who, body))).toEqual([404, 'NOT_FOUND']);
      }
    }
    expect((await w.repo.findRequest(w.a, id))?.status).toBe('SENT');
  });

  it('answers MODULE_OFF (403) when off', async () => {
    const id = randomUUID();
    w.modules.set(w.a, 'esign', false);
    try {
      for (const [path, body] of [
        [`${id}/remind`, {}],
        [`${id}/void`, { reason: 'Fake reason' }],
        [`${id}/recipients/${randomUUID()}/correct`, { name: 'Fake' }],
        [`${id}/replace`, { reason: 'Fake reason' }],
      ] as const) {
        expect(errorOf(await post(path, ownerA(), body))).toEqual([403, 'MODULE_OFF']);
      }
    } finally {
      w.modules.set(w.a, 'esign', true);
    }
  });
});
