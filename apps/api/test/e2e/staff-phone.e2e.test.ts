// End-to-end: a member verifies the mobile number on their login (R60's column requests 9 and 13),
// GET /api/v1/business/me/phone, POST .../code and POST .../verify (contract in
// packages/types/src/notifications/staff-phone.ts). Codes live in R1's staff_phone_codes as an
// HMAC; locally every code is 000000. A firm sees only its own codes. Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { NotificationPreferences, StaffPhoneState } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { TokenService } from '../../src/auth/token.service.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { STAFF_PHONE_LIMITS } from '../../src/staff-phone/staff-phone.service.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
// Fake 555 numbers (CLAUDE.md rule 9).
const person = (key: string, phone: string | null) => ({
  id: randomUUID(),
  email: `r60-phone-${key}-${run}@r60.test`,
  phone,
});
const people = {
  ownerA: person('owner-a', '+14045550101'),
  staffA: person('staff-a', null),
  both: person('both', '+14045550102'),
  ownerB: person('owner-b', '+14045550103'),
  clientA: person('client-a', '+14045550104'),
};
type Person = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', { id: string }>;

let app: INestApplication;
const db = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
/** The app's role, under row-level security, as the API runs. */
const appDb = createPrismaClient(fx.appUrl, TEST_CLIENT_OPTIONS);
const gap = STAFF_PHONE_LIMITS.resendGapMs;

async function call(
  who: Person,
  firm: 'a' | 'b',
  path: '' | '/code' | '/verify',
  body?: object,
  pool: 'STAFF' | 'CLIENT' = 'STAFF',
) {
  const { token } = await app.get(TokenService).signLocal(who.id, pool);
  const req = request(app.getHttpServer());
  const url = `/api/v1/business/me/phone${path}`;
  const r = path ? req.post(url).send(body ?? {}) : req.get(url);
  return r.set('x-business-id', firms[firm].id).set('authorization', `Bearer ${token}`);
}
const state = async (who: Person, firm: 'a' | 'b') => {
  const res = await call(who, firm, '');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return StaffPhoneState.parse(res.body);
};
const setPhone = (who: Person, phone: string) =>
  runInScope(db, { kind: 'platform' }, (tx) =>
    tx.user.update({ where: { id: who.id }, data: { phone } }),
  );
/** The member's codes as the firm's scope sees them (the app's role, under row-level security). */
const codesOf = (who: Person, firm: 'a' | 'b') =>
  runInScope(appDb, { kind: 'business', businessId: firms[firm].id }, (tx) =>
    tx.staffPhoneCode.findMany({ where: { userId: who.id }, orderBy: { createdAt: 'asc' } }),
  );
