// End-to-end: the portal's My Profile phone change (R10's route) moves the PRIMARY login's own
// number too (users.phone, which texts and the SMS switch read): the new number is unverified and
// every SMS choice is cleared in the same transaction (R6, the #160 pre-review follow-up).
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { AppModule } from '../../src/app.module.js';
import { MyProfileService } from '../../src/clients/my-profile.service.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({
  id: randomUUID(),
  email: `r6p-${key}-${run}@example.test`,
  name: `Fake R6p ${key}`,
});
const people = { primary: person('primary'), spouse: person('spouse'), other: person('other') };
type Who = (typeof people)[keyof typeof people];
const ids = { firmA: '', slugA: `r6p-a-${run}`, clientA: '' };
const OLD = '+17705550170';
const NEW = '+17705550171';
/** A valid E.164 number texts may not go to (SmsPhone: Canadian area code). */
const NON_US = '+14165550172';
type LoginPhoneMove = { userId: string; from: string | null; to: string | null };
const moves = () =>
  app.get(MyProfileService) as unknown as {
    moveLoginPhone: (m: LoginPhoneMove) => Promise<void>;
  };

let app: INestApplication;
const owner = () => createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
async function scoped<T>(
  scope: Parameters<typeof runInScope>[1],
  work: (tx: TxClient) => Promise<T>,
) {
  const db = owner();
  try {
    return await runInScope(db, scope, work);
  } finally {
    await db.$disconnect();
  }
}
const inFirm = <T>(businessId: string, work: (tx: TxClient) => Promise<T>) =>
  scoped({ kind: 'business', businessId }, work);

async function patchProfile(who: Who, body: object) {
  const { token } = (
    await request(app.getHttpServer())
      .post('/api/v1/dev/token')
      .send({ email: who.email })
      .expect(200)
  ).body as { token: string };
  return request(app.getHttpServer())
    .patch(`/api/v1/portal/${ids.slugA}/me/profile`)
    .set('authorization', `Bearer ${token}`)
    .send(body);
}

const smsChoices = (businessId: string, who: Who) =>
  inFirm(businessId, (tx) =>
    tx.notificationPreference.findMany({
      where: { businessId, userId: who.id },
      select: { category: true, sms: true },
    }),
  );
const optIn = (businessId: string, who: Who) =>
  inFirm(businessId, (tx) =>
    tx.notificationPreference.upsert({
      where: {
        businessId_userId_category: { businessId, userId: who.id, category: 'DOCUMENTS' },
      },
      create: { businessId, userId: who.id, category: 'DOCUMENTS', sms: true },
      update: { sms: true },
    }),
  );
const user = (who: Who) =>
  scoped({ kind: 'platform' }, (tx) => tx.user.findUniqueOrThrow({ where: { id: who.id } }));
const profileAudits = () =>
  inFirm(ids.firmA, (tx) =>
    tx.auditLog.findMany({
      where: { businessId: ids.firmA, entityId: ids.clientA, action: 'portal.profile_updated' },
      orderBy: { createdAt: 'asc' },
    }),
  );
const account = (who: Who) =>
  inFirm(ids.firmA, (tx) =>
    tx.clientAccount.findFirstOrThrow({ where: { businessId: ids.firmA, userId: who.id } }),
  );

beforeAll(async () => {
  await scoped({ kind: 'platform' }, async (tx) => {
    for (const p of Object.values(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: 'CLIENT',
          email: p.email,
          name: p.name,
          phone: OLD,
        },
      });
    }
    ids.firmA = (
      await tx.business.create({ data: { slug: ids.slugA, name: 'Fake R6p A', status: 'ACTIVE' } })
    ).id;
  });
  const login = (
    tx: TxClient,
    businessId: string,
    who: Who,
    clientId: string,
    role: 'PRIMARY' | 'SPOUSE',
  ) =>
    tx.clientAccount.create({
      data: {
        businessId,
        userId: who.id,
        clientId,
        email: who.email,
        portalRole: role,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        phoneVerifiedAt: new Date(),
      },
    });
  await inFirm(ids.firmA, async (tx) => {
    const c = await tx.client.create({
      data: { businessId: ids.firmA, displayName: 'Jamie Sample (fake)', phone: OLD },
    });
    ids.clientA = c.id;
    await login(tx, ids.firmA, people.primary, c.id, 'PRIMARY');
    await login(tx, ids.firmA, people.spouse, c.id, 'SPOUSE');
    const c2 = await tx.client.create({
      data: { businessId: ids.firmA, displayName: 'Other (fake)' },
    });
    await login(tx, ids.firmA, people.other, c2.id, 'PRIMARY');
  });
  for (const who of Object.values(people)) await optIn(ids.firmA, who);

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.init();
  app = nest;
});

