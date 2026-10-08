// End-to-end: R10 step 4, the client profile. The firm stores SSN, EIN and date of birth only
// through the field-encryption helper (the firm's key, bound to the client and field) and gets
// back SSN and EIN as their last 4 digits, the date of birth in full. The portal's My Profile:
// the client from the session, the date of birth only for the primary login, name changes as a
// task. Reads and changes are audited, never with a value.
import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { z } from 'zod';
import {
  ClientProfile as ProfileShape,
  createMyProfileClient,
  createRequest,
  MyProfile as MineShape,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

// Strict copies of the contract's shapes: a leaked field (an SSN, a key id) fails the parse.
const Profile = z.strictObject({
  ...ProfileShape.shape,
  address: z.strictObject(ProfileShape.shape.address.shape),
});
const Mine = z.strictObject({
  ...MineShape.shape,
  address: z.strictObject(MineShape.shape.address.shape),
});

// Synthetic values only (9xx SSNs are never issued).
const SSN = '900-12-3456';
const EIN = '98-7654321';
const DOB = '1985-04-12';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r10p-${key}-${run}@r10.test` });
const people = {
  ownerA: person('owner-a'),
  staffA: person('staff-a'),
  staffA2: person('staff-a2'),
  primary: person('primary'),
  spouse: person('spouse'),
  authorized: person('authorized'),
  other: person('other'),
  archivedLogin: person('archived'),
  third: person('third'),
  staffGone: person('staff-gone'),
  ownerB: person('owner-b'),
};
const ids = {
  firmA: '',
  firmB: '',
  slugA: `r10p-a-${run}`,
  one: '',
  two: '',
  three: '',
  old: '',
};

let app: INestApplication;
let kmsApp: INestApplication | undefined;
const tokens = new Map<string, string>();
const savedEnv = { KMS_MODE: process.env['KMS_MODE'], LOCAL_KMS_KEY: process.env['LOCAL_KMS_KEY'] };

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

async function firm(
  method: 'get' | 'put' | 'post',
  path: string,
  who: { email: string },
  body?: object,
  businessId = ids.firmA,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business/clients${path}`)
    .set('x-business-id', businessId)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}

