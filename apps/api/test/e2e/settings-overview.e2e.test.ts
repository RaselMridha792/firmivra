// End-to-end: GET /business/settings/overview (R42 contract with R1's location fields): staff
// users and those who joined this month, security alerts over 7 days (lockouts, failed sign-in
// bursts, MFA resets), the 5 newest administrative events, active locations, the plan's usage and
// the first 5 locations (primary first). Owner and Admin only; only the firm's own numbers; the
// platform's fields are left out. Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { LocationProfile, SettingsOverview } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { TokenService } from '../../src/auth/token.service.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
interface Person {
  id: string;
  email: string;
  key: string;
}
const person = (key: string): Person => ({
  id: randomUUID(),
  email: `r1o-${key.toLowerCase()}-${run}@r1.test`,
  key,
});
const people = {
  ownerA: person('ownerA'),
  adminA: person('adminA'),
  staffA: person('staffA'),
  invitedA: person('invitedA'),
  goneA: person('goneA'),
  ownerB: person('ownerB'),
};
const { ownerA, adminA, staffA, invitedA, goneA, ownerB } = people;
const firms = {} as Record<'a' | 'b', string>;
let app: INestApplication;
let viewers = 0;
const viewer = () => `198.62.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

async function asOwner<T>(
  scope: Parameters<typeof runInScope>[1],
  work: (tx: TxClient) => Promise<T>,
): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(owner, scope, work);
  } finally {
    await owner.$disconnect();
  }
}
const inFirm = <T>(firm: 'a' | 'b', work: (tx: TxClient) => Promise<T>) =>
  asOwner({ kind: 'business', businessId: firms[firm] }, work);

async function call(
  method: 'get' | 'post',
  path: string,
  who: Person,
  body?: object,
  firm: 'a' | 'b' = 'a',
): Promise<Response> {
  const { token } = await app.get(TokenService).signLocal(who.id, 'STAFF');
  const req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', firms[firm])
    .set('x-forwarded-for', viewer())
    .set('authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body);
}
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};
const overview = async (who: Person = ownerA, firm: 'a' | 'b' = 'a') =>
  SettingsOverview.parse(ok(await call('get', '/settings/overview', who, undefined, firm)));
let streets = 0;
const addLocation = async (name: string, over: object = {}) =>
  LocationProfile.parse(
    ok(
      await call('post', '/locations', ownerA, {
        name: `${name} ${run}`,
        addressLine1: `${++streets} Fake Avenue ${run}`,
        city: 'Fake City',
        state: 'CA',
        postalCode: '95603',
        phone: '+15305550100',
        email: 'office@example.test',
        serviceIds: [],
        hours: [],
        staffUserIds: [],
        managerUserId: adminA.id,
        ...over,
      }),
      201,
    ),
  );

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const p of Object.values(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: 'STAFF',
          email: p.email,
          name: `Fake R1O ${p.key}`,
        },
      });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r1o-${key}-${run}`;
      firms[key] = (
        await tx.business.create({
          data: { slug, name: `Fake Firm ${slug}`, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
    }
  });
  for (const [firm, p, role, status] of [
    ['a', ownerA, 'OWNER', 'ACTIVE'],
    ['a', adminA, 'ADMIN', 'ACTIVE'],
    ['a', staffA, 'STAFF', 'ACTIVE'],
    ['a', invitedA, 'STAFF', 'INVITED'],
    ['a', goneA, 'STAFF', 'ACTIVE'],
    ['b', ownerB, 'OWNER', 'ACTIVE'],
  ] as const) {
    await inFirm(firm, (tx) =>
      tx.membership.create({ data: { businessId: firms[firm], userId: p.id, role, status } }),
    );
  }
  await inFirm('a', async (tx) => {
    const businessId = firms.a;
    await tx.membership.updateMany({
      where: { businessId, userId: goneA.id },
      data: { status: 'DEACTIVATED' },
    });
    // The security events of the last 7 days, written as the sign-in and Staff Management code
    // writes them (one transaction: one clock hour).
    const row = (action: string, metadata: object, createdAt?: Date) => ({
      businessId,
      action,
      entityType: 'login',
      metadata,
      ...(createdAt ? { createdAt } : {}),
    });
    const lockedUntil = new Date(Date.now() + 15 * 60_000).toISOString();
    await tx.auditLog.createMany({
      data: [
        // One lockout, written twice by attempts in flight: 1 alert.
        row('auth.locked', { emailKey: 'k-locked', lockedUntil }),
        row('auth.locked', { emailKey: 'k-locked', lockedUntil }),
        // Its failures are the lockout, not a burst of their own.
        ...[1, 2, 3, 4, 5].map(() =>
          row('auth.sign_in_failed', { emailKey: 'k-locked', step: 'password' }),
        ),
        // A burst of 3 for another email: 1 alert.
        ...[1, 2, 3].map(() =>
          row('auth.sign_in_failed', { emailKey: 'k-burst', step: 'password' }),
        ),
        // Two failures are not a burst.
        ...[1, 2].map(() => row('auth.sign_in_failed', { emailKey: 'k-two', step: 'mfa' })),
        // An MFA reset: 1 alert; one 8 days ago: none.
        { businessId, action: 'staff.mfa_reset', entityType: 'membership', metadata: {} },
        {
          businessId,
          action: 'staff.mfa_reset',
          entityType: 'membership',
          metadata: {},
          createdAt: new Date(Date.now() - 8 * 24 * 60 * 60_000),
        },
      ],
    });
  });
  await inFirm('b', (tx) =>
    tx.auditLog.create({
      data: {
        businessId: firms.b,
        action: 'staff.mfa_reset',
        entityType: 'membership',
        metadata: {},
      },
    }),
  );
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
  await app?.close();
});

