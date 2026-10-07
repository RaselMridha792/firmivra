// End-to-end: the Super Admin's review actions on firm applications (R4): Request Information,
// Decline and the internal notes. The NotifyService is replaced by a recorder, so the tests see
// exactly which emails would go out.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { FirmApplicationRecord } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';

const fx = inject('fixtures');
let app: INestApplication;
let adminToken: string;
const sent: NotifyMessage[] = [];

const tag = `r4rev${randomUUID().slice(0, 8)}`;
const ids = { asked: randomUUID(), declined: randomUUID(), fresh: randomUUID() };

const stored = (n: number) => ({
  business: {
    practiceType: 'TAX_ACCOUNTING',
    legalName: `Sample Review ${tag} ${n}`,
    dbaName: null,
    entityType: 'LLC',
    einLast4: null,
    email: null,
    phone: null,
    website: null,
    address: {
      line1: '1 Example Way',
      line2: null,
      city: 'Atlanta',
      state: 'GA',
      postalCode: '30301',
    },
    services: ['BOOKKEEPING'],
  },
  primaryAdmin: {
    fullName: `Casey Example ${n}`,
    email: `casey${n}@${tag}.example.test`,
    phone: '+14045550102',
    title: null,
    preferredContact: 'EMAIL',
    alternatePhone: null,
  },
  account: {
    requestedPlan: 'STARTER',
    teamSize: 2,
    clientVolume: 'UNDER_100',
    heardFrom: null,
    requestedStartDate: null,
    additionalInfo: null,
  },
  credentials: [],
});

async function tokenFor(email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .send({ email })
    .expect(200);
  return (res.body as { token: string }).token;
}
const base = (id: string) => `/api/v1/admin/firm-applications/${id}`;
const post = (path: string, body: unknown, token = adminToken) =>
  request(app.getHttpServer())
    .post(path)
    .set('authorization', `Bearer ${token}`)
    .send(body as object);
const put = (path: string, body: unknown) =>
  request(app.getHttpServer())
    .put(path)
    .set('authorization', `Bearer ${adminToken}`)
    .send(body as object);

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, n] of [
      ['asked', 1],
      ['declined', 2],
      ['fresh', 3],
    ] as const) {
      const data = stored(n);
      await tx.firmApplication.create({
        data: {
          id: ids[key],
          legalName: data.business.legalName,
          contactName: data.primaryAdmin.fullName,
          contactEmail: data.primaryAdmin.email,
          contactPhone: data.primaryAdmin.phone,
          data,
        },
      });
    }
  });
  await owner.$disconnect();

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({ send: (m: NotifyMessage) => (sent.push(m), Promise.resolve()) })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.init();
  app = nest;
  adminToken = await tokenFor(fx.users.admin.email);
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  sent.length = 0;
});

describe('Request Information', () => {
  it('emails the applicant, keeps it pending and adds it to the history', async () => {
    const res = await post(`${base(ids.asked)}/request-info`, {
      message: 'Please send your PTIN.',
    }).expect(200);
    const a = FirmApplicationRecord.parse(res.body);
    expect(a.status).toBe('PENDING_REVIEW');
    expect(a.history[0]).toMatchObject({
      type: 'INFO_REQUESTED',
      message: 'Please send your PTIN.',
      by: { userId: fx.users.admin.id },
    });
    expect(sent).toEqual([
      {
        template: 'firm-application.info-requested',
        to: `casey1@${tag}.example.test`,
        businessId: null,
        data: {
          name: 'Casey Example 1',
          legalName: `Sample Review ${tag} 1`,
          message: 'Please send your PTIN.',
        },
      },
    ]);
  });

  it('changes nothing and sends nothing for the same message again; a new one is a new entry', async () => {
    const same = FirmApplicationRecord.parse(
      (
        await post(`${base(ids.asked)}/request-info`, { message: 'Please send your PTIN.' }).expect(
          200,
        )
      ).body,
    );
    expect(same.history.filter((h) => h.type === 'INFO_REQUESTED')).toHaveLength(1);
    expect(sent).toEqual([]);
    const next = FirmApplicationRecord.parse(
      (
        await post(`${base(ids.asked)}/request-info`, { message: 'And your EFIN, please.' }).expect(
          200,
        )
      ).body,
    );
    expect(next.history.filter((h) => h.type === 'INFO_REQUESTED').map((h) => h.message)).toEqual([
      'And your EFIN, please.',
      'Please send your PTIN.',
    ]);
    expect(sent).toHaveLength(1);
  });
});

