// R13 step 9, Signing Settings over HTTP: EsignModule's settings, consent version and profile
// routes, pipes, status codes and the module switch with the in-memory ports (no database). A
// stand-in for TenantGuard puts the caller's firm and role on the request, as the global guards
// do in the app (the guards: guards.test.ts and the e2e suite). Synthetic data only.
import { randomUUID } from 'node:crypto';
import { Global, type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EsignConsentVersion, EsignConsentVersionList, EsignSettings } from '@firmivra/types';
import { AuditService } from '../../src/audit/audit.service.js';
import { ApiExceptionFilter } from '../../src/common/api-exception.filter.js';
import { PortalInfoService } from '../../src/client-auth/portal-info.controller.js';
import { BUSINESS_MODULES } from '../../src/common/modules/requires-module.js';
import { ConfigModule } from '../../src/config/config.module.js';
import { loadEnv } from '../../src/config/env.js';
import { EXTRAS_REPOSITORY } from '../../src/esign/extras/extras.repository.js';
import { EsignModule } from '../../src/esign/esign.module.js';
import { ESIGN_DIRECTORY } from '../../src/esign/requests/esign-directory.js';
import { SETTINGS_REPOSITORY } from '../../src/esign/settings/settings.repository.js';
import { NOTIFY_SERVICE } from '../../src/notify/notify.types.js';
import {
  ESIGN_TEST_DEFAULTS,
  esignWorld,
  InMemorySettingsRepository,
  InMemorySignerRepository,
  NO_KIOSK,
  NoDatabaseModule,
} from './esign-fakes.js';

