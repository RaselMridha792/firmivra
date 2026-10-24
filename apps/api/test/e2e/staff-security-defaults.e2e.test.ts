// End-to-end: R60, Staff Settings > New Accounts & Security (Octavia's SM3; contract in
// packages/types/src/staff/security-defaults.ts, table staff_security_defaults from R1's #1074).
// The firm's defaults for new staff accounts: Owner and Admin read and save them; a new account
// starts from them (step 3's choices win); no existing account changes; firm B has its own. The
// audit row names the changed settings, never a value.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { StaffSecurityDefaults } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r60sd-${key}-${run}@r60.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  managerA: person('manager-a'),
  staffA: person('staff-a'),
  invitedA: person('invited-a'),
  ownerB: person('owner-b'),
};
type Who = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', string>;
const member = {} as Record<keyof typeof people, string>;

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.60.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

async function asOwner<T>(
  scope: Parameters<typeof runInScope>[1],
  work: Parameters<typeof runInScope<T>>[2],
): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(owner, scope, work);
  } finally {
    await owner.$disconnect();
  }
}
const inFirm = <T>(firm: 'a' | 'b', work: Parameters<typeof runInScope<T>>[2]) =>
  asOwner({ kind: 'business', businessId: firms[firm] }, work);

async function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .set('x-forwarded-for', viewer())
    .send({ email })
    .expect(200);
  const token = (res.body as { token: string }).token;
  tokens.set(email, token);
  return token;
}

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';
async function call(
  method: Method,
  path: string,
  who: Who | undefined,
  body?: object,
  firm: 'a' | 'b' = 'a',
): Promise<Response> {
  let req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', firms[firm])
    .set('x-forwarded-for', viewer());
  if (who) req = req.set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};
const { ownerA, adminA, managerA, staffA, ownerB } = people;

