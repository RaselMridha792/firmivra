// End-to-end: what approve sets up after its commits (R4 step 3). The new firm's settings from the
// application (never the EIN), its KMS key (a job through a fake FirmKeys), and the owner's
// activation link (R2's invite, emailed as Firmivra's approval through a recording NotifyService);
// "Resend owner invite"; ownerInvite read from R0's platform_owner_invites.
import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { createPrismaClient, runInScope, type Scope, type TxClient } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { FirmApplicationRecord } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { FirmApplicationsService } from '../../src/firm-applications/firm-applications.service.js';
import { FirmKeyJob } from '../../src/firm-applications/firm-key-job.js';
import { FIRM_KEYS, type FirmKeys } from '../../src/firm-applications/firm-keys.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';

const fx = inject('fixtures');
let app: INestApplication;
let adminToken: string;
const sent: NotifyMessage<'firm-application.approved'>[] = [];
/** Addresses whose email fails (as SES might). */
const failFor = new Set<string>();
/** Firms whose key KMS can't make yet. */
const keyFails = new Set<string>();

const tag = `r16fs${randomUUID().slice(0, 8)}`;
const ids = {
  settings: randomUUID(),
  key: randomUUID(),
  mailFails: randomUUID(),
  resend: randomUUID(),
  pending: randomUUID(),
  copy: randomUUID(),
  resettle: randomUUID(),
};
const adminPoolOnly = { id: randomUUID(), email: `admins-pool-${tag}@firmivra.test` };
const email = (n: number) => `owner${n}@${tag}.example.test`;

const stored = (n: number) => ({
  business: {
    practiceType: 'TAX_ACCOUNTING',
    legalName: `Sample Setup ${tag} ${n}`,
    dbaName: null,
    entityType: 'S_CORP',
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
    services: ['TAX_PREPARATION', 'PAYROLL'],
  },
  primaryAdmin: {
    fullName: `Jordan Sample ${n}`,
    email: email(n),
    phone: '+14045550199',
    title: null,
    preferredContact: 'EMAIL',
    alternatePhone: null,
  },
  account: {
    requestedPlan: 'STARTER',
    teamSize: 7,
    clientVolume: 'UNDER_100',
    heardFrom: null,
    requestedStartDate: null,
    additionalInfo: null,
  },
  credentials: [],
});

async function as<T>(
  scope: Scope,
  fn: (tx: TxClient) => Promise<T>,
  url = testDatabaseUrls('test_api').owner,
): Promise<T> {
  const owner = createPrismaClient(url, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(owner, scope, fn);
  } finally {
    await owner.$disconnect();
  }
}
const asPlatform = <T>(fn: (tx: TxClient) => Promise<T>) => as({ kind: 'platform' }, fn);
const asFirm = <T>(businessId: string, fn: (tx: TxClient) => Promise<T>) =>
  as({ kind: 'business', businessId }, fn);
/** As the API's own database role, under row-level security (the owner bypasses it). */
const asAppInFirm = <T>(businessId: string, fn: (tx: TxClient) => Promise<T>) =>
  as({ kind: 'business', businessId }, fn, fx.appUrl);

async function tokenFor(address: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .send({ email: address })
    .expect(200);
  return (res.body as { token: string }).token;
}

const base = (id: string) => `/api/v1/admin/firm-applications/${id}`;
const post = (path: string, token = adminToken) =>
  request(app.getHttpServer()).post(path).set('authorization', `Bearer ${token}`).send({});
const approve = async (id: string) =>
  FirmApplicationRecord.parse((await post(`${base(id)}/approve`).expect(200)).body);
const resend = (id: string, token = adminToken) => post(`${base(id)}/owner-invite`, token);
const open = async (id: string) =>
  FirmApplicationRecord.parse(
    (
      await request(app.getHttpServer())
        .get(base(id))
        .set('authorization', `Bearer ${adminToken}`)
        .expect(200)
    ).body,
  );

