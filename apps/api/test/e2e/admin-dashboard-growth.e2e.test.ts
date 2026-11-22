// End-to-end: SA-DSH-F06, Platform Growth. Any range of US Eastern days up to two years, by day,
// week or month; a new application and a newly set-up firm count on today's point. Other test
// files add rows at the same time, so the checks are "at least one more", never exact totals.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { AdminGrowth } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const tag = `growth${randomUUID().slice(0, 8)}`;
const team = { id: randomUUID(), email: `${tag}-team@growth.example.test` };
let app: INestApplication;
const tokens = new Map<string, string>();

async function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .send({ email })
    .expect(200);
  const { token } = res.body as { token: string };
  tokens.set(email, token);
  return token;
}
const growth = async (query: string, email = fx.users.admin.email) => {
  const token = await tokenFor(email);
  return request(app.getHttpServer())
    .get(`/api/v1/admin/dashboard/growth${query}`)
    .set('authorization', `Bearer ${token}`);
};
const day = (offset: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
    new Date(Date.now() + offset * 86_400_000),
  );
const asOwner = async <T>(work: Parameters<typeof runInScope<T>>[2]): Promise<T> => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(owner, { kind: 'platform' }, work);
  } finally {
    await owner.$disconnect();
  }
};

beforeAll(async () => {
  await asOwner(async (tx) => {
    await tx.user.create({
      data: {
        id: team.id,
        cognitoSub: team.id,
        pool: 'ADMIN',
        email: team.email,
        name: 'Fake Team Member',
      },
    });
    await tx.platformAdmin.create({ data: { userId: team.id, role: 'TEAM_MEMBER' } });
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
  // Listening, so a request built before its token is fetched never finds the server closed.
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('SA-DSH-F06: Platform Growth', () => {
  it('draws days for a month, weeks for six months and months for a year', async () => {
    const month = AdminGrowth.parse((await growth(`?from=${day(-29)}&to=${day(0)}`)).body);
    expect(month.bucket).toBe('DAY');
    expect(month.points).toHaveLength(30);
    expect(month.points[0]?.start).toBe(day(-29));
    expect(month.points.at(-1)?.end).toBe(day(0));
    const half = AdminGrowth.parse((await growth(`?from=${day(-182)}&to=${day(0)}`)).body);
    expect(half.bucket).toBe('WEEK');
    const year = AdminGrowth.parse((await growth(`?from=${day(-364)}&to=${day(0)}`)).body);
    expect(year.bucket).toBe('MONTH');
    expect(year.points.length).toBeGreaterThanOrEqual(12);
  });

  it('counts a new application and a newly set-up firm on today', async () => {
    const today = async () =>
      AdminGrowth.parse((await growth(`?from=${day(-1)}&to=${day(0)}`)).body).points.at(-1)!;
    const before = await today();
    await asOwner(async (tx) => {
      await tx.firmApplication.create({
        data: {
          legalName: `Sample Growth ${tag}`,
          contactName: 'Jordan Sample',
          contactEmail: `${tag}@growth.example.test`,
          data: {},
        },
      });
      await tx.business.create({
        data: { slug: `${tag}-firm`, name: `Sample Growth Firm ${tag}`, status: 'ACTIVE' },
      });
    });
    const after = await today();
    expect(after.applications).toBeGreaterThanOrEqual(before.applications + 1);
    expect(after.activations).toBeGreaterThanOrEqual(before.activations + 1);
    expect(after.activeFirms).toBeGreaterThanOrEqual(before.activeFirms + 1);
  });

  it('refuses a reversed range, more than two years, no range and anyone but a Super Admin', async () => {
    expect((await growth(`?from=${day(0)}&to=${day(-1)}`)).status).toBe(400);
    expect((await growth(`?from=${day(-731)}&to=${day(0)}`)).status).toBe(400);
    expect((await growth(`?from=${day(-730)}&to=${day(0)}`)).status).toBe(200);
    expect((await growth('')).status).toBe(400);
    expect((await growth('?from=2026-13-01&to=2026-12-31')).status).toBe(400);
    expect((await growth(`?from=${day(-6)}&to=${day(0)}`, team.email)).status).toBe(403);
  });
});
