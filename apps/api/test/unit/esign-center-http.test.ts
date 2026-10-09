// R13 step 9, the portal's Signature center over HTTP: EsignModule's /portal/{slug}/me/signatures
// routes, pipes, the signer cookie and the module switch with the in-memory ports (no database).
// A stand-in for TenantGuard puts the client login's firm and account on the request, as the
// global guards do in the app (the guards: the e2e suite). Synthetic data only.
import { randomUUID } from 'node:crypto';
import { Global, type INestApplication, Module } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MySignatureList, SignerState } from '@firmivra/types';
import { AuditService } from '../../src/audit/audit.service.js';
import { ApiExceptionFilter } from '../../src/common/api-exception.filter.js';
import { PortalInfoService } from '../../src/client-auth/portal-info.controller.js';
import { BUSINESS_MODULES } from '../../src/common/modules/requires-module.js';
import { ConfigModule } from '../../src/config/config.module.js';
import { loadEnv } from '../../src/config/env.js';
import { CENTER_REPOSITORY } from '../../src/esign/center/center.repository.js';
import { COMPLETION_REPOSITORY } from '../../src/esign/completion/completion.repository.js';
import { ESIGN_STORE } from '../../src/esign/engine/engine.types.js';
import { EsignModule } from '../../src/esign/esign.module.js';
import { ESIGN_DIRECTORY } from '../../src/esign/requests/esign-directory.js';
import {
  ESIGN_REPOSITORY,
  type EsignRecipientRecord,
} from '../../src/esign/requests/esign.repository.js';
import { SIGNER_REPOSITORY } from '../../src/esign/signer/signer.repository.js';
import { NOTIFY_SERVICE } from '../../src/notify/notify.types.js';
import {
  esignWorld,
  InMemoryCenterRepository,
  InMemoryCompletionRepository,
  InMemorySignerRepository,
} from './esign-fakes.js';

const w = esignWorld();
const signers = new InMemorySignerRepository(w.repo);
const SLUG = 'fake-firm-a';

@Global()
@Module({
  providers: [
    { provide: AuditService, useValue: w.audit },
    { provide: NOTIFY_SERVICE, useValue: { send: () => Promise.resolve() } },
  ],
  exports: [AuditService, NOTIFY_SERVICE],
})
class FakeAuditModule {}

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot(loadEnv()), EsignModule, FakeAuditModule],
  })
    .overrideProvider(CENTER_REPOSITORY)
    .useValue(new InMemoryCenterRepository(w.repo))
    .overrideProvider(SIGNER_REPOSITORY)
    .useValue(signers)
    .overrideProvider(COMPLETION_REPOSITORY)
    .useValue(new InMemoryCompletionRepository(w.repo, signers))
    .overrideProvider(ESIGN_REPOSITORY)
    .useValue(w.repo)
    .overrideProvider(ESIGN_DIRECTORY)
    .useValue(w.directory)
    .overrideProvider(BUSINESS_MODULES)
    .useValue(w.modules)
    .overrideProvider(ESIGN_STORE)
    .useValue(w.store)
    .overrideProvider(PortalInfoService)
    .useValue({
      activeFirm: (slug: string) =>
        slug === SLUG
          ? Promise.resolve({ id: w.a, slug, name: 'Fake Firm A' })
          : Promise.reject(new Error('no such firm')),
    })
    .compile();
  app = moduleRef.createNestApplication();
  app.use(cookieParser());
  // What AuthGuard and TenantGuard set, from test headers: a client login or a staff member.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const login = req.get('x-test-login');
    const firm = req.get('x-test-firm');
    if (login && firm) {
      req.auth = { userId: randomUUID(), cognitoSub: login, pool: 'CLIENT' };
      req.tenant =
        login === 'staff'
          ? { businessId: firm, role: 'OWNER', kind: 'staff' }
          : { businessId: firm, role: 'CLIENT', kind: 'client', clientAccountId: login };
    }
    next();
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();
  signers.consents.set(w.a, { id: randomUUID(), version: 1, bodyMarkdown: 'Fake consent' });
});

afterAll(async () => {
  await app.close();
});

type Caller = { login: string; firm: string };
const primary = (): Caller => ({ login: w.ids.primary, firm: w.a });
const spouse = (): Caller => ({ login: w.ids.spouse, firm: w.a });
const loginB = (): Caller => ({ login: w.ids.loginB, firm: w.b });

function send(method: 'get' | 'post', path: string, who: Caller, body?: object) {
  const req = request(app.getHttpServer())
    [method](`/api/v1/portal/${SLUG}/me/signatures${path}`)
    .set('x-test-login', who.login)
    .set('x-test-firm', who.firm);
  return body === undefined ? req : req.send(body);
}
const errorOf = (res: request.Response) => [
  res.status,
  (res.body as { error?: { code: string } }).error?.code,
];