describe('GET /business/settings/overview', () => {
  it('counts the staff once, those who joined this month, and the week’s security alerts', async () => {
    const o = await overview();
    // Owner, Admin, Staff and the open invite; never the deactivated member.
    expect(o.staffUsers).toEqual({ value: 4, addedThisMonth: 3 });
    expect(o.securityAlerts).toBe(3);
    expect(o.activeLocations).toEqual({ value: 0, addedThisMonth: 0 });
    expect(o.locationAllowance).toEqual({ used: 0, allowed: null });
    expect(o.locations).toEqual([]);
    expect(o).not.toHaveProperty('activeCompanies');
    expect(o).not.toHaveProperty('pendingApplications');
    expect(o).not.toHaveProperty('applications');
  });

  it('shows the active locations, the plan’s usage and the first 5 locations, primary first', async () => {
    const names = [
      'Fake Delta',
      'Fake Alpha',
      'Fake Echo',
      'Fake Charlie',
      'Fake Bravo',
      'Fake Foxtrot',
    ];
    const made: LocationProfile[] = [];
    for (const name of names) made.push(await addLocation(name));
    await addLocation('Fake Golf', { status: 'INACTIVE' });
    const main = made.find((m) => m.name.startsWith('Fake Echo'))!;
    ok(await call('post', `/locations/${main.id}/primary`, adminA));
    const o = await overview(adminA);
    expect(o.activeLocations).toEqual({ value: 6, addedThisMonth: 6 });
    expect(o.locationAllowance).toEqual({ used: 6, allowed: null });
    expect(o.locations?.map((l) => l.name.split(' ').slice(0, 2).join(' '))).toEqual([
      'Fake Echo',
      'Fake Alpha',
      'Fake Bravo',
      'Fake Charlie',
      'Fake Delta',
    ]);
    expect(o.locations?.[0]).toMatchObject({ isMain: true, manager: { userId: adminA.id } });

    expect(o.recentActivity).toHaveLength(5);
    expect(o.recentActivity[0]?.label).toBe(`Primary location set - ${main.name}`);
    expect(o.recentActivity.map((a) => a.action)).not.toContain('settings.overview_viewed');
    // Each view is audited, with no numbers.
    const views = await inFirm('a', (tx) =>
      tx.auditLog.findMany({
        where: { businessId: firms.a, action: 'settings.overview_viewed' },
        select: { metadata: true, entityType: true },
      }),
    );
    expect(views.length).toBeGreaterThanOrEqual(2);
    expect(views.every((v) => v.metadata === null && v.entityType === 'business')).toBe(true);
  });

  it('counts a location activated this month', async () => {
    const before = await overview();
    const spare = await addLocation('Fake Hotel', { status: 'INACTIVE' });
    // Made before this month: only its activation counts as this month's.
    await inFirm('a', (tx) =>
      tx.firmOffice.update({
        where: { id: spare.id },
        data: { createdAt: new Date('2026-01-15T12:00:00.000Z') },
      }),
    );
    ok(await call('post', `/locations/${spare.id}/activate`, ownerA));
    const after = await overview();
    expect(after.activeLocations).toEqual({
      value: before.activeLocations!.value + 1,
      addedThisMonth: before.activeLocations!.addedThisMonth + 1,
    });
  });

  it('is the firm’s own: firm B sees its numbers, and Staff is refused', async () => {
    const b = await overview(ownerB, 'b');
    expect(b.staffUsers).toEqual({ value: 1, addedThisMonth: 1 });
    expect(b.securityAlerts).toBe(1);
    expect(b.locations).toEqual([]);
    expect(JSON.stringify(b)).not.toContain(firms.a);
    const res = await call('get', '/settings/overview', staffA);
    expect([res.status, (res.body as { error?: { code: string } }).error?.code]).toEqual([
      403,
      'FORBIDDEN',
    ]);
  });
});
