// End-to-end: SM14 part C, SEC-6. The firm's two-factor requirement is changed only by an Owner or
// an Admin who is a security administrator, after the current password (a fresh sign-in) and the
// confirm, and audited without the note's text; off needs the documented exception. Owner-level
// grants security administration to an Admin (never to anyone else, never themselves). Firm B's
// requirement and members are untouched and unreachable.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { MfaPolicy, StaffSecurityAdmin } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { LOCAL_PASSWORD } from '../../src/auth/identity/local-identity.provider.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55m-${key}-${run}@r55.test` });
const people = {
  owner: person('owner'),
  admin: person('admin'),
  admin2: person('admin2'),
  staff: person('staff'),
  ownerB: person('owner-b'),
};
type Who = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', string>;
const member = {} as Record<keyof typeof people, string>;
let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.67.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

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
  method: 'get' | 'put',
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
const ok = (res: Response) => {
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as unknown;
};
const policy = async (who: Who, firm: 'a' | 'b' = 'a') =>
  MfaPolicy.parse(ok(await call('get', '/security/mfa-policy', who, undefined, firm)));
const change = (who: Who, body: object) => call('put', '/security/mfa-policy', who, body);
const securityAdmin = (who: Who, id: string, value: boolean) =>
  call('put', `/staff/${id}/security-admin`, who, { securityAdmin: value, confirm: true });

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people))
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake ${key}` },
      });
    for (const key of ['a', 'b'] as const)
      firms[key] = (
        await tx.business.create({
          data: { slug: `r55m-${key}-${run}`, name: `Firm ${key} ${run}`, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
  });
  for (const [firm, key, role] of [
    ['a', 'owner', 'OWNER'],
    ['a', 'admin', 'ADMIN'],
    ['a', 'admin2', 'ADMIN'],
    ['a', 'staff', 'STAFF'],
    ['b', 'ownerB', 'OWNER'],
  ] as const)
    member[key] = (
      await asOwner({ kind: 'business', businessId: firms[firm] }, (tx) =>
        tx.membership.create({
          data: { businessId: firms[firm], userId: people[key].id, role, status: 'ACTIVE' },
          select: { id: true },
        }),
      )
    ).id;
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

describe('the two-factor requirement (SEC-6)', () => {
  it('is required by default; only an Owner (or a security administrator) may change it', async () => {
    const owner = await policy(people.owner);
    expect(owner).toEqual({
      required: true,
      exception: null,
      canChange: true,
      enforcedAtSignIn: true,
    });
    expect((await policy(people.admin)).canChange).toBe(false);
    expect((await policy(people.staff)).canChange).toBe(false);
    for (const who of [people.admin, people.staff])
      expectError(
        await change(who, {
          required: false,
          note: 'Fake exception',
          currentPassword: LOCAL_PASSWORD,
          confirm: true,
        }),
        403,
        'FORBIDDEN',
      );
  });

  it('owner-level grants security administration to an Admin only, never themselves', async () => {
    expect(
      StaffSecurityAdmin.parse(
        ok(await call('get', `/staff/${member.admin}/security-admin`, people.owner)),
      ),
    ).toEqual({ securityAdmin: false, canChange: true });
    // An Admin cannot grant it; the Owner cannot give it to Staff or to themselves.
    expect(
      StaffSecurityAdmin.parse(
        ok(await call('get', `/staff/${member.admin}/security-admin`, people.admin2)),
      ).canChange,
    ).toBe(false);
    expectError(await securityAdmin(people.admin2, member.admin, true), 403, 'FORBIDDEN');
    expectError(await securityAdmin(people.owner, member.staff, true), 409, 'NOT_ADMIN');
    expectError(await securityAdmin(people.owner, member.owner, true), 409, 'CANNOT_CHANGE_SELF');
    expect(
      StaffSecurityAdmin.parse(ok(await securityAdmin(people.owner, member.admin, true))),
    ).toMatchObject({ securityAdmin: true });
    const audited = await asOwner({ kind: 'business', businessId: firms.a }, (tx) =>
      tx.auditLog.findFirstOrThrow({
        where: { action: 'staff.security_admin_changed', entityId: member.admin },
      }),
    );
    expect(audited.metadata).toEqual({ securityAdmin: true });
    expect((await policy(people.admin)).canChange).toBe(true);
    // Firm B reaches none of firm A's members.
    expectError(
      await call(
        'put',
        `/staff/${member.admin}/security-admin`,
        people.ownerB,
        { securityAdmin: false, confirm: true },
        'b',
      ),
      404,
      'NOT_FOUND',
    );
  });

  it('a security administrator records an approved exception after a fresh sign-in', async () => {
    // Off needs the documented exception, the password and the confirm.
    expectError(
      await change(people.admin, {
        required: false,
        currentPassword: LOCAL_PASSWORD,
        confirm: true,
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await change(people.admin, { required: false, note: 'x', currentPassword: LOCAL_PASSWORD }),
      400,
      'VALIDATION_FAILED',
    );
    const wrong = await change(people.admin, {
      required: false,
      note: 'Approved by the Owner for a shared kiosk login.',
      currentPassword: 'Not-the-passw0rd',
      confirm: true,
    });
    expectError(wrong, 400, 'VALIDATION_FAILED');
    expect((wrong.body as { error: { details: { path: string }[] } }).error.details[0]?.path).toBe(
      'currentPassword',
    );
    const off = MfaPolicy.parse(
      ok(
        await change(people.admin, {
          required: false,
          note: 'Approved by the Owner for a shared kiosk login.',
          currentPassword: LOCAL_PASSWORD,
          confirm: true,
        }),
      ),
    );
    expect(off).toMatchObject({
      required: false,
      enforcedAtSignIn: true,
      exception: {
        note: 'Approved by the Owner for a shared kiosk login.',
        approvedBy: { userId: people.admin.id },
      },
    });
    // Audited without the note's text; the failed try too.
    const rows = await asOwner({ kind: 'business', businessId: firms.a }, (tx) =>
      tx.auditLog.findMany({
        where: { businessId: firms.a, action: { startsWith: 'security.mfa_requirement_change' } },
        orderBy: { createdAt: 'asc' },
        select: { action: true, metadata: true },
      }),
    );
    expect(rows.map((r) => r.action)).toEqual([
      'security.mfa_requirement_change_failed',
      'security.mfa_requirement_changed',
    ]);
    expect(JSON.stringify(rows)).not.toContain('kiosk');
    // Firm B: still required, no exception.
    expect(await policy(people.ownerB, 'b')).toMatchObject({ required: true, exception: null });

    // The Owner turns it back on: the exception is gone.
    const on = MfaPolicy.parse(
      ok(
        await change(people.owner, {
          required: true,
          currentPassword: LOCAL_PASSWORD,
          confirm: true,
        }),
      ),
    );
    expect(on).toMatchObject({ required: true, exception: null });
    // Taking security administration away ends the Admin's right to change it.
    ok(await securityAdmin(people.owner, member.admin, false));
    expect((await policy(people.admin)).canChange).toBe(false);
  });
});
