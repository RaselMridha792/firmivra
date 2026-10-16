// R25: GET /admin/system-status, the System Status card's storage, email and portal rows.
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { AdminSystemStatus } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { EMAIL_SENDS } from '../../src/notify/notify.module.js';
import type { EmailSendLog } from '../../src/notify/email-sends.js';
import {
  STORAGE_PROBE,
  SystemStatusService,
} from '../../src/system-status/system-status.controller.js';

const fx = inject('fixtures');
let app: INestApplication;
// CI has no s3mock: the probe stands in for the bucket; the unit tests cover S3StorageProbe's use.
const probe = { check: vi.fn(async () => {}) };

async function tokenFor(email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .send({ email })
    .expect(200);
  return (res.body as { token: string }).token;
}
const get = (token: string) =>
  request(app.getHttpServer())
    .get('/api/v1/admin/system-status')
    .set('authorization', `Bearer ${token}`);

beforeAll(async () => {
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(STORAGE_PROBE)
    .useValue(probe)
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.init();
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('GET /admin/system-status', () => {
  it('answers a Super Admin with every check, in the shape the web client parses', async () => {
    const res = await get(await tokenFor(fx.users.admin.email)).expect(200);
    expect(AdminSystemStatus.safeParse(res.body).error?.issues ?? []).toEqual([]);
    // The fixtures' two active firms resolve by their portal address.
    expect(res.body).toMatchObject({ storage: 'online', email: 'online', portals: 'online' });
    expect(probe.check).toHaveBeenCalledTimes(1);
    // The next minute reuses this answer instead of touching storage again.
    await get(await tokenFor(fx.users.admin.email)).expect(200);
    expect(probe.check).toHaveBeenCalledTimes(1);
  });

  it('shows a failed storage check as offline and a failed latest email as degraded', async () => {
    probe.check.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'AccessDenied' }));
    app.get<EmailSendLog>(EMAIL_SENDS).record(false);
    const service = app.get(SystemStatusService);
    const status = await service.status(Date.now() + 120_000);
    expect(status).toMatchObject({ storage: 'offline', email: 'degraded' });
  });

  it('refuses firm and client sessions and anyone signed out', async () => {
    for (const email of [fx.users.ownerA.email, fx.users.clientA.email]) {
      expect((await get(await tokenFor(email))).status).toBe(401);
    }
    expect((await request(app.getHttpServer()).get('/api/v1/admin/system-status')).status).toBe(
      401,
    );
  });
});