async function portal(
  method: 'get' | 'put' | 'patch' | 'post',
  path: string,
  who: { email: string },
  body?: object,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/portal/${ids.slugA}/me/profile${path}`)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res;
};
const inFirm = async <T>(businessId: string, fn: Parameters<typeof runInScope<T>>[2]) => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(owner, { kind: 'business', businessId }, fn);
  } finally {
    await owner.$disconnect();
  }
};

async function buildApp(): Promise<INestApplication> {
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env)],
  }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  return nest;
}

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      const pool = ['primary', 'spouse', 'authorized', 'other', 'archivedLogin', 'third'].includes(
        key,
      )
        ? 'CLIENT'
        : 'STAFF';
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool, email: p.email, name: `Fake R10p ${key}` },
      });
    }
    ids.firmA = (
      await tx.business.create({ data: { slug: ids.slugA, name: 'A', status: 'ACTIVE' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: `r10p-b-${run}`, name: 'B', status: 'ACTIVE' } })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const A = { businessId: ids.firmA };
    for (const [userId, role] of [
      [people.ownerA.id, 'OWNER'],
      [people.staffA.id, 'STAFF'],
      [people.staffA2.id, 'STAFF'],
    ] as const) {
      await tx.membership.create({ data: { ...A, userId, role, status: 'ACTIVE' } });
    }
    await tx.membership.create({
      data: { ...A, userId: people.staffGone.id, role: 'STAFF', status: 'DEACTIVATED' },
    });
    const client = async (displayName: string, extra: object = {}) => {
      const row = await tx.client.create({ data: { ...A, displayName, ...extra } });
      await tx.clientProfile.create({ data: { ...A, clientId: row.id } });
      return row.id;
    };
    ids.one = await client('One', { assignedUserId: people.staffA.id, phone: '+15555550101' });
    ids.two = await client('Two');
    ids.three = await client('Three', { assignedUserId: people.staffGone.id });
    ids.old = await client('Old', { archivedAt: new Date() });
    for (const [p, clientId, portalRole] of [
      [people.primary, ids.one, 'PRIMARY'],
      [people.spouse, ids.one, 'SPOUSE'],
      [people.authorized, ids.one, 'AUTHORIZED'],
      [people.other, ids.two, 'PRIMARY'],
      [people.archivedLogin, ids.old, 'PRIMARY'],
      [people.third, ids.three, 'PRIMARY'],
    ] as const) {
      await tx.clientAccount.create({
        data: { ...A, userId: p.id, clientId, email: p.email, portalRole, status: 'ACTIVE' },
      });
    }
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, (tx) =>
    tx.membership.create({
      data: { businessId: ids.firmB, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    }),
  );
  await owner.$disconnect();

  // Local mode, with a key of this file's own (CI has no .env).
  process.env['KMS_MODE'] = 'local';
  process.env['LOCAL_KMS_KEY'] = randomBytes(32).toString('base64');
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await kmsApp?.close();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('firm: the profile with SSN, EIN and date of birth', () => {
  it('stores them only encrypted and returns the last 4 digits and the date of birth', async () => {
    const res = ok(
      await firm('put', `/${ids.one}/profile`, people.ownerA, {
        firstName: 'Fake',
        lastName: 'Person',
        ssn: SSN,
        ein: EIN,
        dateOfBirth: DOB,
      }),
    );
    expect(Profile.parse(res.body)).toMatchObject({
      firstName: 'Fake',
      ssnLast4: '3456',
      einLast4: '4321',
      dateOfBirth: DOB,
    });
    const row = await inFirm(ids.firmA, (tx) =>
      tx.clientProfile.findUniqueOrThrow({ where: { clientId: ids.one } }),
    );
    for (const [blob, plain] of [
      [row.ssnEnc, '900123456'],
      [row.einEnc, '987654321'],
      [row.dobEnc, DOB],
    ] as const) {
      expect(blob).not.toBeNull();
      expect(Buffer.from(blob!).includes(Buffer.from(plain))).toBe(false);
    }
    const record = ok(await firm('get', `/${ids.one}`, people.ownerA)).body as {
      profile: unknown;
    };
    expect(Profile.parse(record.profile)).toMatchObject({ dateOfBirth: DOB, ssnLast4: '3456' });
  });

  it('a value left out is kept, "" clears it with its last 4', async () => {
    ok(await firm('put', `/${ids.two}/profile`, people.ownerA, { ssn: SSN, dateOfBirth: DOB }));
    const kept = Profile.parse(
      ok(await firm('put', `/${ids.two}/profile`, people.ownerA, { firstName: 'Two' })).body,
    );
    expect([kept.ssnLast4, kept.dateOfBirth]).toEqual(['3456', DOB]);
    const cleared = Profile.parse(
      ok(await firm('put', `/${ids.two}/profile`, people.ownerA, { ssn: '', dateOfBirth: '' }))
        .body,
    );
    expect([cleared.ssnLast4, cleared.dateOfBirth]).toEqual([null, null]);
    const row = await inFirm(ids.firmA, (tx) =>
      tx.clientProfile.findUniqueOrThrow({ where: { clientId: ids.two } }),
    );
    expect([row.ssnEnc, row.dobEnc]).toEqual([null, null]);
  });

  it('a new client can carry them from the start', async () => {
    const res = ok(
      await firm('post', '', people.ownerA, {
        displayName: `New ${run}`,
        profile: { ssn: SSN, dateOfBirth: DOB },
      }),
      201,
    );
    const body = res.body as { profile: unknown };
    expect(Profile.parse(body.profile)).toMatchObject({ ssnLast4: '3456', dateOfBirth: DOB });
  });

  it('Staff reach only their own clients; another firm, an archived client and bad input are refused', async () => {
    ok(await firm('put', `/${ids.one}/profile`, people.staffA, { preferredName: 'F' }));
    const cases: [Response, number, string][] = [
      [await firm('put', `/${ids.one}/profile`, people.staffA2, { ssn: SSN }), 404, 'NOT_FOUND'],
      [
        await firm('put', `/${ids.one}/profile`, people.ownerB, { ssn: SSN }, ids.firmB),
        404,
        'NOT_FOUND',
      ],
      [
        await firm('put', `/${ids.old}/profile`, people.ownerA, { ssn: SSN }),
        409,
        'CLIENT_ARCHIVED',
      ],
      [
        await firm('put', `/${ids.one}/profile`, people.ownerA, { ssn: '123' }),
        400,
        'VALIDATION_FAILED',
      ],
      [
        await firm('put', `/${ids.one}/profile`, people.ownerA, { dateOfBirth: '2999-01-01' }),
        400,
        'VALIDATION_FAILED',
      ],
      [
        await firm('put', `/${ids.one}/profile`, people.ownerA, { dateOfBirth: '1899-12-31' }),
        400,
        'VALIDATION_FAILED',
      ],
      [await firm('put', `/${ids.one}/profile`, people.ownerA, {}), 400, 'VALIDATION_FAILED'],
      [await firm('put', `/${ids.one}/profile`, people.primary, { ssn: SSN }), 403, 'FORBIDDEN'],
    ];
    for (const [res, status, code] of cases)
      expect([res.status, codeOf(res)]).toEqual([status, code]);
  });

  it('with AWS KMS and no key for the firm yet: 503 ENCRYPTION_UNAVAILABLE, nothing saved', async () => {
    process.env['KMS_MODE'] = 'kms';
    kmsApp = await buildApp();
    process.env['KMS_MODE'] = 'local';
    const login = await request(kmsApp.getHttpServer())
      .post('/api/v1/dev/token')
      .send({ email: people.ownerA.email })
      .expect(200);
    const res = await request(kmsApp.getHttpServer())
      .put(`/api/v1/business/clients/${ids.two}/profile`)
      .set('x-business-id', ids.firmA)
      .set('authorization', `Bearer ${(login.body as { token: string }).token}`)
      .send({ ssn: SSN });
    expect([res.status, codeOf(res)]).toEqual([503, 'ENCRYPTION_UNAVAILABLE']);
    const row = await inFirm(ids.firmA, (tx) =>
      tx.clientProfile.findUniqueOrThrow({ where: { clientId: ids.two } }),
    );
    expect(row.ssnLast4).toBeNull();
  });
});

describe('portal: My Profile', () => {
  it('the primary login sees the date of birth; a spouse does not; each sees only their record', async () => {
    const primary = Mine.parse(ok(await portal('get', '', people.primary)).body);
    expect(primary).toMatchObject({
      portalRole: 'PRIMARY',
      fullName: 'Fake Person',
      dateOfBirth: DOB,
      email: people.primary.email,
      phone: '+15555550101',
    });
    const spouse = Mine.parse(ok(await portal('get', '', people.spouse)).body);
    expect(spouse).toMatchObject({
      portalRole: 'SPOUSE',
      fullName: 'Fake Person',
      dateOfBirth: null,
    });
    const other = Mine.parse(ok(await portal('get', '', people.other)).body);
    expect(other.fullName).toBe('Two');
    expect((await portal('get', '', people.ownerA)).status).toBe(401);
  });

  it('the primary login edits phone, address and additional information; nobody else changes it', async () => {
    const res = ok(
      await portal('patch', '', people.primary, {
        phone: '+15555550199',
        address: {
          line1: '1 Sample St',
          line2: '',
          city: 'Springfield',
          state: 'GA',
          postalCode: '30000',
          country: 'US',
        },
        referralSource: 'A friend',
      }),
    );
    expect(Mine.parse(res.body)).toMatchObject({
      phone: '+15555550199',
      address: { line1: '1 Sample St', city: 'Springfield' },
      referralSource: 'A friend',
      dateOfBirth: DOB,
    });
    const spouse = await portal('patch', '', people.spouse, { referralSource: 'x' });
    expect([spouse.status, codeOf(spouse)]).toEqual([403, 'FORBIDDEN']);
    const old = await portal('patch', '', people.archivedLogin, { referralSource: 'x' });
    expect([old.status, codeOf(old)]).toEqual([409, 'CLIENT_ARCHIVED']);
    for (const body of [{ firstName: 'New' }, { dateOfBirth: DOB }, { ssn: SSN }, {}]) {
      const bad = await portal('patch', '', people.primary, body);
      expect([bad.status, codeOf(bad)]).toEqual([400, 'VALIDATION_FAILED']);
    }
  });

  it('an AUTHORIZED login sees the name only (q21) and changes nothing', async () => {
    const seen = Mine.parse(ok(await portal('get', '', people.authorized)).body);
    expect(seen).toEqual({
      portalRole: 'AUTHORIZED',
      fullName: 'Fake Person',
      dateOfBirth: null,
      email: people.authorized.email,
      phone: null,
      address: {
        line1: null,
        line2: null,
        city: null,
        state: null,
        postalCode: null,
        country: 'US',
      },
      preferredContactMethod: null,
      referralSource: null,
      additionalInfo: null,
    });
    const change = await portal('patch', '', people.authorized, { referralSource: 'x' });
    expect([change.status, codeOf(change)]).toEqual([403, 'FORBIDDEN']);
    // A spouse still sees the contact details (only the date of birth is the primary's).
    const spouse = Mine.parse(ok(await portal('get', '', people.spouse)).body);
    expect(spouse).toMatchObject({ phone: '+15555550199', referralSource: 'A friend' });
  });

  it('the contract client saves through PATCH; PUT is not a route', async () => {
    const api = createMyProfileClient(
      createRequest({
        baseUrl: `${await app.getUrl()}/api/v1`,
        token: await tokenFor(people.primary.email),
        fetch,
      }),
      ids.slugA,
    );
    expect(await api.update({ referralSource: 'Through the contract' })).toMatchObject({
      referralSource: 'Through the contract',
      dateOfBirth: DOB,
    });
    const put = await portal('put', '', people.primary, { referralSource: 'x' });
    expect(put.status).toBe(404);
  });

  it('a name change request is a task for the assigned staff member, one open at a time', async () => {
    ok(
      await portal('post', '/name-change', people.primary, {
        newName: 'Fake Renamed',
        reason: 'Married',
      }),
    );
    const tasks = await inFirm(ids.firmA, (tx) =>
      tx.task.findMany({ where: { clientId: ids.one, kind: 'NAME_CHANGE' } }),
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ status: 'OPEN', assignedUserId: people.staffA.id });
    expect(tasks[0]!.details).toContain('Fake Renamed');
    const again = await portal('post', '/name-change', people.primary, { newName: 'Again' });
    expect([again.status, codeOf(again)]).toEqual([409, 'NAME_CHANGE_PENDING']);
    const spouse = await portal('post', '/name-change', people.spouse, { newName: 'X' });
    expect([spouse.status, codeOf(spouse)]).toEqual([403, 'FORBIDDEN']);
  });

  it('with the assignee no longer an active member, the name change task has no assignee', async () => {
    ok(await portal('post', '/name-change', people.third, { newName: 'Fake Third' }));
    const tasks = await inFirm(ids.firmA, (tx) =>
      tx.task.findMany({ where: { clientId: ids.three, kind: 'NAME_CHANGE' } }),
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ status: 'OPEN', assignedUserId: null });
  });
});

describe('audit', () => {
  it('logs every read and change with field names, never a value', async () => {
    const rows = await inFirm(ids.firmA, (tx) =>
      tx.auditLog.findMany({
        where: { businessId: ids.firmA, entityId: { in: [ids.one, ids.two] } },
      }),
    );
    const actions = new Set(rows.map((r) => r.action));
    for (const action of [
      'client.profile_updated',
      'client.viewed',
      'portal.profile_viewed',
      'portal.profile_updated',
      'portal.name_change_requested',
    ]) {
      expect(actions.has(action), action).toBe(true);
    }
    const all = JSON.stringify(rows.map((r) => r.metadata));
    for (const secret of ['900123456', SSN, '987654321', EIN, DOB, 'Fake Renamed', 'Married']) {
      expect(all).not.toContain(secret);
    }
    expect(
      rows
        .filter((r) => r.action === 'client.profile_updated' && r.entityId === ids.one)
        .map((r) => r.metadata),
    ).toContainEqual({ fields: ['dateOfBirth', 'ein', 'firstName', 'lastName', 'ssn'] });
  });
});
