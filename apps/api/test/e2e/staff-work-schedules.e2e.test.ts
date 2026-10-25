// End-to-end: R60, Staff Settings > Offices & Job Titles > Work Schedules (Octavia's SM8; contract
// in packages/types/src/staff/work-schedules.ts, table staff_work_schedules from R1's #1095). Owner
// and Admin add, rename, archive and restore; nothing is deleted and no staff record changes. Names
// are unique among the live schedules, ignoring letter case. Create and Edit Staff offer the
// presets, then the saved live schedules. Firm B sees none of firm A's. No audit row holds a name.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { StaffFormOptions, StaffWorkSchedule, StaffWorkScheduleList } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r60ws-${key}-${run}@r60.test` });
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
          name: `Fake R60ws ${key}`,
        },
      });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r60ws-${key}-${run}`;
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

const schedule = async (name: string, who: Who = ownerA) =>
  StaffWorkSchedule.parse(ok(await call('post', '/staff-work-schedules', who, { name }), 201));
const list = async (query = '', who: Who = ownerA, firm: 'a' | 'b' = 'a') =>
  StaffWorkScheduleList.parse(
    ok(await call('get', `/staff-work-schedules${query}`, who, undefined, firm)),
  ).items;
const mine = (items: StaffWorkSchedule[]) => items.filter((t) => t.name.includes(run));
const optionSchedules = async () =>
  StaffFormOptions.parse(ok(await call('get', '/staff/options', ownerA))).workSchedules;
/** Gives a member a work schedule on their staff record. */
const setSchedule = (membershipId: string, workSchedule: string) =>
  inFirm('a', (tx) =>
    tx.staffProfile.upsert({
      where: { businessId_membershipId: { businessId: firms.a, membershipId } },
      create: { businessId: firms.a, membershipId, workSchedule },
      update: { workSchedule },
    }),
  );

describe('saved work schedules', () => {
  it('adds schedules, lists the live ones by name with how many staff records carry each', async () => {
    const tax = await schedule(`Tax Preparer ${run}`);
    await schedule(`Bookkeeper ${run}`, adminA);
    expect(tax).toMatchObject({ name: `Tax Preparer ${run}`, archivedAt: null, staffCount: 0 });
    // Two records carry the schedule, in other letter cases and spacing.
    await setSchedule(member.staffA, `tax preparer ${run}`);
    await setSchedule(member.managerA, ` TAX PREPARER ${run} `);
    expect(mine(await list()).map((t) => [t.name, t.staffCount])).toEqual([
      [`Bookkeeper ${run}`, 0],
      [`Tax Preparer ${run}`, 2],
    ]);
    // The presets first, then the saved schedules by name.
    const options = await optionSchedules();
    expect(options.slice(0, 5)).toEqual([
      'Full-time (Mon-Fri, 9-5)',
      'Part-time (mornings)',
      'Part-time (afternoons)',
      'Seasonal (tax season)',
      'Flexible',
    ]);
    const saved = options.filter((o) => o.includes(run));
    expect(saved).toEqual([`Bookkeeper ${run}`, `Tax Preparer ${run}`]);
    expect(options.indexOf(`Bookkeeper ${run}`)).toBeGreaterThan(4);
    // A saved schedule named like a preset (R1's fill copied the ones in use) is offered once.
    await schedule('flexible');
    expect((await optionSchedules()).filter((o) => o.toLowerCase() === 'flexible')).toEqual([
      'Flexible',
    ]);
  });

  it('refuses a live name twice, ignoring letter case, even when both are sent at once', async () => {
    await schedule(`Payroll Lead ${run}`);
    expectError(
      await call('post', '/staff-work-schedules', ownerA, { name: `PAYROLL LEAD ${run}` }),
      409,
      'WORK_SCHEDULE_EXISTS',
    );
    const name = `Concurrent ${run}`;
    const both = await Promise.all([
      call('post', '/staff-work-schedules', ownerA, { name }),
      call('post', '/staff-work-schedules', adminA, { name }),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(codeOf(both.find((r) => r.status === 409)!)).toBe('WORK_SCHEDULE_EXISTS');
    expect(mine(await list()).filter((t) => t.name === name)).toHaveLength(1);
  });

  it('renames a schedule without changing any staff record', async () => {
    const t = await schedule(`Associate ${run}`);
    await setSchedule(member.adminA, `Associate ${run}`);
    const renamed = StaffWorkSchedule.parse(
      ok(
        await call('patch', `/staff-work-schedules/${t.id}`, ownerA, {
          name: `Senior Associate ${run}`,
        }),
      ),
    );
    expect(renamed).toMatchObject({ id: t.id, name: `Senior Associate ${run}`, staffCount: 0 });
    const record = await inFirm('a', (tx) =>
      tx.staffProfile.findUniqueOrThrow({
        where: { businessId_membershipId: { businessId: firms.a, membershipId: member.adminA } },
        select: { workSchedule: true },
      }),
    );
    expect(record.workSchedule).toBe(`Associate ${run}`);
    // The same name again changes nothing; another live schedule's name is refused.
    const same = StaffWorkSchedule.parse(
      ok(
        await call('patch', `/staff-work-schedules/${t.id}`, ownerA, {
          name: `Senior Associate ${run}`,
        }),
      ),
    );
    expect(same.updatedAt).toBe(renamed.updatedAt);
    await schedule(`Partner ${run}`);
    expectError(
      await call('patch', `/staff-work-schedules/${t.id}`, ownerA, { name: `partner ${run}` }),
      409,
      'WORK_SCHEDULE_EXISTS',
    );
  });

  it('archives and restores: an archived schedule leaves Create Staff, and its name can be reused', async () => {
    const t = await schedule(`Intern ${run}`);
    const archived = StaffWorkSchedule.parse(
      ok(await call('post', `/staff-work-schedules/${t.id}/archive`, adminA)),
    );
    expect(archived.archivedAt).not.toBeNull();
    // Idempotent.
    const twice = StaffWorkSchedule.parse(
      ok(await call('post', `/staff-work-schedules/${t.id}/archive`, ownerA)),
    );
    expect(twice.archivedAt).toBe(archived.archivedAt);
    expect(mine(await list()).map((x) => x.id)).not.toContain(t.id);
    expect(mine(await list('?includeArchived=true')).at(-1)?.id).toBe(t.id);
    expect(await optionSchedules()).not.toContain(`Intern ${run}`);
    expectError(
      await call('patch', `/staff-work-schedules/${t.id}`, ownerA, { name: `Intern II ${run}` }),
      409,
      'WORK_SCHEDULE_ARCHIVED',
    );
    // A new live schedule takes the name; restoring the old one is then refused.
    const again = await schedule(`intern ${run}`);
    expectError(
      await call('post', `/staff-work-schedules/${t.id}/restore`, ownerA),
      409,
      'WORK_SCHEDULE_EXISTS',
    );
    ok(await call('post', `/staff-work-schedules/${again.id}/archive`, ownerA));
    const restored = StaffWorkSchedule.parse(
      ok(await call('post', `/staff-work-schedules/${t.id}/restore`, ownerA)),
    );
    expect(restored.archivedAt).toBeNull();
    expect(await optionSchedules()).toContain(`Intern ${run}`);
  });

  it('checks the name', async () => {
    for (const name of ['', '   ', 'x'.repeat(81), 'Line\nbreak']) {
      expectError(
        await call('post', '/staff-work-schedules', ownerA, { name }),
        400,
        'VALIDATION_FAILED',
      );
    }
    const t = await schedule(`  Trimmed ${run}  `);
    expect(t.name).toBe(`Trimmed ${run}`);
  });

  it('is for the Owner and the Admin only', async () => {
    const t = await schedule(`Roles ${run}`);
    for (const who of [managerA, staffA]) {
      expect((await call('get', '/staff-work-schedules', who)).status).toBe(403);
      const body = { name: `No ${run}` };
      expect((await call('post', '/staff-work-schedules', who, body)).status).toBe(403);
      expect((await call('patch', `/staff-work-schedules/${t.id}`, who, body)).status).toBe(403);
      expect((await call('post', `/staff-work-schedules/${t.id}/archive`, who)).status).toBe(403);
    }
    expect((await call('get', '/staff-work-schedules', undefined)).status).toBe(401);
  });

  it("never shows or changes another firm's schedules", async () => {
    const t = await schedule(`Firm A only ${run}`);
    expect(mine(await list('?includeArchived=true', ownerB, 'b'))).toEqual([]);
    for (const [method, path, body] of [
      ['patch', `/staff-work-schedules/${t.id}`, { name: `Taken ${run}` }],
      ['post', `/staff-work-schedules/${t.id}/archive`, undefined],
      ['post', `/staff-work-schedules/${t.id}/restore`, undefined],
    ] as const) {
      expectError(await call(method, path, ownerB, body, 'b'), 404, 'NOT_FOUND');
    }
    // Firm B may use the same name.
    ok(
      await call('post', '/staff-work-schedules', ownerB, { name: `Firm A only ${run}` }, 'b'),
      201,
    );
    expect((await list()).find((x) => x.id === t.id)?.name).toBe(`Firm A only ${run}`);
  });

  it('audits each change without the name', async () => {
    const t = await schedule(`Audited ${run}`);
    ok(await call('patch', `/staff-work-schedules/${t.id}`, ownerA, { name: `Audited II ${run}` }));
    ok(await call('post', `/staff-work-schedules/${t.id}/archive`, ownerA));
    ok(await call('post', `/staff-work-schedules/${t.id}/restore`, ownerA));
    const rows = await auditRows(t.id);
    expect(rows.map((r) => r.action)).toEqual([
      'staff_work_schedule.created',
      'staff_work_schedule.renamed',
      'staff_work_schedule.archived',
      'staff_work_schedule.restored',
    ]);
    expect(JSON.stringify(rows)).not.toContain('Audited');
  });
});
