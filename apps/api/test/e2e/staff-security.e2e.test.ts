// End-to-end: R55, Staff Account Access & Security (contract in packages/types/src/staff): the
// sign-in rules, Active Sessions, Login History, activity, and the password and MFA resets.
// Owner and Admin; a change needs a role the actor manages; firm B reaches none of firm A's.
import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  StaffActionResult,
  StaffActivityPage,
  StaffLoginHistory,
  StaffSecurity,
  StaffSessionList,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55x-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  admin2A: person('admin2-a'),
  staffA: person('staff-a'),
  managerA: person('manager-a'),
  invitedA: person('invited-a'),
  ownerB: person('owner-b'),
};
type Who = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', string>;

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.64.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

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

type Method = 'get' | 'post' | 'put';
async function call(
  method: Method,
  path: string,
  who: Who,
  body?: object,
  firm: 'a' | 'b' = 'a',
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', firms[firm])
    .set('x-forwarded-for', viewer())
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};
const { ownerA, adminA, staffA, ownerB } = people;
const member = {} as Record<keyof typeof people, string>;
const session = {} as Record<'recent' | 'old' | 'gone' | 'manager', string>;

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people))
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: 'STAFF',
          email: p.email,
          name: `Fake R55x ${key}`,
        },
      });
    for (const key of ['a', 'b'] as const) {
      const slug = `r55x-${key}-${run}`;
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
    ['a', 'admin2A', 'ADMIN', 'ACTIVE'],
    ['a', 'staffA', 'STAFF', 'ACTIVE'],
    ['a', 'managerA', 'MANAGER', 'ACTIVE'],
    ['a', 'invitedA', 'STAFF', 'INVITED'],
    ['b', 'ownerB', 'OWNER', 'ACTIVE'],
  ] as const) {
    member[key] = (
      await inFirm(firm, (tx) =>
        tx.membership.create({
          data: { businessId: firms[firm], userId: people[key].id, role, status },
          select: { id: true },
        }),
      )
    ).id;
  }
  await inFirm('a', async (tx) => {
    const businessId = firms.a;
    const add = (key: keyof typeof session, membershipId: string, lastActiveAt: Date) =>
      tx.staffSession
        .create({
          data: {
            businessId,
            membershipId,
            tokenHash: createHash('sha256').update(`${key}-${run}`).digest('hex'),
            device: `Chrome on macOS ${key}`,
            ip: '203.0.113.7',
            lastActiveAt,
          },
          select: { id: true },
        })
        .then((s) => (session[key] = s.id));
    await add('recent', member.staffA, new Date());
    await add('old', member.staffA, new Date(Date.now() - 10 * 86_400_000));
    await add('gone', member.staffA, new Date());
    await tx.staffSession.update({ where: { id: session.gone }, data: { revokedAt: new Date() } });
    await add('manager', member.managerA, new Date());
    // Sign-in rows in the firm's log, and a change made to staffA by the owner.
    for (const action of [
      'auth.signed_in',
      'auth.sign_in_failed',
      'auth.signed_in',
      'auth.signed_in',
    ])
      await tx.auditLog.create({
        data: {
          businessId,
          actorUserId: staffA.id,
          action,
          entityType: 'user',
          entityId: staffA.id,
          ip: '203.0.113.9',
          userAgent: 'Fake browser',
        },
      });
    await tx.auditLog.create({
      data: {
        businessId,
        actorUserId: people.ownerA.id,
        action: 'membership.role_changed',
        entityType: 'membership',
        entityId: member.staffA,
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

afterAll(async () => {
  await app.close();
});

describe('sign-in rules', () => {
  it("shows the defaults before anything is saved, and saves the Owner's changes", async () => {
    const before = StaffSecurity.parse(
      ok(await call('get', `/staff/${member.managerA}/security`, adminA)),
    );
    expect(before).toMatchObject({
      status: 'ACTIVE',
      role: 'MANAGER',
      mfaRequired: true,
      accessLocation: 'ANYWHERE',
      maxConcurrentSessions: 1,
      requirePasswordChange: true,
      notices: { lockouts: true },
    });
    const saved = StaffSecurity.parse(
      ok(
        await call('put', `/staff/${member.managerA}/security`, adminA, {
          autoLogoutMinutes: 30,
          accessLocation: 'ALLOWED_IPS',
          allowedIps: ['203.0.113.0/24'],
          disableOn: '2027-01-31',
          recoveryEmail: `r55x-recovery-${run}@r55.test`,
          notices: {
            newDeviceLogin: false,
            failedLogins: true,
            passwordChanges: true,
            securityAlerts: true,
            lockouts: false,
          },
        }),
      ),
    );
    expect(saved).toMatchObject({
      autoLogoutMinutes: 30,
      accessLocation: 'ALLOWED_IPS',
      allowedIps: ['203.0.113.0/24'],
      disableOn: '2027-01-31',
      recoveryEmailVerified: false,
      notices: { newDeviceLogin: false, lockouts: false },
    });
    const audit = await inFirm('a', (tx) =>
      tx.auditLog.findFirstOrThrow({
        where: { businessId: firms.a, entityId: member.managerA, action: 'staff.security_saved' },
      }),
    );
    expect(JSON.stringify(audit.metadata)).not.toContain('203.0.113');
    expect(JSON.stringify(audit.metadata)).not.toContain(`r55x-recovery-${run}`);
  });

  it('refuses a location rule with an empty list', async () => {
    expectError(
      await call('put', `/staff/${member.staffA}/security`, ownerA, {
        accessLocation: 'ALLOWED_COUNTRIES',
      }),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('never changes yourself or another Admin, and is not for Staff', async () => {
    expectError(
      await call('put', `/staff/${member.adminA}/security`, adminA, { autoLogoutMinutes: 10 }),
      409,
      'CANNOT_CHANGE_SELF',
    );
    expectError(
      await call('put', `/staff/${member.admin2A}/security`, adminA, { autoLogoutMinutes: 10 }),
      403,
      'FORBIDDEN',
    );
    expectError(await call('get', `/staff/${member.managerA}/security`, staffA), 403, 'FORBIDDEN');
  });
});

describe('Active Sessions', () => {
  it('lists the open sessions of the last 7 days', async () => {
    const list = StaffSessionList.parse(
      ok(await call('get', `/staff/${member.staffA}/sessions`, ownerA)),
    );
    expect(list.items.map((s) => s.id)).toEqual([session.recent]);
    expect(list.items[0]).toMatchObject({ activeNow: true, ip: '203.0.113.7' });
  });

  it("signs one out (harmless to repeat), and never another member's", async () => {
    const path = `/staff/${member.staffA}/sessions/${session.recent}/revoke`;
    expect(StaffActionResult.parse(ok(await call('post', path, adminA))).sessionsRevoked).toBe(1);
    expect(StaffActionResult.parse(ok(await call('post', path, adminA))).sessionsRevoked).toBe(0);
    expectError(
      await call('post', `/staff/${member.staffA}/sessions/${session.manager}/revoke`, adminA),
      404,
      'NOT_FOUND',
    );
  });

  it('signs all out, with the confirm', async () => {
    expectError(
      await call('post', `/staff/${member.managerA}/sessions/revoke-all`, ownerA, {}),
      400,
      'VALIDATION_FAILED',
    );
    const all = StaffActionResult.parse(
      ok(
        await call('post', `/staff/${member.managerA}/sessions/revoke-all`, ownerA, {
          reason: 'Lost laptop',
          confirm: true,
        }),
      ),
    );
    expect(all).toMatchObject({ status: 'ACTIVE', sessionsRevoked: 1 });
  });
});

describe('Login History and activity', () => {
  it('pages the sign-in attempts, newest first', async () => {
    const first = StaffLoginHistory.parse(
      ok(await call('get', `/staff/${member.staffA}/login-history?limit=3`, ownerA)),
    );
    expect(first.items.map((i) => i.outcome)).toEqual(['SUCCESS', 'SUCCESS', 'FAILED']);
    expect(first.items[0]).toMatchObject({
      ip: '203.0.113.9',
      device: 'Fake browser',
      place: null,
    });
    const next = StaffLoginHistory.parse(
      ok(
        await call(
          'get',
          `/staff/${member.staffA}/login-history?limit=3&cursor=${first.nextCursor}`,
          ownerA,
        ),
      ),
    );
    expect(next.items.map((i) => i.outcome)).toEqual(['SUCCESS']);
    expect(next.nextCursor).toBeNull();
    expectError(
      await call('get', `/staff/${member.staffA}/login-history?cursor=not-a-cursor`, ownerA),
      400,
      'VALIDATION_FAILED',
    );
  });

  it("shows what the member did and what was done to them, with the other person's name", async () => {
    const page = StaffActivityPage.parse(
      ok(await call('get', `/staff/${member.staffA}/activity`, ownerA)),
    );
    const changed = page.items.find((i) => i.action === 'membership.role_changed');
    expect(changed).toMatchObject({ label: 'Role changed', actorName: 'Fake R55x ownerA' });
    const signedIn = page.items.find((i) => i.action === 'auth.signed_in');
    expect(signedIn).toMatchObject({ label: 'Logged in', actorName: null });
  });
});

describe('resets', () => {
  it('sends a password reset to someone who can sign in, never to an invitee', async () => {
    const res = StaffActionResult.parse(
      ok(await call('post', `/staff/${member.staffA}/reset-password`, adminA, { confirm: true })),
    );
    expect(res.status).toBe('ACTIVE');
    const settings = await inFirm('a', (tx) =>
      tx.staffSecuritySettings.findUniqueOrThrow({
        where: { businessId_membershipId: { businessId: firms.a, membershipId: member.staffA } },
      }),
    );
    expect(settings.requirePasswordChange).toBe(true);
    expectError(
      await call('post', `/staff/${member.invitedA}/reset-password`, adminA, { confirm: true }),
      409,
      'NOT_ACTIVE',
    );
  });

  it('resets MFA and signs the sessions out', async () => {
    const res = StaffActionResult.parse(
      ok(
        await call('post', `/staff/${member.staffA}/reset-mfa`, ownerA, {
          reason: 'New phone',
          confirm: true,
        }),
      ),
    );
    expect(res.status).toBe('ACTIVE');
    const audit = await inFirm('a', (tx) =>
      tx.auditLog.findFirstOrThrow({
        where: { businessId: firms.a, entityId: member.staffA, action: 'staff.mfa_reset' },
      }),
    );
    expect(audit.metadata).toMatchObject({ reasonGiven: true });
    expect(JSON.stringify(audit.metadata)).not.toContain('New phone');
  });
});

describe('firm B', () => {
  it("reaches none of firm A's members or sessions", async () => {
    for (const [method, path, body] of [
      ['get', `/staff/${member.staffA}/security`, undefined],
      ['put', `/staff/${member.staffA}/security`, { autoLogoutMinutes: 10 }],
      ['get', `/staff/${member.staffA}/sessions`, undefined],
      ['post', `/staff/${member.staffA}/sessions/${session.old}/revoke`, undefined],
      ['post', `/staff/${member.staffA}/sessions/revoke-all`, { confirm: true }],
      ['get', `/staff/${member.staffA}/login-history`, undefined],
      ['get', `/staff/${member.staffA}/activity`, undefined],
      ['post', `/staff/${member.staffA}/reset-password`, { confirm: true }],
      ['post', `/staff/${member.staffA}/reset-mfa`, { confirm: true }],
    ] as const)
      expectError(await call(method, path, ownerB, body, 'b'), 404, 'NOT_FOUND');
  });
});
