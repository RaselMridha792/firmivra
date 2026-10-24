// End-to-end: R60, Staff Settings > Offices & Job Titles (Octavia's SM3 and SM11; contract in
// packages/types/src/staff/job-titles.ts, table staff_job_titles from R1's #1074). Owner and Admin
// add, rename, archive and restore; nothing is deleted and no staff record changes. Names are
// unique among the live titles, ignoring letter case. Firm B sees none of firm A's. No audit row
// holds a name.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { StaffFormOptions, StaffJobTitle, StaffJobTitleList } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r60jt-${key}-${run}@r60.test` });
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
          name: `Fake R60jt ${key}`,
        },
      });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r60jt-${key}-${run}`;
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

const title = async (name: string, who: Who = ownerA) =>
  StaffJobTitle.parse(ok(await call('post', '/staff-job-titles', who, { name }), 201));
const list = async (query = '', who: Who = ownerA, firm: 'a' | 'b' = 'a') =>
  StaffJobTitleList.parse(ok(await call('get', `/staff-job-titles${query}`, who, undefined, firm)))
    .items;
const mine = (items: StaffJobTitle[]) => items.filter((t) => t.name.includes(run));
const optionTitles = async () =>
  StaffFormOptions.parse(ok(await call('get', '/staff/options', ownerA))).jobTitles;

describe('saved job titles', () => {
  it('adds titles, lists the live ones by name with how many staff records carry each', async () => {
    const tax = await title(`Tax Preparer ${run}`);
    await title(`Bookkeeper ${run}`, adminA);
    expect(tax).toMatchObject({ name: `Tax Preparer ${run}`, archivedAt: null, staffCount: 0 });
    // Two records carry the title, in other letter cases and spacing.
    await inFirm('a', async (tx) => {
      await tx.membership.update({
        where: { id: member.staffA },
        data: { jobTitle: `tax preparer ${run}` },
      });
      await tx.membership.update({
        where: { id: member.managerA },
        data: { jobTitle: ` TAX PREPARER ${run} ` },
      });
    });
    expect(mine(await list()).map((t) => [t.name, t.staffCount])).toEqual([
      [`Bookkeeper ${run}`, 0],
      [`Tax Preparer ${run}`, 2],
    ]);
    expect(await optionTitles()).toEqual(
      expect.arrayContaining([`Bookkeeper ${run}`, `Tax Preparer ${run}`]),
    );
  });

  it('refuses a live name twice, ignoring letter case, even when both are sent at once', async () => {
    await title(`Payroll Lead ${run}`);
    expectError(
      await call('post', '/staff-job-titles', ownerA, { name: `PAYROLL LEAD ${run}` }),
      409,
      'JOB_TITLE_EXISTS',
    );
    const name = `Concurrent ${run}`;
    const both = await Promise.all([
      call('post', '/staff-job-titles', ownerA, { name }),
      call('post', '/staff-job-titles', adminA, { name }),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(codeOf(both.find((r) => r.status === 409)!)).toBe('JOB_TITLE_EXISTS');
    expect(mine(await list()).filter((t) => t.name === name)).toHaveLength(1);
  });

  it('renames a title without changing any staff record', async () => {
    const t = await title(`Associate ${run}`);
    await inFirm('a', (tx) =>
      tx.membership.update({
        where: { id: member.adminA },
        data: { jobTitle: `Associate ${run}` },
      }),
    );
    const renamed = StaffJobTitle.parse(
      ok(
        await call('patch', `/staff-job-titles/${t.id}`, ownerA, {
          name: `Senior Associate ${run}`,
        }),
      ),
    );
    expect(renamed).toMatchObject({ id: t.id, name: `Senior Associate ${run}`, staffCount: 0 });
    const record = await inFirm('a', (tx) =>
      tx.membership.findUniqueOrThrow({ where: { id: member.adminA }, select: { jobTitle: true } }),
    );
    expect(record.jobTitle).toBe(`Associate ${run}`);
    // The same name again changes nothing; another live title's name is refused.
    const same = StaffJobTitle.parse(
      ok(
        await call('patch', `/staff-job-titles/${t.id}`, ownerA, {
          name: `Senior Associate ${run}`,
        }),
      ),
    );
    expect(same.updatedAt).toBe(renamed.updatedAt);
    await title(`Partner ${run}`);
    expectError(
      await call('patch', `/staff-job-titles/${t.id}`, ownerA, { name: `partner ${run}` }),
      409,
      'JOB_TITLE_EXISTS',
    );
  });

  it('archives and restores: an archived title leaves Create Staff, and its name can be reused', async () => {
    const t = await title(`Intern ${run}`);
    const archived = StaffJobTitle.parse(
      ok(await call('post', `/staff-job-titles/${t.id}/archive`, adminA)),
    );
    expect(archived.archivedAt).not.toBeNull();
    // Idempotent.
    const twice = StaffJobTitle.parse(
      ok(await call('post', `/staff-job-titles/${t.id}/archive`, ownerA)),
    );
    expect(twice.archivedAt).toBe(archived.archivedAt);
    expect(mine(await list()).map((x) => x.id)).not.toContain(t.id);
    expect(mine(await list('?includeArchived=true')).at(-1)?.id).toBe(t.id);
    expect(await optionTitles()).not.toContain(`Intern ${run}`);
    expectError(
      await call('patch', `/staff-job-titles/${t.id}`, ownerA, { name: `Intern II ${run}` }),
      409,
      'JOB_TITLE_ARCHIVED',
    );
    // A new live title takes the name; restoring the old one is then refused.
    const again = await title(`intern ${run}`);
    expectError(
      await call('post', `/staff-job-titles/${t.id}/restore`, ownerA),
      409,
      'JOB_TITLE_EXISTS',
    );
    ok(await call('post', `/staff-job-titles/${again.id}/archive`, ownerA));
    const restored = StaffJobTitle.parse(
      ok(await call('post', `/staff-job-titles/${t.id}/restore`, ownerA)),
    );
    expect(restored.archivedAt).toBeNull();
    expect(await optionTitles()).toContain(`Intern ${run}`);
  });

  it('checks the name', async () => {
    for (const name of ['', '   ', 'x'.repeat(81), 'Line\nbreak']) {
      expectError(
        await call('post', '/staff-job-titles', ownerA, { name }),
        400,
        'VALIDATION_FAILED',
      );
    }
    const t = await title(`  Trimmed ${run}  `);
    expect(t.name).toBe(`Trimmed ${run}`);
  });

  it('is for the Owner and the Admin only', async () => {
    const t = await title(`Roles ${run}`);
    for (const who of [managerA, staffA]) {
      expect((await call('get', '/staff-job-titles', who)).status).toBe(403);
      const body = { name: `No ${run}` };
      expect((await call('post', '/staff-job-titles', who, body)).status).toBe(403);
      expect((await call('patch', `/staff-job-titles/${t.id}`, who, body)).status).toBe(403);
      expect((await call('post', `/staff-job-titles/${t.id}/archive`, who)).status).toBe(403);
    }
    expect((await call('get', '/staff-job-titles', undefined)).status).toBe(401);
  });

  it("never shows or changes another firm's titles", async () => {
    const t = await title(`Firm A only ${run}`);
    expect(mine(await list('?includeArchived=true', ownerB, 'b'))).toEqual([]);
    for (const [method, path, body] of [
      ['patch', `/staff-job-titles/${t.id}`, { name: `Taken ${run}` }],
      ['post', `/staff-job-titles/${t.id}/archive`, undefined],
      ['post', `/staff-job-titles/${t.id}/restore`, undefined],
    ] as const) {
      expectError(await call(method, path, ownerB, body, 'b'), 404, 'NOT_FOUND');
    }
    // Firm B may use the same name.
    ok(await call('post', '/staff-job-titles', ownerB, { name: `Firm A only ${run}` }, 'b'), 201);
    expect((await list()).find((x) => x.id === t.id)?.name).toBe(`Firm A only ${run}`);
  });

  it('audits each change without the name', async () => {
    const t = await title(`Audited ${run}`);
    ok(await call('patch', `/staff-job-titles/${t.id}`, ownerA, { name: `Audited II ${run}` }));
    ok(await call('post', `/staff-job-titles/${t.id}/archive`, ownerA));
    ok(await call('post', `/staff-job-titles/${t.id}/restore`, ownerA));
    const rows = await auditRows(t.id);
    expect(rows.map((r) => r.action)).toEqual([
      'staff_job_title.created',
      'staff_job_title.renamed',
      'staff_job_title.archived',
      'staff_job_title.restored',
    ]);
    expect(JSON.stringify(rows)).not.toContain('Audited');
  });
});
