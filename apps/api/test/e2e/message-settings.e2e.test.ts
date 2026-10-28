// End-to-end: Messages Settings (R60, MSG-F02; Octavia's review of Oct 27, her section 19). The
// firm's one message_settings row: the defaults until the first save, read by every member,
// changed by Owner and Admin only, guarded by its version, never another firm's. The audit entry
// names the fields changed, never a signature or a name. Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { z } from 'zod';
import { MessageSettings as SettingsShape } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE } from '../../src/notify/notify.types.js';

// A strict copy of the contract's shape: a leaked field fails the parse.
const Settings = z.strictObject({ ...SettingsShape.shape });

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r60s-${key}-${run}@r60.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  ownerB: person('owner-b'),
};
const ids = { firmA: '', firmB: '' };

let app: INestApplication;
const tokens = new Map<string, string>();
async function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .send({ email })
    .expect(200);
  const token = (res.body as { token: string }).token;
  tokens.set(email, token);
  return token;
}
async function call(
  who: { email: string },
  body?: object,
  businessId = ids.firmA,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [body === undefined ? 'get' : 'patch']('/api/v1/business/message-settings')
    .set('x-business-id', businessId)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const settings = async (who = people.ownerA, businessId = ids.firmA) => {
  const res = await call(who, undefined, businessId);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return Settings.parse(res.body);
};
const save = (body: object, who = people.ownerA) => call(who, body);

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake ${key}` },
      });
    }
    ids.firmA = (
      await tx.business.create({ data: { slug: `r60s-a-${run}`, name: 'A', status: 'ACTIVE' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: `r60s-b-${run}`, name: 'B', status: 'ACTIVE' } })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    for (const [userId, role] of [
      [people.ownerA.id, 'OWNER'],
      [people.adminA.id, 'ADMIN'],
      [people.staffA.id, 'STAFF'],
    ] as const) {
      await tx.membership.create({
        data: { businessId: ids.firmA, userId, role, status: 'ACTIVE' },
      });
    }
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    await tx.membership.create({
      data: { businessId: ids.firmB, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    });
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
    .useValue({ send: () => Promise.resolve() })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('MSG-F02: Messages Settings', () => {
  it('reads the defaults until the first save, for every member', async () => {
    const s = await settings(people.staffA);
    expect(s).toMatchObject({
      portalEnabled: true,
      emailEnabled: true,
      smsEnabled: false,
      senderName: null,
      defaultAssignee: null,
      attachmentMaxMb: 10,
      allowedAttachmentTypes: ['pdf', 'doc', 'docx', 'jpg', 'png'],
      quietHoursStart: null,
      bulkConfirmThreshold: 100,
      updatedAt: null,
      updatedBy: null,
    });
    expect(s.timezone).not.toBe('');
  });

  it('Owner and Admin change them; Staff cannot; a stale version is refused', async () => {
    expect((await save({ version: null, smsEnabled: true }, people.staffA)).status).toBe(403);
    const res = await save({
      version: null,
      smsEnabled: true,
      senderName: 'Fake Firm Team',
      signature: `Fake signature ${run}\nFake Firm`,
      notifyBulkComplete: false,
      defaultAssigneeUserId: people.staffA.id,
      readReceiptsEnabled: true,
      retentionMonths: 24,
      attachmentMaxMb: 15,
      allowedAttachmentTypes: ['pdf', 'xlsx', 'csv'],
      quietHoursStart: '21:00',
      quietHoursEnd: '08:00',
      bulkConfirmThreshold: 50,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const s = Settings.parse(res.body);
    expect(s).toMatchObject({
      smsEnabled: true,
      senderName: 'Fake Firm Team',
      notifyBulkComplete: false,
      defaultAssignee: { userId: people.staffA.id, name: 'Fake staffA' },
      readReceiptsEnabled: true,
      retentionMonths: 24,
      attachmentMaxMb: 15,
      allowedAttachmentTypes: ['pdf', 'xlsx', 'csv'],
      quietHoursStart: '21:00',
      quietHoursEnd: '08:00',
      bulkConfirmThreshold: 50,
      updatedBy: { userId: people.ownerA.id, name: 'Fake ownerA' },
    });
    expect(await settings(people.staffA)).toEqual(s);
    // Saved since: the version read before is stale.
    const stale = await save({ version: null, smsEnabled: false });
    expect(stale.status).toBe(409);
    expect(codeOf(stale)).toBe('STALE_VERSION');
    // The Admin clears the sender name and the quiet hours.
    const cleared = await save(
      { version: s.updatedAt, senderName: '', quietHoursStart: null, quietHoursEnd: null },
      people.adminA,
    );
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
    expect(Settings.parse(cleared.body)).toMatchObject({
      senderName: null,
      quietHoursStart: null,
      quietHoursEnd: null,
      smsEnabled: true,
      updatedBy: { userId: people.adminA.id },
    });
  });

  it('refuses what the database would: one quiet hour, too large, an unknown type', async () => {
    for (const body of [
      { quietHoursStart: '21:00' },
      { quietHoursStart: '21:00', quietHoursEnd: '21:00' },
      { quietHoursStart: '25:00', quietHoursEnd: '08:00' },
      { attachmentMaxMb: 26 },
      { allowedAttachmentTypes: ['exe'] },
      { allowedAttachmentTypes: [] },
      { allowedAttachmentTypes: ['pdf', 'pdf'] },
      { retentionMonths: 0 },
      { bulkConfirmThreshold: 100_001 },
      { senderName: 'x'.repeat(101) },
      { version: null },
      { unknown: true },
    ]) {
      const res = await save(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("never names another firm's member, and never shows one firm's settings to another", async () => {
    const res = await save({ defaultAssigneeUserId: people.ownerB.id });
    expect(res.status).toBe(404);
    const b = await settings(people.ownerB, ids.firmB);
    expect(b.updatedAt).toBeNull();
    expect(b.smsEnabled).toBe(false);
  });

  it('audits the names of the fields changed, never a signature or a name', async () => {
    const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
    try {
      const rows = await runInScope(owner, { kind: 'business', businessId: ids.firmA }, (tx) =>
        tx.auditLog.findMany({
          where: { businessId: ids.firmA, action: 'message_settings.updated' },
          orderBy: { createdAt: 'asc' },
        }),
      );
      expect(rows.length).toBe(2);
      expect(rows[0]?.metadata).toMatchObject({
        fields: expect.arrayContaining(['signature', 'senderName', 'defaultAssigneeUserId']),
      });
      expect(JSON.stringify(rows)).not.toContain(run);
      expect(JSON.stringify(rows)).not.toContain('Fake Firm Team');
    } finally {
      await owner.$disconnect();
    }
  });
});