describe('Decline', () => {
  it('refuses the same text as the last request (400), then declines and emails the reason', async () => {
    await post(`${base(ids.declined)}/request-info`, {
      message: 'Which services do you offer?',
    }).expect(200);
    const reused = await post(`${base(ids.declined)}/decline`, {
      reason: 'Which services do you offer?',
    });
    expect([reused.status, (reused.body as { error: { code: string } }).error.code]).toEqual([
      400,
      'VALIDATION_FAILED',
    ]);

    sent.length = 0;
    const res = await post(`${base(ids.declined)}/decline`, {
      reason: 'We serve tax practices only.',
    }).expect(200);
    const a = FirmApplicationRecord.parse(res.body);
    expect(a.status).toBe('DECLINED');
    expect(a.decision).toMatchObject({
      reason: 'We serve tax practices only.',
      by: { userId: fx.users.admin.id },
    });
    expect(a.history[0]).toMatchObject({
      type: 'DECLINED',
      message: 'We serve tax practices only.',
    });
    expect(sent.map((m) => [m.template, m.to, (m.data as { reason: string }).reason])).toEqual([
      ['firm-application.declined', `casey2@${tag}.example.test`, 'We serve tax practices only.'],
    ]);
  });

  it('answers 409 APPLICATION_DECIDED for any review of a decided application, and sends nothing', async () => {
    for (const [path, body] of [
      ['decline', { reason: 'Another reason' }],
      ['request-info', { message: 'Anything else?' }],
    ] as const) {
      const res = await post(`${base(ids.declined)}/${path}`, body);
      expect([res.status, (res.body as { error: { code: string } }).error.code]).toEqual([
        409,
        'APPLICATION_DECIDED',
      ]);
    }
    expect(sent).toEqual([]);
  });
});

describe('Internal notes', () => {
  it('saves, replaces and clears notes, also after a decision', async () => {
    const saved = FirmApplicationRecord.parse(
      (
        await put(`${base(ids.declined)}/notes`, { notes: '  Called them on Tuesday.  ' }).expect(
          200,
        )
      ).body,
    );
    expect(saved.internalNotes).toBe('Called them on Tuesday.');
    const cleared = FirmApplicationRecord.parse(
      (await put(`${base(ids.declined)}/notes`, { notes: '' }).expect(200)).body,
    );
    expect(cleared.internalNotes).toBeNull();
    expect(sent).toEqual([]);
  });
});

describe('every action', () => {
  it('is audited as the acting admin, with ids only', async () => {
    const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
    try {
      const rows = await runInScope(owner, { kind: 'platform' }, (tx) =>
        tx.auditLog.findMany({
          where: {
            entityId: { in: [ids.asked, ids.declined] },
            action: { not: 'firm_application.viewed' },
          },
          select: { action: true, actorUserId: true, businessId: true, metadata: true },
        }),
      );
      expect(new Set(rows.map((r) => r.action))).toEqual(
        new Set([
          'firm_application.info_requested',
          'firm_application.declined',
          'firm_application.notes_saved',
        ]),
      );
      expect(
        rows.every(
          (r) =>
            r.actorUserId === fx.users.admin.id && r.businessId === null && r.metadata === null,
        ),
      ).toBe(true);
    } finally {
      await owner.$disconnect();
    }
  });

  it('answers 404 for an unknown application, 400 for a bad body, 401 for a firm session', async () => {
    expect((await post(`${base(randomUUID())}/decline`, { reason: 'x' })).status).toBe(404);
    expect((await put(`${base(randomUUID())}/notes`, { notes: 'x' })).status).toBe(404);
    expect((await post(`${base(ids.fresh)}/decline`, { reason: '' })).status).toBe(400);
    expect(
      (await post(`${base(ids.fresh)}/request-info`, { message: 'x', businessId: randomUUID() }))
        .status,
    ).toBe(400);
    const owner = await tokenFor(fx.users.ownerA.email);
    expect((await post(`${base(ids.fresh)}/decline`, { reason: 'x' }, owner)).status).toBe(401);
    expect(sent).toEqual([]);
  });
});