async function preferences(who: Person, firm: 'a' | 'b') {
  const { token } = await app.get(TokenService).signLocal(who.id, 'STAFF');
  const res = await request(app.getHttpServer())
    .get('/api/v1/business/me/notification-preferences')
    .set('x-business-id', firms[firm].id)
    .set('authorization', `Bearer ${token}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return NotificationPreferences.parse(res.body);
}

beforeAll(async () => {
  await runInScope(db, { kind: 'platform' }, async (tx) => {
    await tx.user.createMany({
      data: Object.entries(people).map(([key, p]) => ({
        id: p.id,
        email: p.email,
        phone: p.phone,
        cognitoSub: p.id,
        pool: key === 'clientA' ? 'CLIENT' : 'STAFF',
        name: `Fake R60 ${key}`,
      })),
    });
    for (const key of ['a', 'b'] as const) {
      const slug = `r60-phone-${key}-${run}`;
      firms[key] = await tx.business.create({
        data: { slug, name: slug, status: 'ACTIVE' },
        select: { id: true },
      });
    }
  });
  for (const [k, userId, role] of [
    ['a', people.ownerA.id, 'OWNER'],
    ['a', people.staffA.id, 'STAFF'],
    ['a', people.both.id, 'STAFF'],
    ['b', people.both.id, 'STAFF'],
    ['b', people.ownerB.id, 'OWNER'],
  ] as const) {
    await runInScope(db, { kind: 'business', businessId: firms[k].id }, (tx) =>
      tx.membership.create({ data: { businessId: firms[k].id, userId, role, status: 'ACTIVE' } }),
    );
  }
  await runInScope(db, { kind: 'business', businessId: firms.a.id }, async (tx) => {
    const client = await tx.client.create({
      data: { businessId: firms.a.id, displayName: 'Fake R60 phone client' },
    });
    await tx.clientAccount.create({
      data: {
        businessId: firms.a.id,
        userId: people.clientA.id,
        email: people.clientA.email,
        clientId: client.id,
        status: 'ACTIVE',
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
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterEach(() => {
  STAFF_PHONE_LIMITS.resendGapMs = gap;
});

afterAll(async () => {
  await app.close();
  await db.$disconnect();
  await appDb.$disconnect();
});

describe('the member’s own mobile number', () => {
  it('shows the number on the login, not verified, and no SMS offered yet', async () => {
    expect(await state(people.ownerA, 'a')).toEqual({
      phone: '+14045550101',
      verifiedAt: null,
      codeSent: false,
      resendAt: null,
    });
    expect((await preferences(people.ownerA, 'a')).channels).toEqual(['EMAIL']);
  });

  it('refuses a code without a number on the staff record (409 NO_PHONE)', async () => {
    expect((await state(people.staffA, 'a')).phone).toBeNull();
    const res = await call(people.staffA, 'a', '/code');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'NO_PHONE' });
  });

  it('texts one code a minute, keeps only its hash, and a right code verifies the number', async () => {
    const sent = await call(people.ownerA, 'a', '/code');
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(StaffPhoneState.parse(sent.body)).toMatchObject({ codeSent: true, verifiedAt: null });
    expect(StaffPhoneState.parse(sent.body).resendAt).not.toBeNull();

    const again = await call(people.ownerA, 'a', '/code');
    expect(again.status).toBe(429);
    expect(again.body.error).toMatchObject({ code: 'CODE_WAIT' });
    expect(Number(again.headers['retry-after'])).toBeGreaterThan(0);

    const [row] = await codesOf(people.ownerA, 'a');
    expect(row).toMatchObject({ target: '+14045550101', attempts: 0, consumedAt: null });
    expect(row?.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.codeHash).not.toContain('000000');

    const wrong = await call(people.ownerA, 'a', '/verify', { code: '111111' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toMatchObject({ code: 'CODE_INVALID' });
    const bad = await call(people.ownerA, 'a', '/verify', { code: '12ab' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatchObject({ code: 'VALIDATION_FAILED' });

    const right = await call(people.ownerA, 'a', '/verify', { code: '000000' });
    expect(right.status, JSON.stringify(right.body)).toBe(200);
    const after = StaffPhoneState.parse(right.body);
    expect(after.verifiedAt).not.toBeNull();
    expect(after).toMatchObject({ codeSent: false, resendAt: null });
    const [used] = await codesOf(people.ownerA, 'a');
    expect(used).toMatchObject({ attempts: 2 });
    expect(used?.consumedAt).not.toBeNull();

    // Now the member is offered texts.
    expect((await preferences(people.ownerA, 'a')).channels).toEqual(['EMAIL', 'SMS']);
    // Ids only in the audit log: never the number or the code.
    const audit = await runInScope(db, { kind: 'business', businessId: firms.a.id }, (tx) =>
      tx.auditLog.findMany({
        where: { actorUserId: people.ownerA.id, action: { startsWith: 'staff_phone.' } },
        select: { action: true, metadata: true },
      }),
    );
    expect(audit.map((a) => a.action).sort()).toEqual([
      'staff_phone.code_sent',
      'staff_phone.verified',
    ]);
    expect(JSON.stringify(audit)).not.toMatch(/4045550101|000000/);
  });

  it('a new number clears the verification and the SMS offer', async () => {
    await setPhone(people.ownerA, '+14045550109');
    expect(await state(people.ownerA, 'a')).toMatchObject({
      phone: '+14045550109',
      verifiedAt: null,
      codeSent: false,
    });
    expect((await preferences(people.ownerA, 'a')).channels).toEqual(['EMAIL']);
  });

  it('five tries per code, then even the right code is refused', async () => {
    expect((await call(people.both, 'a', '/code')).status).toBe(200);
    for (let i = 0; i < 5; i++) {
      expect((await call(people.both, 'a', '/verify', { code: '222222' })).status).toBe(400);
    }
    const late = await call(people.both, 'a', '/verify', { code: '000000' });
    expect(late.status).toBe(400);
    expect(late.body.error).toMatchObject({ code: 'CODE_INVALID' });
    expect((await state(people.both, 'a')).codeSent).toBe(false);
  });

  it('a code sent in one firm is not seen or usable in another (row-level security)', async () => {
    expect(await codesOf(people.both, 'b')).toEqual([]);
    const res = await call(people.both, 'b', '/verify', { code: '000000' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'CODE_INVALID' });
    expect((await state(people.both, 'b')).codeSent).toBe(false);
  });

  it('refuses a right code after the number changed (409 PHONE_CHANGED)', async () => {
    expect((await call(people.ownerB, 'b', '/code')).status).toBe(200);
    await setPhone(people.ownerB, '+14045550108');
    const res = await call(people.ownerB, 'b', '/verify', { code: '000000' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'PHONE_CHANGED' });
    expect((await state(people.ownerB, 'b')).verifiedAt).toBeNull();
  });

  it('a new code replaces the last one, which can no longer verify', async () => {
    STAFF_PHONE_LIMITS.resendGapMs = 0;
    expect((await call(people.ownerB, 'b', '/code')).status).toBe(200);
    expect((await call(people.ownerB, 'b', '/code')).status).toBe(200);
    const codes = await codesOf(people.ownerB, 'b');
    expect(codes).toHaveLength(3);
    const res = await call(people.ownerB, 'b', '/verify', { code: '000000' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = await codesOf(people.ownerB, 'b');
    expect(after.filter((c) => c.consumedAt !== null).map((c) => c.id)).toEqual([codes[2]?.id]);
  });

  it('is for the firm’s members only: a client login gets 403', async () => {
    const res = await call(people.clientA, 'a', '', undefined, 'CLIENT');
    expect(res.status).toBe(403);
  });
});
