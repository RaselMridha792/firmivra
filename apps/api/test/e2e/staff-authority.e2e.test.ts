// End-to-end: R55, SM14, the approved account authority rules with Rasel's default (Nov 7): the
// Original Owner (the firm's first Owner) is changed by nobody else; owner-level access is given
// and taken away by the Original Owner alone; Owner-level acts on everyone else; an Admin acts only
// on the roles below Admin and never resets MFA. On Staff Management and on Settings > Users, and
// the member detail's `authority` says the same. Firm B reaches none of firm A's.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { ROLES_MANAGED_BY, StaffActionResult, StaffDetail } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55y-${key}-${run}@r55.test` });
const people = {
  original: person('original'),
  delegate: person('delegate'),
  delegate2: person('delegate2'),
  promoted: person('promoted'),
  admin: person('admin'),
  admin2: person('admin2'),
  staff: person('staff'),
  staff2: person('staff2'),
  ownerB: person('owner-b'),
};
type Key = keyof typeof people;
type Who = (typeof people)[Key];
const firms = {} as Record<'a' | 'b', string>;
const member = {} as Record<Key, string>;

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.65.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

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

async function call(
  method: 'get' | 'post' | 'patch',
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
const detail = async (who: Who, id: string) =>
  StaffDetail.parse(ok(await call('get', `/staff/${id}`, who)));
const role = async (who: Who, id: string, to: string) =>
  call('patch', `/staff/${id}`, who, {
    version: (await detail(people.original, id)).version,
    account: { role: to },
  });
const sure = { confirm: true };

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people))
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake ${key}` },
      });
    for (const key of ['a', 'b'] as const) {
      const slug = `r55y-${key}-${run}`;
      firms[key] = (
        await tx.business.create({
          data: { slug, name: `Firm ${slug}`, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
    }
  });
  // In the order a firm grows: the Original Owner first (its application), then the others.
  const start = Date.now() - 60 * 60_000;
  let n = 0;
  for (const [firm, key, r] of [
    ['a', 'original', 'OWNER'],
    ['a', 'delegate', 'OWNER'],
    ['a', 'delegate2', 'OWNER'],
    ['a', 'promoted', 'ADMIN'],
    ['a', 'admin', 'ADMIN'],
    ['a', 'admin2', 'ADMIN'],
    ['a', 'staff', 'STAFF'],
    ['a', 'staff2', 'STAFF'],
    ['b', 'ownerB', 'OWNER'],
  ] as const) {
    const businessId = firms[firm];
    member[key] = (
      await asOwner({ kind: 'business', businessId }, (tx) =>
        tx.membership.create({
          data: {
            businessId,
            userId: people[key].id,
            role: r,
            status: 'ACTIVE',
            createdAt: new Date(start + ++n * 60_000),
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

describe('the member detail says what the viewer may do (SM14)', () => {
  it('marks the Original Owner, and gives each viewer the rule’s answer', async () => {
    const { original, delegate, admin } = people;
    // The Original Owner, seen by a delegated Owner and by an Admin: nothing.
    for (const who of [delegate, admin])
      expect((await detail(who, member.original)).authority).toEqual({
        originalOwner: true,
        edit: false,
        changeRole: false,
        resetPassword: false,
        resetMfa: false,
        resendInvitation: false,
        signOutSessions: false,
        lock: false,
        deactivate: false,
        roles: [],
      });
    // Their own record: nothing either (self-service is elsewhere).
    expect((await detail(original, member.original)).authority).toMatchObject({
      originalOwner: true,
      edit: false,
      roles: [],
    });
    // The Original Owner on a delegate: everything, and Owner among the roles.
    expect((await detail(original, member.delegate)).authority).toMatchObject({
      originalOwner: false,
      edit: true,
      changeRole: true,
      resetMfa: true,
      lock: true,
      deactivate: true,
      roles: ['OWNER', ...ROLES_MANAGED_BY.OWNER],
    });
    // A delegate on another delegate: acts, but cannot change the Owner role.
    expect((await detail(delegate, member.delegate2)).authority).toMatchObject({
      edit: true,
      changeRole: false,
      resetMfa: true,
      deactivate: true,
      roles: [],
    });
    // A delegate on an Admin: no Owner to give.
    expect((await detail(delegate, member.admin)).authority).toMatchObject({
      changeRole: true,
      roles: [...ROLES_MANAGED_BY.OWNER],
    });
    // An Admin: Staff, never Reset MFA; another Admin, nothing.
    expect((await detail(admin, member.staff)).authority).toMatchObject({
      edit: true,
      resetMfa: false,
      resetPassword: true,
      lock: true,
      roles: [...ROLES_MANAGED_BY.ADMIN],
    });
    expect((await detail(admin, member.admin2)).authority).toMatchObject({
      edit: false,
      lock: false,
      deactivate: false,
    });
  });
});

describe('nobody else changes the Original Owner (SM14)', () => {
  it('refuses every action on the Original Owner, on Staff Management and on Settings > Users', async () => {
    const id = member.original;
    for (const who of [people.delegate, people.admin]) {
      for (const [method, path, body] of [
        ['post', `/staff/${id}/lock`, { reason: 'Test', confirm: true }],
        ['post', `/staff/${id}/deactivate`, sure],
        ['post', `/staff/${id}/reset-mfa`, sure],
        ['post', `/staff/${id}/reset-password`, sure],
        ['post', `/staff/${id}/sessions/revoke-all`, sure],
        ['post', `/team/${id}/deactivate`, undefined],
        ['patch', `/team/${id}`, { role: 'ADMIN' }],
      ] as const)
        expectError(await call(method, path, who, body), 403, 'FORBIDDEN');
      expectError(await role(who, id, 'ADMIN'), 403, 'FORBIDDEN');
    }
    // Still an active Owner, unchanged.
    expect(await detail(people.original, id)).toMatchObject({ role: 'OWNER', status: 'ACTIVE' });
  });
});

describe('owner-level access (SM14)', () => {
  it('is given and taken away by the Original Owner alone', async () => {
    const { original, delegate } = people;
    // A delegate gives no Owner role and takes none away: Staff Management and Settings > Users.
    expectError(await role(delegate, member.admin2, 'OWNER'), 403, 'CANNOT_GRANT');
    expectError(await role(delegate, member.delegate2, 'ADMIN'), 403, 'CANNOT_GRANT');
    expectError(
      await call('patch', `/team/${member.admin2}`, delegate, { role: 'OWNER' }),
      403,
      'CANNOT_GRANT',
    );
    expectError(
      await call('patch', `/team/${member.delegate2}`, delegate, { role: 'ADMIN' }),
      403,
      'CANNOT_GRANT',
    );
    // The Original Owner grants it, then takes it back (to Admin), each audited.
    expect(StaffDetail.parse(ok(await role(original, member.promoted, 'OWNER'))).role).toBe(
      'OWNER',
    );
    expect((await detail(delegate, member.promoted)).authority.changeRole).toBe(false);
    expect(StaffDetail.parse(ok(await role(original, member.promoted, 'ADMIN'))).role).toBe(
      'ADMIN',
    );
    const moves = await asOwner({ kind: 'business', businessId: firms.a }, (tx) =>
      tx.auditLog.findMany({
        where: { action: 'membership.role_changed', entityId: member.promoted },
        orderBy: { createdAt: 'asc' },
        select: { actorUserId: true, metadata: true },
      }),
    );
    expect(moves.map((m) => m.actorUserId)).toEqual([original.id, original.id]);
  });
});

describe('Reset MFA, Lock and the Admin’s reach (SM14)', () => {
  it('Reset MFA is owner-level only; an Admin acts only below Admin; a delegate on a delegate', async () => {
    const { delegate, admin } = people;
    expectError(
      await call('post', `/staff/${member.staff}/reset-mfa`, admin, sure),
      403,
      'FORBIDDEN',
    );
    StaffActionResult.parse(
      ok(await call('post', `/staff/${member.staff}/reset-mfa`, delegate, sure)),
    );
    // An Admin locks Staff, never a peer Admin.
    expectError(
      await call('post', `/staff/${member.admin2}/lock`, admin, { reason: 'Test', confirm: true }),
      403,
      'FORBIDDEN',
    );
    expect(
      StaffActionResult.parse(
        ok(
          await call('post', `/staff/${member.staff2}/lock`, admin, {
            reason: 'Test',
            confirm: true,
          }),
        ),
      ).status,
    ).toBe('LOCKED');
    ok(await call('post', `/staff/${member.staff2}/unlock`, admin, {}));
    // A delegate acts on another delegate (below the Original Owner): lock and unlock.
    expect(
      StaffActionResult.parse(
        ok(
          await call('post', `/staff/${member.delegate2}/lock`, delegate, {
            reason: 'Test',
            confirm: true,
          }),
        ),
      ).status,
    ).toBe('LOCKED');
    ok(await call('post', `/staff/${member.delegate2}/unlock`, delegate, {}));
    // An Admin deactivates neither a peer nor an Owner, on either route.
    for (const id of [member.admin2, member.delegate]) {
      expectError(await call('post', `/staff/${id}/deactivate`, admin, sure), 403, 'FORBIDDEN');
      expectError(await call('post', `/team/${id}/deactivate`, admin), 403, 'FORBIDDEN');
    }
  });
});

describe('firm B', () => {
  it("reaches none of firm A's members", async () => {
    expectError(
      await call('get', `/staff/${member.original}`, people.ownerB, undefined, 'b'),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call(
        'post',
        `/staff/${member.delegate}/lock`,
        people.ownerB,
        { reason: 'x', confirm: true },
        'b',
      ),
      404,
      'NOT_FOUND',
    );
  });
});
