// End-to-end: the Super Admin approves a firm application (R4 step 2). The decision commits in
// admin scope, then the firm is created and linked in platform scope; an application approved
// without a firm (its address taken in between) is finished by approving it again. The
// NotifyService is replaced by a recorder. Step 3 (settings, key, owner invite) is in
// firm-setup.e2e.test.ts.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
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

const tag = `r16ap${randomUUID().slice(0, 8)}`;
const ids = {
  plain: randomUUID(),
  chosen: randomUUID(),
  declined: randomUUID(),
  taken: randomUUID(),
  longName: randomUUID(),
  zeroWidth: randomUUID(),
  resume: randomUUID(),
  twice: randomUUID(),
  unreadable: randomUUID(),
};
const legalName = (n: number) => `Sample Approve ${tag} ${n}`;

const stored = (n: number) => ({
  business: {
    practiceType: 'TAX_ACCOUNTING',
    legalName: legalName(n),
    dbaName: null,
    entityType: 'LLC',
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

async function asOwner<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  try {
    return await runInScope(owner, { kind: 'platform' }, fn);
  } finally {
    await owner.$disconnect();
  }
}

async function tokenFor(email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .send({ email })
    .expect(200);
  return (res.body as { token: string }).token;
}

const base = (id: string) => `/api/v1/admin/firm-applications/${id}`;
const approve = (id: string, body: object = {}, token = adminToken) =>
  request(app.getHttpServer())
    .post(`${base(id)}/approve`)
    .set('authorization', `Bearer ${token}`)
    .send(body);

/** The application, its firm and the audit rows about either, read as the database owner. */
const stateOf = (id: string) =>
  asOwner(async (tx) => {
    const application = await tx.firmApplication.findUniqueOrThrow({ where: { id } });
    const firm = application.businessId
      ? await tx.business.findUnique({ where: { id: application.businessId } })
      : null;
    const audit = await tx.auditLog.findMany({
      where: { OR: [{ entityId: id }, ...(firm ? [{ entityId: firm.id }] : [])] },
      orderBy: { createdAt: 'asc' },
    });
    return { application, firm, audit };
  });

beforeAll(async () => {
  await asOwner(async (tx) => {
    const rows: [keyof typeof ids, number][] = [
      ['plain', 1],
      ['chosen', 2],
      ['declined', 3],
      ['taken', 4],
      ['longName', 5],
      ['zeroWidth', 9],
      ['resume', 6],
      ['twice', 7],
    ];
    for (const [key, n] of rows) {
      const data = stored(n);
      await tx.firmApplication.create({
        data: {
          id: ids[key],
          legalName: data.business.legalName,
          // Rows from before #107 could hold a name up to 200 characters.
          contactName:
            key === 'longName'
              ? 'L'.repeat(121)
              : key === 'zeroWidth'
                ? 'Casey\u200bExample'
                : data.primaryAdmin.fullName,
          contactEmail: data.primaryAdmin.email,
          contactPhone: data.primaryAdmin.phone,
          data,
        },
      });
    }
    // A form in another shape (like the seed's): approve works from the columns.
    await tx.firmApplication.create({
      data: {
        id: ids.unreadable,
        legalName: legalName(8),
        contactName: 'Casey Example 8',
        contactEmail: `casey8@${tag}.example.test`,
        data: {},
      },
    });
    // Approved before its firm could be created: platform scope, as if the second half failed.
    await tx.firmApplication.update({
      where: { id: ids.resume },
      data: { status: 'APPROVED', reviewedByUserId: fx.users.admin.id, reviewedAt: new Date() },
    });
  });

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({
      send: (m: NotifyMessage) => {
        sent.push(m);
        return Promise.resolve();
      },
    })
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

describe('Approve', () => {
  it('approves, creates the firm at the suggested address in setup, and links it', async () => {
    const before = FirmApplicationRecord.parse(
      (
        await request(app.getHttpServer())
          .get(base(ids.plain))
          .set('authorization', `Bearer ${adminToken}`)
          .expect(200)
      ).body,
    );
    const res = await approve(ids.plain).expect(200);
    const record = FirmApplicationRecord.parse(res.body);
    expect(record.status).toBe('APPROVED');
    expect(record.suggestedSlug).toBeNull();
    expect(record.firm).toMatchObject({
      slug: before.suggestedSlug,
      name: legalName(1),
      status: 'PENDING_SETUP',
    });
    expect(record.decision).toMatchObject({ by: { userId: fx.users.admin.id }, reason: null });
    expect(record.history[0]).toMatchObject({
      type: 'APPROVED',
      by: { userId: fx.users.admin.id },
    });

    const { application, firm, audit } = await stateOf(ids.plain);
    expect(application.businessId).toBe(record.firm?.id);
    expect(firm).toMatchObject({
      legalName: legalName(1),
      businessType: 'TAX_ACCOUNTING',
      pack: 'TAX_ACCOUNTING',
      kmsKeyId: null,
      activatedAt: null,
    });
    expect(audit.map((a) => [a.action, a.businessId, a.actorUserId, a.metadata])).toEqual([
      ['firm_application.viewed', null, fx.users.admin.id, null],
      ['firm_application.approved', null, fx.users.admin.id, null],
      ['business.created', null, fx.users.admin.id, { applicationId: ids.plain }],
      [
        'settings.copied_from_application',
        firm?.id,
        fx.users.admin.id,
        { applicationId: ids.plain, fields: ['entityType', 'services', 'teamSize'] },
      ],
    ]);
    // The owner's activation link (step 3).
    expect(sent.map((m) => [m.template, m.to])).toEqual([
      ['firm-application.approved', `casey1@${tag}.example.test`],
    ]);
  });

  it('uses the address the Super Admin picked', async () => {
    const slug = `${tag}-picked`;
    const record = FirmApplicationRecord.parse(
      (await approve(ids.chosen, { slug: ` ${slug.toUpperCase()} ` }).expect(200)).body,
    );
    expect(record.firm?.slug).toBe(slug);
  });

  it('refuses a decided application: 409 APPLICATION_DECIDED, and nothing changes', async () => {
    await request(app.getHttpServer())
      .post(`${base(ids.declined)}/decline`)
      .set('authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Outside our service area.' })
      .expect(200);
    const res = await approve(ids.declined).expect(409);
    expect(res.body.error.code).toBe('APPLICATION_DECIDED');
    expect((await stateOf(ids.declined)).firm).toBeNull();

    // Approved with its firm: approving or declining again is 409, and still one firm.
    expect((await approve(ids.plain).expect(409)).body.error.code).toBe('APPLICATION_DECIDED');
    const decline = await request(app.getHttpServer())
      .post(`${base(ids.plain)}/decline`)
      .set('authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Changed our mind.' })
      .expect(409);
    expect(decline.body.error.code).toBe('APPLICATION_DECIDED');
    const audit = (await stateOf(ids.plain)).audit.map((a) => a.action);
    expect(audit.filter((a) => a === 'business.created')).toHaveLength(1);
  });

  it('refuses an address another firm has before deciding: 409 SLUG_TAKEN', async () => {
    const res = await approve(ids.taken, { slug: fx.firmA.slug }).expect(409);
    expect(res.body.error.code).toBe('SLUG_TAKEN');
    const { application, audit } = await stateOf(ids.taken);
    expect(application.status).toBe('PENDING_REVIEW');
    expect(audit).toEqual([]);
  });

  it('refuses a reserved or malformed address: 400', async () => {
    for (const slug of ['admin', 'two--hyphens', 'x'.repeat(64)]) {
      const res = await approve(ids.taken, { slug }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    }
    await approve(ids.taken, { slug: 'fine', extra: 1 }).expect(400);
  });

  it('refuses an owner name the invite would refuse (too long, a zero-width space) before deciding: 409 OWNER_NAME_TOO_LONG', async () => {
    for (const id of [ids.longName, ids.zeroWidth]) {
      const res = await approve(id).expect(409);
      expect(res.body.error.code).toBe('OWNER_NAME_TOO_LONG');
      const { application, audit } = await stateOf(id);
      expect(application.status).toBe('PENDING_REVIEW');
      expect(audit).toEqual([]);
    }
  });

  it('finishes an application approved without a firm, with no second decision', async () => {
    const open = FirmApplicationRecord.parse(
      (
        await request(app.getHttpServer())
          .get(base(ids.resume))
          .set('authorization', `Bearer ${adminToken}`)
          .expect(200)
      ).body,
    );
    expect(open.status).toBe('APPROVED');
    expect(open.firm).toBeNull();
    expect(open.suggestedSlug).toBe(`sample-approve-${tag}-6`);

    // Its picked address was taken in between: still 409, and approving again finishes it.
    expect((await approve(ids.resume, { slug: fx.firmB.slug }).expect(409)).body.error.code).toBe(
      'SLUG_TAKEN',
    );
    // Its suggested address was also taken since the page opened: the next free one is used.
    await asOwner((tx) =>
      tx.business.create({ data: { name: `Other ${tag}`, slug: open.suggestedSlug ?? '' } }),
    );
    const record = FirmApplicationRecord.parse((await approve(ids.resume).expect(200)).body);
    expect(record.firm?.slug).toBe(`${open.suggestedSlug}-2`);
    const { audit } = await stateOf(ids.resume);
    expect(audit.map((a) => a.action)).toEqual([
      'firm_application.viewed',
      'business.created',
      'settings.copied_from_application',
    ]);
  });

  it('creates one firm for two approvals at once (a double click)', async () => {
    const [a, b] = await Promise.all([approve(ids.twice), approve(ids.twice)]);
    const statuses = [a.status, b.status].sort();
    // The second waits on the first's lock, then either finds the firm or the decision.
    expect(statuses[0]).toBe(200);
    const { application, audit } = await stateOf(ids.twice);
    expect(application.businessId).not.toBeNull();
    expect(audit.filter((x) => x.action === 'business.created')).toHaveLength(1);
    expect(audit.filter((x) => x.action === 'firm_application.approved')).toHaveLength(1);
    for (const res of [a, b].filter((r) => r.status === 200)) {
      expect(FirmApplicationRecord.parse(res.body).firm?.id).toBe(application.businessId);
    }
    for (const res of [a, b].filter((r) => r.status !== 200)) {
      expect(res.status).toBe(409);
    }
  });

  it('approves a form it cannot read, from the columns', async () => {
    const record = FirmApplicationRecord.parse((await approve(ids.unreadable).expect(200)).body);
    expect(record.formReadable).toBe(false);
    expect(record.firm).toMatchObject({ name: legalName(8), status: 'PENDING_SETUP' });
    expect((await stateOf(ids.unreadable)).firm).toMatchObject({
      businessType: null,
      pack: 'TAX_ACCOUNTING',
    });
  });

  it('is for Super Admins only (401 for a firm login), and 404 for an unknown application', async () => {
    // A firm owner's login is not a Super Admin session at all.
    const staff = await tokenFor(fx.users.ownerA.email);
    await approve(ids.taken, {}, staff).expect(401);
    expect((await stateOf(ids.taken)).application.status).toBe('PENDING_REVIEW');
    expect((await approve(randomUUID()).expect(404)).body.error.code).toBe('NOT_FOUND');
    await approve('not-an-id').expect(400);
  });
});
