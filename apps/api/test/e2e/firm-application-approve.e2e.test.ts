// End-to-end: approving a firm application (R4 step 3) and the owner's activation link (the owner
// side of step 4). The firm's KMS key adapter is a fake (no AWS), the activation email goes to an
// outbox the tests read, and the NotifyService is a recorder.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type Scope, type TxClient } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { FirmApplicationRecord } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { ACTIVATION_MAILER, type ActivationEmail } from '../../src/auth/activation-mailer.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { firmIdFor } from '../../src/firm-applications/firm-applications.service.js';
import { FIRM_KEYS, type FirmKeys } from '../../src/firm-applications/firm-keys.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';

const fx = inject('fixtures');
let app: INestApplication;
let adminToken: string;
const sent: NotifyMessage[] = [];
const outbox: ActivationEmail[] = [];

/** Stands in for AWS KMS: one fake key per firm, and an outage on demand. */
const keyCalls: string[] = [];
let kmsDown = false;
const fakeKeys: FirmKeys = {
  mode: 'kms',
  ensureKey: (businessId) => {
    keyCalls.push(businessId);
    if (kmsDown) return Promise.reject(new Error('KMS is unavailable'));
    return Promise.resolve(`arn:aws:kms:us-east-1:000000000000:key/${businessId}`);
  },
};

const tag = `r4apr${randomUUID().slice(0, 8)}`;
const ids = {
  approved: randomUUID(),
  taken: randomUUID(),
  declined: randomUUID(),
  resumed: randomUUID(),
  noLink: randomUUID(),
  raced: randomUUID(),
};
/** A firm approved before its owner link was ever sent (created here, without an owner). */
const linkless = { id: randomUUID(), slug: `${tag}-no-link` };

const email = (n: number) => `casey${n}@${tag}.example.test`;
const stored = (n: number) => ({
  business: {
    practiceType: 'BOOKKEEPING',
    legalName: `Sample Approve ${tag} ${n}`,
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
    email: email(n),
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

async function asOwner<T>(scope: Scope, work: (tx: TxClient) => Promise<T>): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  try {
    return await runInScope(owner, scope, work);
  } finally {
    await owner.$disconnect();
  }
}

async function tokenFor(address: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .send({ email: address })
    .expect(200);
  return (res.body as { token: string }).token;
}
const base = (id: string) => `/api/v1/admin/firm-applications/${id}`;
const post = (path: string, body: object = {}, token = adminToken) =>
  request(app.getHttpServer()).post(path).set('authorization', `Bearer ${token}`).send(body);
const get = (id: string) =>
  request(app.getHttpServer()).get(base(id)).set('authorization', `Bearer ${adminToken}`);
const codeOf = (res: Response) => [
  res.status,
  (res.body as { error?: { code: string } }).error?.code,
];
const record = (res: Response) => FirmApplicationRecord.parse(res.body);

/** The token in the last activation email to `address`. */
function tokenSentTo(address: string): string {
  const mail = [...outbox].reverse().find((m) => m.to === address);
  const token = mail?.link.split('#token=')[1];
  if (!token) throw new Error(`no activation link to ${address}`);
  return token;
}

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    // Numbered in order: approved 1, taken 2, declined 3, resumed 4, noLink 5, raced 6.
    for (const [i, id] of Object.values(ids).entries()) {
      const data = stored(i + 1);
      await tx.firmApplication.create({
        data: {
          id,
          legalName: data.business.legalName,
          contactName: data.primaryAdmin.fullName,
          contactEmail: data.primaryAdmin.email,
          contactPhone: data.primaryAdmin.phone,
          data,
        },
      });
    }
    await tx.business.create({
      data: { ...linkless, name: `Sample Approve ${tag} 5`, status: 'PENDING_SETUP' },
    });
  });
  // Approved and linked without an owner link (as if approve had stopped after the firm).
  await asOwner({ kind: 'admin', adminUserId: fx.users.admin.id }, (tx) =>
    tx.firmApplication.update({
      where: { id: ids.noLink },
      data: { status: 'APPROVED', reviewedByUserId: fx.users.admin.id, reviewedAt: new Date() },
    }),
  );
  await asOwner({ kind: 'platform' }, (tx) =>
    tx.firmApplication.update({ where: { id: ids.noLink }, data: { businessId: linkless.id } }),
  );

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
    .overrideProvider(ACTIVATION_MAILER)
    .useValue({ send: (m: ActivationEmail) => (outbox.push(m), Promise.resolve()) })
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
});