/** A SENT request of firm A with this one recipient of the login; the recipient. */
async function sentTo(login: string, over: Partial<EsignRecipientRecord> = {}) {
  const r: EsignRecipientRecord = {
    ...{ id: randomUUID(), kind: 'SIGNER', role: 'CLIENT', roleLabel: null, routingOrder: 1 },
    ...{ name: 'Fake Signer', email: 'fake@client.test', phone: null },
    link: { type: 'CLIENT_LOGIN', clientAccountId: login },
    ...{ delivery: 'PORTAL', authMethod: 'EMAIL_CODE', accessCodeHash: null, colorIndex: 0 },
    ...{ status: 'SENT', sentAt: new Date(), viewedAt: null, signedAt: null },
    ...{ declinedAt: null, declineReason: null, lastRemindedAt: null, reminderCount: 0 },
    ...over,
  };
  const q = await w.repo.createRequest(w.a, {
    ...{ title: 'Fake letter', source: 'TAB', clientId: w.ids.c1, engagementId: null },
    ...{ senderUserId: w.users.staffA, internalNote: null, emailSubject: null },
    ...{ emailMessage: null, routing: 'SEQUENTIAL', expiryDays: 30, expiryWarningDays: 2 },
    reminders: { firstAfterDays: 3, everyDays: 3, max: 3 },
  });
  const sentAt = new Date();
  w.repo.seed(w.a, q.id, (row) => {
    Object.assign(row.record, { status: 'SENT', sentAt, expiresAt: new Date(Date.now() + 9e8) });
    row.parts.recipients = [r];
  });
  return r;
}

describe('the Signature center over HTTP', () => {
  it('answers status (200) on and off', async () => {
    expect((await send('get', '/status', primary())).body).toEqual({ enabled: true });
    w.modules.set(w.a, 'esign', false);
    try {
      const off = await send('get', '/status', primary());
      expect([off.status, off.body]).toEqual([200, { enabled: false }]);
    } finally {
      w.modules.set(w.a, 'esign', true);
    }
  });

  it("lists the login's own rows by tab (200), never another login's", async () => {
    const mine = await sentTo(w.ids.primary);
    const res = await send('get', '', primary());
    expect(res.status).toBe(200);
    const items = MySignatureList.parse(res.body).items;
    expect(items.map((r) => [r.recipientId, r.state])).toContainEqual([mine.id, 'ACTION_NEEDED']);
    const signed = await send('get', '?tab=SIGNED', primary());
    expect(MySignatureList.parse(signed.body).items).toEqual([]);
    const theirs = await send('get', '', spouse());
    expect(JSON.stringify(theirs.body)).not.toContain(mine.id);
    expect(JSON.stringify((await send('get', '', loginB())).body)).not.toContain(mine.id);
  });

  it('starts signing (200) with the signer cookie on the signer path', async () => {
    const mine = await sentTo(w.ids.primary);
    const res = await send('post', `/${mine.id}/session`, primary(), {});
    expect(res.status).toBe(200);
    expect(SignerState.parse(res.body).step).toBe('CONSENT');
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain(`fv_sign_${SLUG}=`);
    expect(cookie).toContain(`Path=/api/v1/portal/${SLUG}/sign;`);
    expect(cookie).toContain('HttpOnly');
    // The signer routes take it from there.
    const state = await request(app.getHttpServer())
      .get(`/api/v1/portal/${SLUG}/sign/state`)
      .set('cookie', cookie.split(';')[0]!);
    expect([state.status, (state.body as { step: string }).step]).toEqual([200, 'CONSENT']);
  });

  it("answers 404 for another login's, client's or firm's recipient", async () => {
    const mine = await sentTo(w.ids.primary);
    for (const who of [spouse(), loginB()]) {
      const session = await send('post', `/${mine.id}/session`, who, {});
      expect(errorOf(session)).toEqual([404, 'NOT_FOUND']);
      expect(session.headers['set-cookie']).toBeUndefined();
      const file = await send('get', `/${mine.id}/download?file=final`, who);
      expect(errorOf(file)).toEqual([404, 'NOT_FOUND']);
    }
    const open = await send('get', `/${mine.id}/download?file=final`, primary());
    expect(errorOf(open)).toEqual([409, 'INVALID_STATE']);
  });

  it('refuses a staff session (404): the client comes only from a client login', async () => {
    const mine = await sentTo(w.ids.primary);
    const staff = { login: 'staff', firm: w.a };
    expect(errorOf(await send('get', '', staff))).toEqual([404, 'NOT_FOUND']);
    expect(errorOf(await send('post', `/${mine.id}/session`, staff, {}))).toEqual([
      404,
      'NOT_FOUND',
    ]);
  });

  it('validates the id and the query (400)', async () => {
    for (const path of ['?tab=ALL', '?extra=1', '/nope/download?file=final']) {
      expect(errorOf(await send('get', path, primary())), path).toEqual([400, 'VALIDATION_FAILED']);
    }
    const id = randomUUID();
    for (const q of ['', '?file=original']) {
      const res = await send('get', `/${id}/download${q}`, primary());
      expect(errorOf(res)).toEqual([400, 'VALIDATION_FAILED']);
    }
    const bad = await send('post', '/nope/session', primary(), {});
    expect(errorOf(bad)).toEqual([400, 'VALIDATION_FAILED']);
  });

  it('answers 403 MODULE_OFF on every route but status while Firm Sign is off', async () => {
    const mine = await sentTo(w.ids.primary);
    w.modules.set(w.a, 'esign', false);
    try {
      for (const res of [
        await send('get', '', primary()),
        await send('post', `/${mine.id}/session`, primary(), {}),
        await send('get', `/${mine.id}/download?file=final`, primary()),
      ]) {
        expect(errorOf(res)).toEqual([403, 'MODULE_OFF']);
        expect(res.headers['set-cookie']).toBeUndefined();
      }
    } finally {
      w.modules.set(w.a, 'esign', true);
    }
  });
});
