// End-to-end: R55, Settings > Users & Roles' table, counters and export (contract in
// packages/types/src/settings/users.ts). Owner and Admin read; the others are refused; firm B sees
// none of firm A's people; the export holds every matching row, is audited, and has no secrets.
import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { FirmUserList, UsersSummary } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55u-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  managerA: person('manager-a'),
  invitedA: person('invited-a'),
  lockedA: person('locked-a'),
  gonerA: person('goner-a'),
  ownerB: person('owner-b'),
};
type Who = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', string>;
const member = {} as Record<keyof typeof people, string>;
const token = `token-${run}`;

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.63.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

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
  const t = (res.body as { token: string }).token;
  tokens.set(email, t);
  return t;
}

async function get(path: string, who: Who | undefined, firm: 'a' | 'b' = 'a'): Promise<Response> {
  let req = request(app.getHttpServer())
    .get(`/api/v1/business${path}`)
    .set('x-business-id', firms[firm])
    .set('x-forwarded-for', viewer());
  if (who) req = req.set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return req;
}
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const ok = (res: Response) => {
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as unknown;
};
const { ownerA, adminA, staffA, managerA, ownerB } = people;

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: 'STAFF',
          email: p.email,
          name: `Fake R55u ${key}`,
        },
      });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r55u-${key}-${run}`;
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
    ['a', 'staffA', 'STAFF', 'ACTIVE'],
    ['a', 'managerA', 'MANAGER', 'ACTIVE'],
    ['a', 'invitedA', 'STAFF', 'INVITED'],
    ['a', 'lockedA', 'BOOKKEEPER', 'LOCKED'],
    ['a', 'gonerA', 'STAFF', 'DEACTIVATED'],
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
  await inFirm('a', (tx) =>
    tx.invite.create({
      data: {
        businessId: firms.a,
        membershipId: member.invitedA,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        email: people.invitedA.email,
        expiresAt: new Date(Date.now() + 86_400_000),
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
  await app.close();
});

describe('Users & Roles', () => {
  it("lists the firm's people with the company, and searches by role too", async () => {
    const list = FirmUserList.parse(ok(await get('/users?pageSize=100', ownerA)));
    expect(list.total).toBe(7);
    expect(new Set(list.items.map((u) => u.company))).toEqual(new Set([`Firm r55u-a-${run}`]));
    expect(list.items.find((u) => u.id === member.invitedA)?.invite?.sentAt).toBeTruthy();
    const search = FirmUserList.parse(ok(await get('/users?search=manag', adminA)));
    expect(search.items.map((u) => u.id)).toEqual([member.managerA]);
    const pending = FirmUserList.parse(ok(await get('/users?status=invited', ownerA)));
    expect(pending.items.map((u) => u.id)).toEqual([member.invitedA]);
    const page2 = FirmUserList.parse(ok(await get('/users?pageSize=5&page=2', ownerA)));
    expect([page2.total, page2.items.length]).toEqual([7, 2]);
  });

  it('counts accepted accounts apart from pending invitations', async () => {
    expect(UsersSummary.parse(ok(await get('/users/summary', ownerA)))).toEqual({
      total: 6,
      addedThisMonth: 6,
      active: 4,
      pendingInvitations: 1,
      roles: 9,
    });
    const b = UsersSummary.parse(ok(await get('/users/summary', ownerB, 'b')));
    expect([b.total, b.active, b.pendingInvitations]).toEqual([1, 1, 0]);
  });

  it('exports every matching row as CSV, audited, without secrets', async () => {
    const res = await get('/users/export?pageSize=10', ownerA);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const text = res.text.replace(new RegExp(`^${String.fromCharCode(0xfeff)}`), '');
    const lines = text.trim().split('\r\n');
    expect(lines[0]).toBe('Name,Email,Role,Company,Status,MFA,Last login,Invited');
    expect(lines).toHaveLength(8);
    expect(text).toContain('Bookkeeper');
    expect(text).toContain('Pending');
    expect(text).not.toContain(token);
    const only = await get('/users/export?status=locked', ownerA);
    expect(only.text.trim().split('\r\n')).toHaveLength(2);
    const row = await inFirm('a', (tx) =>
      tx.auditLog.findFirstOrThrow({
        where: { businessId: firms.a, action: 'users.exported' },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(row.metadata).toEqual({ count: 1, filters: ['status'] });
  });

  it('keeps a selection by ids, in the list and in the export (audited)', async () => {
    const ids = [member.staffA, member.lockedA].join(',');
    const list = FirmUserList.parse(ok(await get(`/users?ids=${ids}`, ownerA)));
    expect(list.items.map((u) => u.id).sort()).toEqual([member.staffA, member.lockedA].sort());
    // Another firm's member is never found by id.
    const other = FirmUserList.parse(ok(await get(`/users?ids=${member.ownerB}`, ownerA)));
    expect(other.items).toEqual([]);
    const csv = await get(`/users/export?ids=${ids}`, ownerA);
    expect(csv.text.trim().split(String.fromCharCode(13, 10))).toHaveLength(3);
    const row = await inFirm('a', (tx) =>
      tx.auditLog.findFirstOrThrow({
        where: { businessId: firms.a, action: 'users.exported' },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(row.metadata).toEqual({ count: 2, filters: ['ids'] });
    expect((await get('/users?ids=nope', ownerA)).status).toBe(400);
  });

  it('is for Owner and Admin, in their own firm only', async () => {
    for (const who of [staffA, managerA]) expect((await get('/users', who)).status).toBe(403);
    expect(codeOf(await get('/users/summary', staffA))).toBe('FORBIDDEN');
    expect((await get('/users', undefined)).status).toBe(401);
    const b = FirmUserList.parse(ok(await get('/users?pageSize=100', ownerB, 'b')));
    expect(b.items.map((u) => u.id)).toEqual([member.ownerB]);
    expect([403, 404]).toContain((await get('/users', ownerA, 'b')).status);
  });
});