const auditRows = (entityId: string) =>
  inFirm('a', (tx) =>
    tx.auditLog.findMany({
      where: { entityId },
      select: { action: true, metadata: true },
      orderBy: { createdAt: 'asc' },
    }),
  );

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: 'STAFF',
          email: p.email,
          name: `Fake R60sd ${key}`,
        },
      });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r60sd-${key}-${run}`;
      firms[key] = (
        await tx.business.create({
          data: { slug, name: `Firm ${slug}`, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
    }
  });
  for (const [firm, key, role, status] of [
    ['a', 'ownerA', 'OWNER', 'ACTIVE'],
    ['a', 'adminA', 'ADMIN', 'ACTIVE'],
    ['a', 'managerA', 'MANAGER', 'ACTIVE'],
    ['a', 'staffA', 'STAFF', 'ACTIVE'],
    ['a', 'invitedA', 'STAFF', 'INVITED'],
    ['b', 'ownerB', 'OWNER', 'ACTIVE'],
  ] as const) {
    member[key] = (
      await inFirm(firm, (tx) =>
        tx.membership.create({
          data: {
            businessId: firms[firm],
            userId: people[key].id,
            role,
            status,
            jobTitle: `Title ${key}`,
          },
          select: { id: true },
        }),
      )
    ).id;
  }
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

afterAll(async () => {
  await app.close();
});

const DEFAULTS = '/staff-security-defaults';
const get = async (who: Who = ownerA, firm: 'a' | 'b' = 'a') =>
  StaffSecurityDefaults.parse(ok(await call('get', DEFAULTS, who, undefined, firm)));
const settings = (over: object = {}) => ({
  allowedAuthMethods: ['AUTHENTICATOR_APP', 'EMAIL'],
  restrictDevices: true,
  autoLogoutMinutes: 60,
  accessLocation: 'ALLOWED_COUNTRIES',
  allowedIps: [],
  allowedCountries: ['US', 'CA'],
  maxConcurrentSessions: 2,
  signOutOtherSessions: true,
  allowTrustedDevices: true,
  notices: {
    newDeviceLogin: true,
    failedLogins: true,
    passwordChanges: false,
    securityAlerts: true,
    lockouts: true,
  },
  ...over,
});
let department = '';
const securityOf = (email: string) =>
  inFirm('a', async (tx) => {
    const m = await tx.membership.findFirstOrThrow({
      where: { businessId: firms.a, user: { email } },
      select: { id: true },
    });
    return tx.staffSecuritySettings.findUniqueOrThrow({
      where: { businessId_membershipId: { businessId: firms.a, membershipId: m.id } },
    });
  });
const createStaff = async (key: string, access?: object) => {
  const email = `r60sd-new-${key}-${run}@r60.test`;
  ok(
    await call('post', '/staff', ownerA, {
      idempotencyKey: randomUUID(),
      account: {
        firstName: 'Fake',
        lastName: `Hire ${key}`,
        email,
        departmentIds: [department],
        jobTitle: 'Tax Preparer',
        role: 'TAX_PREPARER',
      },
      ...(access ? { access } : {}),
      sendWelcomeEmail: false,
    }),
    201,
  );
  return email;
};

beforeAll(async () => {
  department = await inFirm('a', (tx) =>
    tx.department
      .create({ data: { businessId: firms.a, name: `Tax ${run}` }, select: { id: true } })
      .then((d) => d.id),
  );
});

describe('security defaults for new staff accounts', () => {
  it("answers Firmivra's defaults until the firm saves, the same as a new row's", async () => {
    const d = await get();
    expect(d).toMatchObject({
      allowedAuthMethods: ['AUTHENTICATOR_APP', 'BACKUP_CODES'],
      restrictDevices: false,
      autoLogoutMinutes: null,
      accessLocation: 'ANYWHERE',
      allowedIps: [],
      allowedCountries: [],
      maxConcurrentSessions: 1,
      signOutOtherSessions: false,
      allowTrustedDevices: false,
      notices: {
        newDeviceLogin: true,
        failedLogins: true,
        passwordChanges: true,
        securityAlerts: true,
        lockouts: true,
      },
      existingAccounts: 5,
      updatedAt: null,
      updatedBy: null,
      version: 'none',
    });
    // The table's own defaults say the same (the API's copy must not drift from them).
    const row = await inFirm('b', async (tx) => {
      const made = await tx.staffSecurityDefaults.create({ data: { businessId: firms.b } });
      await tx.staffSecurityDefaults.delete({ where: { businessId: firms.b } });
      return made;
    });
    expect({
      allowedAuthMethods: row.allowedAuthMethods,
      restrictDevices: row.restrictDevices,
      autoLogoutMinutes: row.autoLogoutMinutes,
      accessLocation: row.accessLocation,
      allowedIps: row.allowedIps,
      allowedCountries: row.allowedCountries,
      maxConcurrentSessions: row.maxConcurrentSessions,
      signOutOtherSessions: row.signOutOtherSessions,
      allowTrustedDevices: row.allowTrustedDevices,
      notices: {
        newDeviceLogin: row.notifyNewDeviceLogin,
        failedLogins: row.notifyFailedLogins,
        passwordChanges: row.notifyPasswordChanges,
        securityAlerts: row.notifySecurityAlerts,
        lockouts: row.notifyLockouts,
      },
    }).toEqual({
      allowedAuthMethods: d.allowedAuthMethods,
      restrictDevices: d.restrictDevices,
      autoLogoutMinutes: d.autoLogoutMinutes,
      accessLocation: d.accessLocation,
      allowedIps: d.allowedIps,
      allowedCountries: d.allowedCountries,
      maxConcurrentSessions: d.maxConcurrentSessions,
      signOutOtherSessions: d.signOutOtherSessions,
      allowTrustedDevices: d.allowTrustedDevices,
      notices: d.notices,
    });
  });

  it('saves, names who saved, and refuses a save made from an older version', async () => {
    const before = await get();
    // An existing account with settings of its own.
    await inFirm('a', (tx) =>
      tx.staffSecuritySettings.create({
        data: { businessId: firms.a, membershipId: member.staffA, maxConcurrentSessions: 3 },
      }),
    );
    const existing = await securityOf(people.staffA.email);
    const saved = StaffSecurityDefaults.parse(
      ok(await call('put', DEFAULTS, adminA, { version: before.version, ...settings() })),
    );
    expect(saved).toMatchObject({
      ...settings(),
      updatedBy: 'Fake R60sd adminA',
    });
    expect(saved.updatedAt).not.toBeNull();
    expect(await get()).toEqual(saved);
    expectError(
      await call('put', DEFAULTS, ownerA, { version: before.version, ...settings() }),
      409,
      'SAVE_CONFLICT',
    );
    // No existing account changed.
    expect(await securityOf(people.staffA.email)).toEqual(existing);
    const audit = await auditRows(firms.a);
    const last = audit.filter((r) => r.action === 'staff_security_defaults.updated').at(-1);
    expect((last?.metadata as { changed?: string[] }).changed?.sort()).toEqual(
      [
        'allowedAuthMethods',
        'restrictDevices',
        'autoLogoutMinutes',
        'accessLocation',
        'allowedCountries',
        'maxConcurrentSessions',
        'signOutOtherSessions',
        'allowTrustedDevices',
        'notifyPasswordChanges',
      ].sort(),
    );
    expect(JSON.stringify(last)).not.toContain('"US"');
  });

  it("starts a new account from the firm's defaults, and step 3's choices win", async () => {
    const plain = await securityOf(await createStaff('plain'));
    expect(plain).toMatchObject({
      allowedAuthMethods: ['AUTHENTICATOR_APP', 'EMAIL'],
      restrictDevices: true,
      autoLogoutMinutes: 60,
      accessLocation: 'ALLOWED_COUNTRIES',
      allowedCountries: ['US', 'CA'],
      maxConcurrentSessions: 2,
      signOutOtherSessions: true,
      allowTrustedDevices: true,
      notifyPasswordChanges: false,
    });
    const chosen = await securityOf(
      await createStaff('chosen', {
        accessLocation: 'ANYWHERE',
        allowedCountries: [],
        maxConcurrentSessions: 4,
      }),
    );
    expect(chosen).toMatchObject({
      accessLocation: 'ANYWHERE',
      allowedCountries: [],
      maxConcurrentSessions: 4,
      // The rest still comes from the defaults.
      autoLogoutMinutes: 60,
      allowTrustedDevices: true,
    });
  });

  it('checks the settings: the lists go with their access choice, at least one method', async () => {
    const { version } = await get();
    for (const [over, path] of [
      [{ allowedAuthMethods: [] }, 'allowedAuthMethods'],
      [{ allowedAuthMethods: ['EMAIL', 'EMAIL'] }, 'allowedAuthMethods'],
      [{ accessLocation: 'ALLOWED_IPS', allowedCountries: [] }, 'allowedIps'],
      [{ accessLocation: 'ANYWHERE' }, 'allowedCountries'],
      [{ allowedCountries: ['USA'] }, 'allowedCountries.0'],
      [{ autoLogoutMinutes: 2 }, 'autoLogoutMinutes'],
      [{ maxConcurrentSessions: 11 }, 'maxConcurrentSessions'],
    ] as const) {
      const res = await call('put', DEFAULTS, ownerA, { version, ...settings(over) });
      expectError(res, 400, 'VALIDATION_FAILED');
      expect(JSON.stringify(res.body)).toContain(path);
    }
    const ips = StaffSecurityDefaults.parse(
      ok(
        await call('put', DEFAULTS, ownerA, {
          version,
          ...settings({
            accessLocation: 'ALLOWED_IPS',
            allowedCountries: [],
            allowedIps: ['203.0.113.10', '198.51.100.0/24'],
          }),
        }),
      ),
    );
    expect(ips.allowedIps).toEqual(['203.0.113.10', '198.51.100.0/24']);
  });

  it('is for the Owner and the Admin only', async () => {
    const { version } = await get();
    for (const who of [managerA, staffA]) {
      expect((await call('get', DEFAULTS, who)).status).toBe(403);
      expect((await call('put', DEFAULTS, who, { version, ...settings() })).status).toBe(403);
    }
    expect((await call('get', DEFAULTS, undefined)).status).toBe(401);
  });

  it("keeps each firm's defaults its own", async () => {
    const b = await get(ownerB, 'b');
    expect(b).toMatchObject({ accessLocation: 'ANYWHERE', updatedAt: null, existingAccounts: 1 });
    const saved = StaffSecurityDefaults.parse(
      ok(
        await call(
          'put',
          DEFAULTS,
          ownerB,
          { version: b.version, ...settings({ maxConcurrentSessions: 7 }) },
          'b',
        ),
      ),
    );
    expect(saved.maxConcurrentSessions).toBe(7);
    expect((await get()).maxConcurrentSessions).not.toBe(7);
  });
});