describe('POST /admin/firm-applications/{id}/approve', () => {
  it('creates the firm with its key, links the application and invites the owner', async () => {
    const firmId = firmIdFor(ids.approved);
    const a = record(await post(`${base(ids.approved)}/approve`).expect(200));
    expect(a.status).toBe('APPROVED');
    expect(a.firm).toEqual({
      id: firmId,
      slug: `sample-approve-${tag}-1`,
      name: `Sample Approve ${tag} 1`,
      status: 'PENDING_SETUP',
    });
    expect(a.decision).toMatchObject({ by: { userId: fx.users.admin.id }, reason: null });
    expect(a.suggestedSlug).toBeNull();
    expect(a.ownerInvite?.status).toBe('SENT');
    const days = (Date.parse(a.ownerInvite!.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);
    expect(a.history.map((h) => [h.type, h.by?.userId ?? null])).toEqual([
      ['OWNER_INVITED', fx.users.admin.id],
      ['APPROVED', fx.users.admin.id],
      ['SUBMITTED', null],
    ]);
    expect(keyCalls).toContain(firmId);

    // The activation email is the invite's own; nothing goes through NotifyService.
    expect(outbox.filter((m) => m.to === email(1)).map((m) => m.businessName)).toEqual([
      `Sample Approve ${tag} 1`,
    ]);
    expect(sent).toEqual([]);

    const firm = await asOwner({ kind: 'platform' }, (tx) =>
      tx.business.findUniqueOrThrow({ where: { id: firmId } }),
    );
    expect(firm).toMatchObject({
      slug: `sample-approve-${tag}-1`,
      name: `Sample Approve ${tag} 1`,
      legalName: `Sample Approve ${tag} 1`,
      status: 'PENDING_SETUP',
      pack: 'TAX_ACCOUNTING',
      businessType: 'BOOKKEEPING',
      kmsKeyId: `arn:aws:kms:us-east-1:000000000000:key/${firmId}`,
    });
    // The owner role may skip row-level security locally, so every query names the firm.
    const { members, invites } = await asOwner(
      { kind: 'business', businessId: firmId },
      async (tx) => ({
        members: await tx.membership.findMany({
          where: { businessId: firmId },
          select: { id: true, role: true, status: true, user: { select: { email: true } } },
        }),
        invites: await tx.invite.findMany({
          where: { businessId: firmId },
          select: { membershipId: true, invitedByUserId: true, acceptedAt: true, revokedAt: true },
        }),
      }),
    );
    expect(members).toEqual([
      { id: expect.any(String), role: 'OWNER', status: 'INVITED', user: { email: email(1) } },
    ]);
    expect(invites).toEqual([
      { membershipId: members[0]!.id, invitedByUserId: null, acceptedAt: null, revokedAt: null },
    ]);
  });

  it('makes the application final: approve, decline and request-info answer 409', async () => {
    for (const [path, body] of [
      ['approve', {}],
      ['decline', { reason: 'Changed our mind.' }],
      ['request-info', { message: 'Anything else?' }],
    ] as const) {
      expect(codeOf(await post(`${base(ids.approved)}/${path}`, body))).toEqual([
        409,
        'APPLICATION_DECIDED',
      ]);
    }
    const firms = await asOwner({ kind: 'platform' }, (tx) =>
      tx.business.count({ where: { name: `Sample Approve ${tag} 1` } }),
    );
    expect(firms).toBe(1);
  });

  it('audits the approval and the link as platform events, with ids only', async () => {
    const rows = await asOwner({ kind: 'platform' }, (tx) =>
      tx.auditLog.findMany({
        where: { entityId: ids.approved, action: { startsWith: 'firm_application.' } },
        orderBy: { createdAt: 'asc' },
        select: { action: true, businessId: true, actorUserId: true, metadata: true },
      }),
    );
    const firmId = firmIdFor(ids.approved);
    const acts = rows.filter((r) => r.action !== 'firm_application.viewed');
    expect(acts.map((r) => [r.action, r.businessId, r.actorUserId])).toEqual([
      ['firm_application.approved', null, fx.users.admin.id],
      ['firm_application.owner_invited', null, fx.users.admin.id],
    ]);
    expect(acts[0]?.metadata).toEqual({ businessId: firmId });
    expect(acts[1]?.metadata).toEqual({
      businessId: firmId,
      membershipId: expect.any(String),
      inviteId: expect.any(String),
      expiresAt: expect.any(String),
      resent: false,
    });
    expect(JSON.stringify(acts.map((r) => r.metadata))).not.toMatch(/@|#|token/);
    // The invite itself is audited in the new firm by R2's InvitesService.
    const inFirm = await asOwner({ kind: 'business', businessId: firmId }, (tx) =>
      tx.auditLog.findMany({ where: { businessId: firmId }, select: { action: true } }),
    );
    expect(inFirm.map((r) => r.action)).toContain('membership.invited');
  });

  it('refuses a firm\'s address (409 SLUG_TAKEN) and a reserved or malformed one (400)', async () => {
    expect(codeOf(await post(`${base(ids.taken)}/approve`, { slug: fx.firmA.slug }))).toEqual([
      409,
      'SLUG_TAKEN',
    ]);
    for (const slug of ['admin', 'API', 'two--hyphens', '-start', 'x'.repeat(64)]) {
      expect([slug, ...codeOf(await post(`${base(ids.taken)}/approve`, { slug }))]).toEqual([
        slug,
        400,
        'VALIDATION_FAILED',
      ]);
    }
    expect(codeOf(await post(`${base(ids.taken)}/approve`, { slug: 'ok', firm: 'x' }))).toEqual([
      400,
      'VALIDATION_FAILED',
    ]);
    // Nothing changed: still pending, no firm, no email.
    const a = record(await get(ids.taken).expect(200));
    expect([a.status, a.firm, a.history.map((h) => h.type)]).toEqual([
      'PENDING_REVIEW',
      null,
      ['SUBMITTED'],
    ]);
    expect(outbox.some((m) => m.to === email(2))).toBe(false);
  });

  it('answers 409 APPLICATION_DECIDED for a declined application, 404 for an unknown one', async () => {
    await post(`${base(ids.declined)}/decline`, { reason: 'We serve tax practices only.' }).expect(
      200,
    );
    expect(codeOf(await post(`${base(ids.declined)}/approve`))).toEqual([
      409,
      'APPLICATION_DECIDED',
    ]);
    expect(codeOf(await post(`${base(randomUUID())}/approve`))).toEqual([404, 'NOT_FOUND']);
    expect((await post(`${base('not-an-id')}/approve`)).status).toBe(400);
  });

  it('picks up where it stopped when a step after the approval failed', async () => {
    const firmId = firmIdFor(ids.resumed);
    kmsDown = true;
    try {
      expect((await post(`${base(ids.resumed)}/approve`)).status).toBe(500);
    } finally {
      kmsDown = false;
    }
    const stopped = record(await get(ids.resumed).expect(200));
    expect([stopped.status, stopped.firm, stopped.ownerInvite]).toEqual(['APPROVED', null, null]);
    expect(stopped.suggestedSlug).toBe(`sample-approve-${tag}-4`);

    // Again, at another address: the same firm id (so the same key), one firm, one approval.
    const a = record(
      await post(`${base(ids.resumed)}/approve`, { slug: `${tag}-resumed` }).expect(200),
    );
    expect(a.firm).toMatchObject({ id: firmId, slug: `${tag}-resumed` });
    expect(a.ownerInvite?.status).toBe('SENT');
    expect(a.history.map((h) => h.type)).toEqual(['OWNER_INVITED', 'APPROVED', 'SUBMITTED']);
    expect(keyCalls.filter((id) => id === firmId)).toHaveLength(2);
    expect(outbox.filter((m) => m.to === email(4))).toHaveLength(1);
  });

  it('makes one firm when two approvals pick it up at the same time', async () => {
    kmsDown = true;
    try {
      expect((await post(`${base(ids.raced)}/approve`)).status).toBe(500);
    } finally {
      kmsDown = false;
    }
    const results = await Promise.all([
      post(`${base(ids.raced)}/approve`),
      post(`${base(ids.raced)}/approve`),
    ]);
    expect(results.map(codeOf).sort()).toEqual([
      [200, undefined],
      [409, 'APPLICATION_DECIDED'],
    ]);
    const firms = await asOwner({ kind: 'platform' }, (tx) =>
      tx.business.findMany({ where: { name: `Sample Approve ${tag} 6` }, select: { id: true } }),
    );
    expect(firms).toEqual([{ id: firmIdFor(ids.raced) }]);
    expect(outbox.filter((m) => m.to === email(6))).toHaveLength(1);
  });

  it('answers 401 to a firm session', async () => {
    const owner = await tokenFor(fx.users.ownerA.email);
    for (const path of ['approve', 'owner-invite']) {
      expect((await post(`${base(ids.taken)}/${path}`, {}, owner)).status).toBe(401);
    }
  });
});

describe('POST /admin/firm-applications/{id}/owner-invite', () => {
  it('sends a new link (the old one stops working) and adds it to the history', async () => {
    const before = record(await get(ids.approved).expect(200));
    const firstToken = tokenSentTo(email(1));
    const a = record(await post(`${base(ids.approved)}/owner-invite`).expect(200));
    expect(a.ownerInvite?.status).toBe('SENT');
    expect(Date.parse(a.ownerInvite!.expiresAt)).toBeGreaterThanOrEqual(
      Date.parse(before.ownerInvite!.expiresAt),
    );
    expect(a.history.map((h) => h.type)).toEqual([
      'OWNER_INVITED',
      'OWNER_INVITED',
      'APPROVED',
      'SUBMITTED',
    ]);
    expect(tokenSentTo(email(1))).not.toBe(firstToken);
    const old = await request(app.getHttpServer())
      .post('/api/v1/auth/activation/check')
      .set('x-forwarded-for', '198.51.100.40, 10.0.0.5')
      .send({ token: firstToken });
    expect(codeOf(old)).toEqual([404, 'INVITE_INVALID']);
    expect(sent).toEqual([]);

    const resent = await asOwner({ kind: 'platform' }, (tx) =>
      tx.auditLog.findMany({
        where: { entityId: ids.approved, action: 'firm_application.owner_invited' },
        select: { metadata: true },
      }),
    );
    expect(resent.map((r) => (r.metadata as { resent: boolean }).resent).sort()).toEqual([
      false,
      true,
    ]);
  });

  it('sends the first link when approve stopped before it', async () => {
    expect(record(await get(ids.noLink).expect(200)).ownerInvite).toBeNull();
    const a = record(await post(`${base(ids.noLink)}/owner-invite`).expect(200));
    expect(a.ownerInvite?.status).toBe('SENT');
    expect(a.history[0]?.type).toBe('OWNER_INVITED');
    const owners = await asOwner({ kind: 'business', businessId: linkless.id }, (tx) =>
      tx.membership.findMany({
        where: { businessId: linkless.id },
        select: { role: true, status: true },
      }),
    );
    expect(owners).toEqual([{ role: 'OWNER', status: 'INVITED' }]);
    expect(outbox.filter((m) => m.to === email(5))).toHaveLength(1);
  });

  it('shows ACCEPTED once the owner has activated, and then has nothing to send (409)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/activate')
      .set('x-forwarded-for', '198.51.100.41, 10.0.0.5')
      .send({ token: tokenSentTo(email(1)), password: 'Owner-password-12' })
      .expect(200);
    const a = record(await get(ids.approved).expect(200));
    expect(a.ownerInvite?.status).toBe('ACCEPTED');
    expect(codeOf(await post(`${base(ids.approved)}/owner-invite`))).toEqual([
      409,
      'INVITE_NOT_NEEDED',
    ]);
  });

  it('answers 409 INVITE_NOT_NEEDED before approval and for a declined application', async () => {
    for (const id of [ids.taken, ids.declined]) {
      expect(codeOf(await post(`${base(id)}/owner-invite`))).toEqual([409, 'INVITE_NOT_NEEDED']);
    }
    expect(codeOf(await post(`${base(randomUUID())}/owner-invite`))).toEqual([404, 'NOT_FOUND']);
  });
});