/** The firm's owner membership and its invites, read in the firm's scope. */
const ownerOf = (businessId: string) =>
  asFirm(businessId, async (tx) => {
    const membership = await tx.membership.findFirst({
      where: { businessId, role: 'OWNER' },
      include: { user: { select: { email: true } } },
    });
    const invites = await tx.invite.findMany({
      where: { businessId },
      orderBy: { createdAt: 'asc' },
    });
    return { membership, invites };
  });

const fakeKeys: FirmKeys = {
  mode: 'kms',
  ensureKey: (businessId: string) =>
    keyFails.has(businessId)
      ? Promise.reject(new Error('AccessDeniedException'))
      : Promise.resolve(`arn:aws:kms:us-east-1:000000000000:key/${businessId}`),
};

beforeAll(async () => {
  await asPlatform(async (tx) => {
    for (const [key, n] of Object.entries(ids).map(([k], i) => [k, i + 1] as const)) {
      const data = stored(n);
      await tx.firmApplication.create({
        data: {
          id: ids[key as keyof typeof ids],
          legalName: data.business.legalName,
          contactName: data.primaryAdmin.fullName,
          contactEmail: data.primaryAdmin.email,
          contactPhone: data.primaryAdmin.phone,
          // Submit keeps only these of the EIN: never in the firm's settings.
          einLast4: '4321',
          einHash: randomBytes(32),
          data,
        },
      });
    }
    await tx.user.create({
      data: {
        id: adminPoolOnly.id,
        cognitoSub: adminPoolOnly.id,
        pool: 'ADMIN',
        email: adminPoolOnly.email,
        name: 'Fake R4 admins-pool login',
      },
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
      send: (m: NotifyMessage<'firm-application.approved'>) => {
        if (failFor.has(m.to)) return Promise.reject(new Error('SES is down'));
        sent.push(m);
        return Promise.resolve();
      },
    })
    .overrideProvider(FIRM_KEYS)
    .useValue(fakeKeys)
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
  failFor.clear();
  keyFails.clear();
});

describe('After approve', () => {
  it("copies the entity type, services and team size into the firm's settings, never the EIN", async () => {
    const firm = (await approve(ids.settings)).firm!;
    const settings = await asFirm(firm.id, (tx) =>
      tx.businessSettings.findUniqueOrThrow({ where: { businessId: firm.id } }),
    );
    expect(settings).toMatchObject({
      entityType: 'S_CORP',
      services: ['TAX_PREPARATION', 'PAYROLL'],
      teamSize: 7,
      einEnc: null,
      einLast4: null,
      description: null,
      setupCompletedAt: null,
    });
    const audit = await asFirm(firm.id, (tx) =>
      tx.auditLog.findMany({
        where: { businessId: firm.id, action: 'settings.copied_from_application' },
      }),
    );
    expect(audit).toEqual([
      expect.objectContaining({
        businessId: firm.id,
        actorUserId: fx.users.admin.id,
        entityId: firm.id,
        metadata: {
          applicationId: ids.settings,
          fields: ['entityType', 'services', 'teamSize'],
        },
      }),
    ]);
    // Under row-level security only the new firm's own scope sees them; firm A's never does.
    const count = (scopeId: string) =>
      asAppInFirm(scopeId, (tx) => tx.businessSettings.count({ where: { businessId: firm.id } }));
    expect(await count(firm.id)).toBe(1);
    expect(await count(fx.firmA.id)).toBe(0);
  });

  it("makes the firm's KMS key after the commits and stores it; a failure is made later", async () => {
    const firm = (await approve(ids.key)).firm!;
    await vi.waitFor(async () => {
      const row = await asPlatform((tx) =>
        tx.business.findUniqueOrThrow({ where: { id: firm.id } }),
      );
      expect(row.kmsKeyId).toBe(`arn:aws:kms:us-east-1:000000000000:key/${firm.id}`);
    });
    const audit = await asPlatform((tx) =>
      tx.auditLog.findMany({ where: { action: 'business.key_created', entityId: firm.id } }),
    );
    // A platform event with the firm's id only, never the key's ARN.
    expect(audit).toEqual([expect.objectContaining({ businessId: null, metadata: null })]);
  });

  it('keeps the approval when the key or the email fails; Resend owner invite sends the link', async () => {
    const before = await open(ids.mailFails);
    failFor.add(email(3));
    // The firm's id is not known before approval: fail every key made in this test.
    const job = app.get(FirmKeyJob);
    const start = vi.spyOn(job, 'start').mockImplementation((id) => {
      keyFails.add(id);
      return FirmKeyJob.prototype.start.call(job, id);
    });
    const record = await approve(ids.mailFails);
    start.mockRestore();
    expect(record.status).toBe('APPROVED');
    expect(record.firm).toMatchObject({ slug: before.suggestedSlug, status: 'PENDING_SETUP' });
    const firm = record.firm!;
    await vi.waitFor(async () => {
      expect(job['running'].has(firm.id)).toBe(false);
    });
    expect(
      (await asPlatform((tx) => tx.business.findUniqueOrThrow({ where: { id: firm.id } })))
        .kmsKeyId,
    ).toBeNull();
    // The invite committed before its email failed: the owner is invited, nothing was sent.
    const first = await ownerOf(firm.id);
    expect(first.membership).toMatchObject({ status: 'INVITED', user: { email: email(3) } });
    expect(first.invites).toHaveLength(1);
    expect(sent).toEqual([]);

    // The key: the job tries again.
    keyFails.clear();
    await job.start(firm.id);
    expect(
      (await asPlatform((tx) => tx.business.findUniqueOrThrow({ where: { id: firm.id } })))
        .kmsKeyId,
    ).not.toBeNull();

    // The link: the Super Admin sends a new one; the old one stops working.
    failFor.clear();
    FirmApplicationRecord.parse((await resend(ids.mailFails).expect(200)).body);
    const after = await ownerOf(firm.id);
    expect(after.membership?.id).toBe(first.membership?.id);
    expect(after.invites).toHaveLength(2);
    expect(after.invites[0]?.revokedAt).not.toBeNull();
    expect(after.invites[1]?.revokedAt).toBeNull();
    expect(sent).toHaveLength(1);
    const audit = await asPlatform((tx) =>
      tx.auditLog.findMany({
        where: { action: 'firm_application.owner_invite_resent', entityId: ids.mailFails },
      }),
    );
    expect(audit).toEqual([
      expect.objectContaining({
        businessId: null,
        actorUserId: fx.users.admin.id,
        metadata: { businessId: firm.id, membershipId: first.membership?.id },
      }),
    ]);
  });

  it('invites the primary administrator as owner and emails the link as the approval', async () => {
    const firm = (await approve(ids.resend)).firm!;
    const { membership, invites } = await ownerOf(firm.id);
    expect(membership).toMatchObject({
      role: 'OWNER',
      status: 'INVITED',
      user: { email: email(4) },
    });
    expect(invites).toEqual([
      expect.objectContaining({ email: email(4), name: 'Jordan Sample 4', invitedByUserId: null }),
    ]);
    expect(sent).toHaveLength(1);
    const [message] = sent;
    expect(message).toMatchObject({
      template: 'firm-application.approved',
      to: email(4),
      businessId: null,
      data: { name: 'Jordan Sample 4', legalName: `Sample Setup ${tag} 4` },
    });
    expect(message?.data.link).toMatch(/\/activate#token=[A-Za-z0-9_-]{43}$/);
    expect(message?.data.expiresAt).toEqual(invites[0]?.expiresAt);
    // Nothing reached another firm: the person's only membership is the new firm's.
    expect(
      await asPlatform((tx) =>
        tx.membership.findMany({
          where: { user: { email: email(4) } },
          select: { businessId: true },
        }),
      ),
    ).toEqual([{ businessId: firm.id }]);
  });

  it('answers 409 INVITE_NOT_NEEDED before approval and once the owner has joined', async () => {
    const pending = await resend(ids.pending).expect(409);
    expect(pending.body.error.code).toBe('INVITE_NOT_NEEDED');

    const firm = (await open(ids.resend)).firm!;
    await asFirm(firm.id, (tx) =>
      tx.membership.updateMany({ where: { role: 'OWNER' }, data: { status: 'ACTIVE' } }),
    );
    sent.length = 0;
    const joined = await resend(ids.resend).expect(409);
    expect(joined.body.error.code).toBe('INVITE_NOT_NEEDED');
    expect(sent).toEqual([]);
    expect((await resend(randomUUID()).expect(404)).body.error.code).toBe('NOT_FOUND');
  });

  it("shows the owner's link from platform_owner_invites: sent, sent again, then accepted", async () => {
    const approved = await approve(ids.copy);
    const firm = approved.firm!;
    const first = await ownerOf(firm.id);
    // Approve's link is Firmivra's: written in platform scope, with the token-free copy.
    expect(first.invites).toEqual([expect.objectContaining({ sentByPlatform: true })]);
    expect(approved.ownerInvite).toEqual({
      status: 'SENT',
      expiresAt: first.invites[0]?.expiresAt.toISOString(),
    });
    expect(approved.history.map((h) => h.type)).toEqual(['OWNER_INVITED', 'APPROVED', 'SUBMITTED']);

    const resent = FirmApplicationRecord.parse((await resend(ids.copy).expect(200)).body);
    const second = await ownerOf(firm.id);
    expect(second.invites.map((i) => [i.sentByPlatform, i.revokedAt === null])).toEqual([
      [true, false],
      [true, true],
    ]);
    expect(resent.ownerInvite?.expiresAt).toBe(second.invites[1]?.expiresAt.toISOString());
    expect(resent.history.filter((h) => h.type === 'OWNER_INVITED')).toHaveLength(2);

    await asFirm(firm.id, (tx) =>
      tx.invite.update({ where: { id: second.invites[1]!.id }, data: { acceptedAt: new Date() } }),
    );
    expect((await open(ids.copy)).ownerInvite?.status).toBe('ACCEPTED');
  });

  it('copies settings an approval could not copy when the owner invite is sent again', async () => {
    // The copy fails once, as if the connection dropped after the firm was created.
    const service = FirmApplicationsService.prototype as unknown as {
      copySettings: () => Promise<void>;
    };
    const copy = vi
      .spyOn(service, 'copySettings')
      .mockRejectedValueOnce(new Error('connection lost'));
    const firm = (await approve(ids.resettle)).firm!;
    copy.mockRestore();
    const settingsOf = () =>
      asFirm(firm.id, (tx) => tx.businessSettings.findUnique({ where: { businessId: firm.id } }));
    expect(await settingsOf()).toBeNull();
    await resend(ids.resettle).expect(200);
    expect(await settingsOf()).toMatchObject({ entityType: 'S_CORP', teamSize: 7, einEnc: null });
    // Again: the copy is kept, not repeated.
    await resend(ids.resettle).expect(200);
    const audit = await asFirm(firm.id, (tx) =>
      tx.auditLog.count({
        where: { businessId: firm.id, action: 'settings.copied_from_application' },
      }),
    );
    expect(audit).toBe(1);
  });

  it('is for Super Admins only: 401 for a firm login, 403 for an admins-pool login without the role', async () => {
    await resend(ids.copy, await tokenFor(fx.users.ownerA.email)).expect(401);
    const forbidden = await resend(ids.copy, await tokenFor(adminPoolOnly.email)).expect(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
    await request(app.getHttpServer())
      .post(`${base(ids.copy)}/owner-invite`)
      .send({})
      .expect(401);
  });
});