afterAll(async () => {
  await app?.close();
});

describe("My Profile phone: the PRIMARY login's own number follows", () => {
  it('the same number again changes nothing', async () => {
    const res = await patchProfile(people.primary, { phone: OLD });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await smsChoices(ids.firmA, people.primary)).toEqual([
      { category: 'DOCUMENTS', sms: true },
    ]);
    expect((await account(people.primary)).phoneVerifiedAt).not.toBeNull();
  });

  it('a new number: saved on the login unverified, SMS choices cleared', async () => {
    const res = await patchProfile(people.primary, { phone: '(770) 555-0171' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ phone: NEW });
    expect((await user(people.primary)).phone).toBe(NEW);
    expect((await account(people.primary)).phoneVerifiedAt).toBeNull();
    expect(await smsChoices(ids.firmA, people.primary)).toEqual([
      { category: 'DOCUMENTS', sms: false },
    ]);
    // Audited with the field names only, never the number.
    const audits = await profileAudits();
    expect(audits.at(-1)?.metadata).toEqual({ fields: ['phone'] });
    expect(JSON.stringify(audits)).not.toContain('5550171');
    // Nobody else's: the spouse of the same client and another client keep theirs.
    for (const who of [people.spouse, people.other]) {
      expect(await smsChoices(ids.firmA, who)).toEqual([{ category: 'DOCUMENTS', sms: true }]);
      expect((await user(who)).phone).toBe(OLD);
    }
  });

  it('a removed number clears them again', async () => {
    await optIn(ids.firmA, people.primary);
    const res = await patchProfile(people.primary, { phone: null });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await user(people.primary)).phone).toBeNull();
    expect(await smsChoices(ids.firmA, people.primary)).toEqual([
      { category: 'DOCUMENTS', sms: false },
    ]);
  });

  it('a number texts may not go to stays on the client record; the login gets none', async () => {
    expect((await patchProfile(people.primary, { phone: NEW })).status).toBe(200);
    expect((await user(people.primary)).phone).toBe(NEW);
    await optIn(ids.firmA, people.primary);
    const res = await patchProfile(people.primary, { phone: NON_US });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ phone: NON_US });
    expect((await user(people.primary)).phone).toBeNull();
    expect(await smsChoices(ids.firmA, people.primary)).toEqual([
      { category: 'DOCUMENTS', sms: false },
    ]);
  });

  it("a failed login step still answers 200 and keeps the firm's change and its audit row", async () => {
    expect((await patchProfile(people.primary, { phone: NEW })).status).toBe(200);
    await optIn(ids.firmA, people.primary);
    const before = (await profileAudits()).length;
    const spy = vi
      .spyOn(moves(), 'moveLoginPhone')
      .mockRejectedValueOnce(new Error('database unavailable'));
    try {
      const res = await patchProfile(people.primary, { phone: OLD });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
    }
    const audits = await profileAudits();
    expect(audits).toHaveLength(before + 1);
    expect(audits.at(-1)?.metadata).toEqual({ fields: ['phone'] });
    // The login keeps its old number, but no SMS choice is left on.
    expect((await user(people.primary)).phone).toBe(NEW);
    expect(await smsChoices(ids.firmA, people.primary)).toEqual([
      { category: 'DOCUMENTS', sms: false },
    ]);
  });

  it('a slower earlier save never overwrites a later one (the write needs the number it read)', async () => {
    const now = (await user(people.primary)).phone;
    await moves().moveLoginPhone({ userId: people.primary.id, from: '+17705550199', to: OLD });
    expect((await user(people.primary)).phone).toBe(now);
    await moves().moveLoginPhone({ userId: people.primary.id, from: now, to: OLD });
    expect((await user(people.primary)).phone).toBe(OLD);
  });

  it('a SPOUSE cannot change the phone, so nothing of theirs moves', async () => {
    const res = await patchProfile(people.spouse, { phone: NEW });
    expect(res.status).toBe(403);
    expect((await user(people.spouse)).phone).toBe(OLD);
    expect(await smsChoices(ids.firmA, people.spouse)).toEqual([
      { category: 'DOCUMENTS', sms: true },
    ]);
  });
});
