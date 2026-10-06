import { randomUUID } from 'node:crypto';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

/** Every suite owns its synthetic firms so parallel endpoint tests never change each other's rows. */
export async function firmFixtures(
  tag: string,
  configureModule?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
) {
  const urls = testDatabaseUrls('test_api');
  const owner = createPrismaClient(urls.owner);
  const stamp = `${tag}-${randomUUID().slice(0, 8)}`;
  const people = [
    'ownerA',
    'adminA',
    'staffA',
    'clientA',
    'otherClientA',
    'ownerB',
    'clientB',
    'superAdmin',
  ] as const;
  const users = Object.fromEntries(
    people.map((key) => [key, { id: randomUUID(), email: `${key.toLowerCase()}@${stamp}.test` }]),
  ) as Record<(typeof people)[number], { id: string; email: string }>;
  const firms = await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const key of people)
      await tx.user.create({
        data: {
          ...users[key],
          cognitoSub: users[key].id,
          name: `Synthetic ${key}`,
          pool:
            key === 'superAdmin'
              ? 'ADMIN'
              : key.toLowerCase().includes('client')
                ? 'CLIENT'
                : 'STAFF',
        },
      });
    await tx.platformAdmin.create({ data: { userId: users.superAdmin.id } });
    const make = (letter: string) =>
      tx.business.create({
        data: { name: `Synthetic ${letter}`, slug: `${stamp}-${letter}`, status: 'ACTIVE' },
        select: { id: true, slug: true },
      });
    return { firmA: await make('a'), firmB: await make('b') };
  });
  for (const [firm, keys] of [
    [firms.firmA, ['ownerA', 'adminA', 'staffA', 'clientA', 'otherClientA']],
    [firms.firmB, ['ownerB', 'clientB']],
  ] as const) {
    await runInScope(owner, { kind: 'business', businessId: firm.id }, async (tx) => {
      await tx.businessSettings.create({
        data: {
          businessId: firm.id,
          contactEmail: 'contact@synthetic.test',
          enabledModules: ['documents', 'messages', 'appointments', 'invoices', 'intake'],
        },
      });
      for (const key of keys) {
        if (key.toLowerCase().includes('client')) {
          const client = await tx.client.create({
            data: {
              businessId: firm.id,
              displayName: `Synthetic ${key}`,
              accountType: key === 'otherClientA' ? 'INDIVIDUAL' : 'BUSINESS',
            },
          });
          await tx.clientAccount.create({
            data: {
              businessId: firm.id,
              userId: users[key].id,
              email: users[key].email,
              status: 'ACTIVE',
              accountType: client.accountType,
              clientId: client.id,
            },
          });
        } else
          await tx.membership.create({
            data: {
              businessId: firm.id,
              userId: users[key].id,
              role: key.startsWith('owner') ? 'OWNER' : key.startsWith('admin') ? 'ADMIN' : 'STAFF',
              status: 'ACTIVE',
            },
          });
      }
    });
  }
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: urls.app,
  });
  const builder = Test.createTestingModule({ imports: [AppModule.forRoot(env)] });
  const moduleRef = await (configureModule ? configureModule(builder) : builder).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  try {
    configureApp(app, env);
    await app.listen(0, '127.0.0.1');
  } catch (error) {
    await app.close();
    await owner.$disconnect();
    throw error;
  }
  return {
    ...firms,
    users,
    owner,
    app,
    token: async (key: (typeof people)[number]) => tokenFor(app, users[key].email),
    close: async () => {
      await app.close();
      await owner.$disconnect();
    },
  };
}
async function tokenFor(app: INestApplication, email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .send({ email })
    .expect(200);
  return (res.body as { token: string }).token;
}
