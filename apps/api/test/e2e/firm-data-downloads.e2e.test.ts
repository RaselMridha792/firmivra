import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';
import { DOCUMENT_STORAGE } from '../../src/storage/document-storage.js';

const fixtures = inject('fixtures');
const sent: NotifyMessage[] = [];
let app: INestApplication;
const download = '/api/v1/closed-firm-download';
const day = 86_400_000;

async function seedFirm() {
  const db = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  const tag = randomUUID().slice(0, 8);
  const email = 'retained-' + tag + '@example.test';
  try {
    const { businessId, userId } = await runInScope(db, { kind: 'platform' }, async (tx) => {
      const firm = await tx.business.create({
        data: { name: 'Sample ' + tag, slug: 'closed-test-' + tag, status: 'ACTIVE' },
      });
      const sub = randomUUID();
      const user = await tx.user.create({
        data: { cognitoSub: sub, pool: 'STAFF', email, name: 'Sample Owner' },
      });
      return { businessId: firm.id, userId: user.id };
    });
    const ids = await runInScope(db, { kind: 'business', businessId }, async (tx) => {
      await tx.membership.create({ data: { businessId, userId, role: 'OWNER', status: 'ACTIVE' } });
      const client = await tx.client.create({
        data: { businessId, displayName: 'Sample client ' + tag },
      });
      const service = await tx.service.create({
        data: { businessId, kind: 'ANNUAL_TAX', name: 'Sample service' },
      });
      const engagement = await tx.engagement.create({
        data: {
          businessId,
          clientId: client.id,
          serviceId: service.id,
          title: 'Sample engagement',
        },
      });
      const document = (name: string) =>
        tx.document.create({
          data: {
            businessId,
            clientId: client.id,
            engagementId: engagement.id,
            direction: 'FIRM_TO_CLIENT',
            fileName: name,
            sizeBytes: 12,
            contentType: 'application/pdf',
            sha256: '0'.repeat(64),
            s3Key: 'tenant/' + businessId + '/' + name,
            uploadedByUserId: userId,
          },
        });
      const clean = await document('clean.pdf');
      const pending = await document('pending.pdf');
      await tx.document.update({
        where: { id: clean.id },
        data: { scanStatus: 'CLEAN', scannedAt: new Date() },
      });
      return {
        clean: clean.id,
        pending: pending.id,
        client: client.id,
        clientName: client.displayName,
      };
    });
    return { businessId, email, ...ids };
  } finally {
    await db.$disconnect();
  }
}

beforeAll(async () => {
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fixtures.appUrl,
  });
  const module = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({
      send: async (message: NotifyMessage) => {
        sent.push(message);
      },
    })
    .overrideProvider(DOCUMENT_STORAGE)
    .useValue({ presignDownload: async () => 'https://storage.example.test/clean.pdf' })
    .compile();
  const nest = module.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.init();
  app = nest;
});

afterAll(async () => {
  await app?.close();
});

describe('SA-FRM-F07/F08 closed-firm downloads', () => {
  it('emails an automatic grant, verifies a one-time code, exports only the right firm, and revokes access', async () => {
    const firm = await seedFirm();
    const other = await seedFirm();
    const http = request(app.getHttpServer());
    const signIn = async (email: string) => {
      const reply = await http.post('/api/v1/dev/token').send({ email }).expect(200);
      return 'Bearer ' + (reply.body as { token: string }).token;
    };
    const admin = await signIn(fixtures.users.admin.email);
    const staff = await signIn(fixtures.users.ownerA.email);
    const base = '/api/v1/admin/firms/' + firm.businessId;

    await http
      .get(base + '/download-access')
      .set('Authorization', staff)
      .expect(401);
    await http
      .post(base + '/close')
      .set('Authorization', admin)
      .send({ reason: 'Sample closure' })
      .expect(200);
    const firstMail = sent.find(
      (mail) => mail.template === 'platform.firm-download-link' && mail.to === firm.email,
    );
    expect(firstMail).toBeDefined();
    const { link } = firstMail?.data as { link: string };
    const linkToken = new URLSearchParams(new URL(link).hash.slice(1)).get('token') ?? '';
    expect(new URL(link).pathname).toBe('/closed-firm-download');
    await http.get(download + '/files').expect(404);
    await http
      .post(download + '/request-code')
      .set('x-download-link', 'bad')
      .expect(404);
    await http
      .post(download + '/request-code')
      .set('x-download-link', linkToken)
      .expect(200);
    const codeMail = sent.find(
      (mail) => mail.template === 'platform.firm-download-code' && mail.to === firm.email,
    );
    expect(codeMail).toBeDefined();
    const { code } = codeMail?.data as { code: string };
    const verify = (value: string) =>
      http
        .post(download + '/verify-code')
        .set('x-download-link', linkToken)
        .send({ code: value });
    await verify(code === '123456' ? '654321' : '123456').expect(404);
    const verified = await verify(code).expect(200);
    await verify(code).expect(404);
    const access = 'Bearer ' + (verified.body as { sessionToken: string }).sessionToken;
    const clients = await http
      .get(download + '/clients')
      .set('Authorization', access)
      .expect(200);
    expect(clients.body).toEqual([expect.objectContaining({ id: firm.client })]);
    const files = await http
      .get(download + '/files')
      .set('Authorization', access)
      .expect(200);
    expect(files.body).toEqual([
      expect.objectContaining({ id: firm.clean, clientName: firm.clientName }),
    ]);
    for (const id of [firm.pending, other.clean]) {
      await http
        .post(download + '/files/' + id + '/link')
        .set('Authorization', access)
        .expect(404);
    }
    const file = await http
      .post(download + '/files/' + firm.clean + '/link')
      .set('Authorization', access)
      .expect(200);
    expect(file.body).toMatchObject({ expiresInSeconds: 300 });
    const csv = await http
      .get(download + '/clients.csv')
      .set('Authorization', access)
      .expect(200);
    expect(csv.text).toContain(firm.clientName);
    expect(csv.text).not.toContain(other.clientName);

    await http
      .post(base + '/download-access')
      .set('Authorization', admin)
      .send({ reason: 'Sample temporary request' })
      .expect(200);
    const listed = await http
      .get(base + '/download-access')
      .set('Authorization', admin)
      .expect(200);
    const [temporary, automatic] = listed.body as {
      id: string;
      kind: string;
      startsAt: string;
      expiresAt: string;
      log: object[];
    }[];
    expect(temporary?.kind).toBe('REQUESTED');
    expect(automatic?.kind).toBe('AUTOMATIC');
    expect(temporary?.startsAt).toBe(automatic?.expiresAt);
    expect(Date.parse(temporary!.expiresAt) - Date.parse(temporary!.startsAt)).toBe(60 * day);
    expect(automatic?.log).toContainEqual(
      expect.objectContaining({ event: 'DOWNLOADED', fileCount: 1, bytes: '12' }),
    );
    await http
      .post(base + '/download-access/' + automatic!.id + '/revoke')
      .set('Authorization', admin)
      .send({ reason: 'Sample revoke' })
      .expect(200);
    await http
      .get(download + '/files')
      .set('Authorization', access)
      .expect(404);
  });
});
