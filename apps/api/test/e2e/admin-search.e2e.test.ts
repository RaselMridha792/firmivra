// End-to-end: SA-DSH-F01, the Super Admin's header search: firms and applications (never
// people) by name, owner or applicant name and email, an exact id, or a status word. Each check
// names this file's own records by a word only they contain.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { AdminSearchResult } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const tag = `srch${randomUUID().slice(0, 8)}`;
const firm = { id: randomUUID(), slug: `${tag}-firm`, name: `Sample Search ${tag} Tax` };
const applications = { pending: randomUUID(), declined: randomUUID() };
const team = { id: randomUUID(), email: `${tag}-team@search.example.test` };
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
const search = async (q: string, limit = 50, email = fx.users.admin.email) => {
  const token = await tokenFor(email);
  return request(app.getHttpServer())
    .get(`/api/v1/admin/search?q=${encodeURIComponent(q)}&limit=${limit}`)
    .set('authorization', `Bearer ${token}`);
};
const found = async (q: string) => AdminSearchResult.parse((await search(q)).body);

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
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
    await tx.business.create({ data: { ...firm, status: 'PENDING_SETUP' } });
    for (const [key, id] of Object.entries(applications)) {
      await tx.firmApplication.create({
        data: {
          id,
          legalName: `Sample Applicant ${tag} ${key}`,
          contactName: `Jordan ${key}`,
          contactEmail: `${tag}.${key}@search.example.test`,
          data: {},
        },
      });
    }
  });
  await runInScope(owner, { kind: 'admin', adminUserId: fx.users.admin.id }, (tx) =>
    tx.firmApplication.update({
      where: { id: applications.declined },
      data: {
        status: 'DECLINED',
        decisionReason: 'Not a tax practice.',
        reviewedByUserId: fx.users.admin.id,
        reviewedAt: new Date(),
      },
    }),
  );
  await owner.$disconnect();
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

describe('SA-DSH-F01: header search', () => {
  it('finds firms and applications by name, email and id, each with its type', async () => {
    const byName = await found(tag);
    expect(byName.firms.items.map((f) => f.id)).toEqual([firm.id]);
    expect(byName.firms.items[0]).toMatchObject({ name: firm.name, status: 'PENDING_SETUP' });
    expect(byName.applications.items.map((a) => a.id).sort()).toEqual(
      Object.values(applications).sort(),
    );
    expect(byName.applications.total).toBe(2);

    const byEmail = await found(`${tag}.declined@search`);
    expect(byEmail.applications.items.map((a) => [a.id, a.status])).toEqual([
      [applications.declined, 'DECLINED'],
    ]);
    expect(byEmail.firms.items).toEqual([]);

    expect((await found(firm.id)).firms.items.map((f) => f.id)).toEqual([firm.id]);
    expect(
      (await found(applications.pending.toUpperCase())).applications.items.map((a) => a.id),
    ).toEqual([applications.pending]);
  });

  it('takes status words, and a % as a plain character', async () => {
    const declined = await found('declined');
    expect(declined.applications.items.every((a) => a.status === 'DECLINED')).toBe(true);
    expect(declined.applications.items.map((a) => a.id)).toContain(applications.declined);
    const pending = await found('Pending');
    // Other files add firms in setup at the same time: only the status is checked here.
    expect(pending.firms.total).toBeGreaterThan(0);
    expect(pending.firms.items.every((f) => f.status === 'PENDING_SETUP')).toBe(true);
    expect((await found(`${tag}%`)).applications.items).toEqual([]);
  });

  it('caps each type at the limit and keeps the total', async () => {
    const one = AdminSearchResult.parse((await search(tag, 1)).body);
    expect(one.applications.items).toHaveLength(1);
    expect(one.applications.total).toBe(2);
  });

  it('refuses one character, more than 100, and anyone but a Super Admin', async () => {
    expect((await search('a')).status).toBe(400);
    expect((await search('x'.repeat(101))).status).toBe(400);
    expect((await search(tag, 51)).status).toBe(400);
    expect((await search(tag, 5, team.email)).status).toBe(403);
  });
});