const w = esignWorld();
const settings = new InMemorySettingsRepository(w.repo, new InMemorySignerRepository(w.repo));

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
    imports: [ConfigModule.forRoot(loadEnv()), EsignModule, NoDatabaseModule, FakeAuditModule],
  })
    .overrideProvider(EXTRAS_REPOSITORY)
    .useValue(NO_KIOSK)
    .overrideProvider(SETTINGS_REPOSITORY)
    .useValue(settings)
    .overrideProvider(ESIGN_DIRECTORY)
    .useValue(w.directory)
    .overrideProvider(BUSINESS_MODULES)
    .useValue(w.modules)
    .overrideProvider(PortalInfoService)
    .useValue({ activeFirm: () => Promise.reject(new Error('not used here')) })
    .compile();
  app = moduleRef.createNestApplication();
  // What AuthGuard and TenantGuard set, from test headers.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const user = req.get('x-test-user');
    const firm = req.get('x-test-firm');
    const role = req.get('x-test-role') as 'OWNER' | 'ADMIN' | 'STAFF';
    if (user && firm) {
      req.auth = { userId: user, cognitoSub: user, pool: 'STAFF' };
      req.tenant = { businessId: firm, role, kind: 'staff' };
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

type Caller = { user: string; firm: string; role: 'OWNER' | 'ADMIN' | 'STAFF' };
const ownerA = (): Caller => ({ user: w.users.ownerA, firm: w.a, role: 'OWNER' });
const adminA = (): Caller => ({ user: w.users.adminA, firm: w.a, role: 'ADMIN' });
const staffA = (): Caller => ({ user: w.users.staffA, firm: w.a, role: 'STAFF' });
const ownerB = (): Caller => ({ user: w.users.ownerB, firm: w.b, role: 'OWNER' });

function send(method: 'get' | 'post' | 'put', path: string, who: Caller, body?: object) {
  const req = request(app.getHttpServer())
    [method](`/api/v1${path}`)
    .set('x-test-user', who.user)
    .set('x-test-firm', who.firm)
    .set('x-test-role', who.role);
  return body === undefined ? req : req.send(body);
}
const errorOf = (res: request.Response) => [
  res.status,
  (res.body as { error?: { code: string } }).error?.code,
];
const TEXT = 'I agree to sign electronically. (Fake consent text for tests.)';

describe('Signing Settings over HTTP', () => {
  it('reads and changes the defaults (200), Owner and Admin only', async () => {
    const got = await send('get', '/esign/settings', staffA());
    expect(got.status).toBe(200);
    expect(EsignSettings.parse(got.body)).toMatchObject({ canEdit: false, consent: null });
    const put = await send('put', '/esign/settings', adminA(), { expiryDays: 10 });
    expect(put.status).toBe(200);
    expect(EsignSettings.parse(put.body).defaults.expiryDays).toBe(10);
    const staff = await send('put', '/esign/settings', staffA(), { expiryDays: 3 });
    expect(errorOf(staff)).toEqual([403, 'FORBIDDEN']);
    expect((await w.repo.defaults(w.a)).expiryDays).toBe(10);
    // Firm B reads its own.
    const b = await send('get', '/esign/settings', ownerB());
    expect(EsignSettings.parse(b.body).defaults).toEqual(ESIGN_TEST_DEFAULTS);
  });

  it('publishes a consent version (201) and lists the firm’s own, newest first', async () => {
    const res = await send('post', '/esign/settings/consent-versions', ownerA(), {
      bodyMarkdown: TEXT,
    });
    expect(res.status).toBe(201);
    const v = EsignConsentVersion.parse(res.body);
    const staff = await send('post', '/esign/settings/consent-versions', staffA(), {
      bodyMarkdown: TEXT,
    });
    expect(errorOf(staff)).toEqual([403, 'FORBIDDEN']);
    const list = await send('get', '/esign/settings/consent-versions', staffA());
    expect(EsignConsentVersionList.parse(list.body).items.map((x) => x.id)).toEqual([v.id]);
    const b = await send('get', '/esign/settings/consent-versions', ownerB());
    expect([b.status, b.body]).toEqual([200, { items: [] }]);
    expect((await send('get', '/esign/settings', ownerA())).body).toMatchObject({
      consent: { id: v.id, version: 1 },
    });
  });

  it('sets the caller’s own job title (200), any member', async () => {
    const res = await send('put', '/esign/me/profile', staffA(), { jobTitle: 'Fake Preparer' });
    expect([res.status, (res.body as EsignSettings).myJobTitle]).toEqual([200, 'Fake Preparer']);
    const cleared = await send('put', '/esign/me/profile', staffA(), { jobTitle: '' });
    expect((cleared.body as EsignSettings).myJobTitle).toBeNull();
  });

  it('validates the bodies (400)', async () => {
    const bad: [string, string, object][] = [
      ['put', '/esign/settings', {}],
      ['put', '/esign/settings', { expiryDays: 0 }],
      ['put', '/esign/settings', { expiryDays: 400 }],
      ['put', '/esign/settings', { expiryWarningDays: 31 }],
      ['put', '/esign/settings', { authMethod: 'PORTAL_SESSION' }],
      ['put', '/esign/settings', { reminders: { firstAfterDays: 1, everyDays: 1 } }],
      ['put', '/esign/settings', { requireApproval: 'yes' }],
      ['put', '/esign/settings', { expiryDays: 5, extra: 1 }],
      ['post', '/esign/settings/consent-versions', {}],
      ['post', '/esign/settings/consent-versions', { bodyMarkdown: '  ' }],
      ['post', '/esign/settings/consent-versions', { bodyMarkdown: 'x'.repeat(20_001) }],
      ['post', '/esign/settings/consent-versions', { bodyMarkdown: TEXT, version: 9 }],
      ['put', '/esign/me/profile', { jobTitle: 'x'.repeat(101) }],
      ['put', '/esign/me/profile', { jobTitle: 'Fake', extra: 1 }],
    ];
    for (const [method, path, body] of bad) {
      const res = await send(method as 'put' | 'post', path, ownerA(), body);
      expect(errorOf(res), `${method} ${path} ${JSON.stringify(body)}`).toEqual([
        400,
        'VALIDATION_FAILED',
      ]);
    }
  });

  it('answers 403 MODULE_OFF on every route while Firm Sign is off', async () => {
    w.modules.set(w.a, 'esign', false);
    try {
      for (const res of [
        await send('get', '/esign/settings', ownerA()),
        await send('put', '/esign/settings', ownerA(), { expiryDays: 5 }),
        await send('get', '/esign/settings/consent-versions', ownerA()),
        await send('post', '/esign/settings/consent-versions', ownerA(), { bodyMarkdown: TEXT }),
        await send('put', '/esign/me/profile', ownerA(), { jobTitle: 'Fake' }),
      ]) {
        expect(errorOf(res)).toEqual([403, 'MODULE_OFF']);
      }
      expect((await send('get', '/esign/settings', ownerB())).status).toBe(200);
    } finally {
      w.modules.set(w.a, 'esign', true);
    }
  });

  it('never takes the firm from the body or the query', async () => {
    const res = await send('put', `/esign/settings?businessId=${w.b}`, ownerA(), {
      expiryDays: 7,
    });
    expect(errorOf(res)[0]).toBe(200);
    expect((await w.repo.defaults(w.b)).expiryDays).toBe(ESIGN_TEST_DEFAULTS.expiryDays);
    const forged = await send('put', '/esign/settings', ownerA(), { businessId: randomUUID() });
    expect(errorOf(forged)).toEqual([400, 'VALIDATION_FAILED']);
  });
});
