// Settings > Payments (R7): GET /business/payments/setup, the firm's Stripe Connect account, and
// StripeAccountsWriter (the only writer of `stripe_accounts`, platform scope) on the app's role.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { z } from 'zod';
import { PaymentsSetup } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { FakeStripeGateway } from '../../src/payments/stripe/fake-stripe.js';
import { STRIPE_GATEWAY, type StripeGateway } from '../../src/payments/stripe/stripe-gateway.js';
import { StripeAccountsWriter } from '../../src/payments/stripe/stripe-accounts.js';

const Setup = z.strictObject(PaymentsSetup.shape);
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `setup-${key}-${run}@r7.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  ownerB: person('owner-b'),
};
const ids = { firmA: '', firmB: '', firmC: '' };

async function seed() {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const p of Object.values(people)) {
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: 'Fake person' },
      });
    }
    ids.firmA = (
      await tx.business.create({ data: { slug: `setup-a-${run}`, name: 'A', status: 'ACTIVE' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: `setup-b-${run}`, name: 'B', status: 'ACTIVE' } })
    ).id;
    ids.firmC = (
      await tx.business.create({ data: { slug: `setup-c-${run}`, name: 'C', status: 'ACTIVE' } })
    ).id;
    // Firm B has finished Stripe; firms A and C have not started (C is for the writer's tests).
    await tx.stripeAccount.create({
      data: {
        businessId: ids.firmB,
        accountId: `acct_${run}B`,
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        onboardingStatus: 'COMPLETE',
      },
    });
  });
  for (const [businessId, members] of [
    [
      ids.firmA,
      [
        [people.ownerA, 'OWNER'],
        [people.adminA, 'ADMIN'],
        [people.staffA, 'STAFF'],
      ],
    ],
    [ids.firmB, [[people.ownerB, 'OWNER']]],
  ] as const) {
    await runInScope(owner, { kind: 'business', businessId }, async (tx) => {
      for (const [p, role] of members) {
        await tx.membership.create({ data: { businessId, userId: p.id, role, status: 'ACTIVE' } });
      }
    });
  }
  await owner.$disconnect();
}

async function startApp(stripe: StripeGateway | null) {
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: inject('fixtures').appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(STRIPE_GATEWAY)
    .useValue(stripe)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app, env);
  await app.init();
  return app as INestApplication;
}

const tokens = new Map<string, string>();
async function call(
  app: INestApplication,
  who: { email: string },
  businessId = ids.firmA,
): Promise<Response> {
  let token = tokens.get(who.email);
  if (!token) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/dev/token')
      .send({ email: who.email })
      .expect(200);
    token = (res.body as { token: string }).token;
    tokens.set(who.email, token);
  }
  return request(app.getHttpServer())
    .get('/api/v1/business/payments/setup')
    .set('x-business-id', businessId)
    .set('authorization', `Bearer ${token}`);
}
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;

let app: INestApplication;
let off: INestApplication;
beforeAll(async () => {
  await seed();
  app = await startApp(new FakeStripeGateway());
  off = await startApp(null);
});
afterAll(async () => {
  await app?.close();
  await off?.close();
});

describe('GET /business/payments/setup', () => {
  it('answers not connected to the Owner and an Admin of a firm that has not started', async () => {
    for (const who of [people.ownerA, people.adminA]) {
      const res = await call(app, who);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(Setup.parse(res.body)).toEqual({
        connected: false,
        onboardingStatus: null,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        requirementsDue: false,
        updatedAt: null,
      });
    }
  });

  it("answers the firm's own row only", async () => {
    const res = await call(app, people.ownerB, ids.firmB);
    expect(res.status).toBe(200);
    expect(Setup.parse(res.body)).toMatchObject({
      connected: true,
      onboardingStatus: 'COMPLETE',
      chargesEnabled: true,
      requirementsDue: false,
    });
    // Firm A's Owner asking for firm B gets 404 (no membership); firm A still reads not connected.
    expect((await call(app, people.ownerA, ids.firmB)).status).toBe(404);
    expect(Setup.parse((await call(app, people.ownerA)).body).connected).toBe(false);
  });

  it('refuses Staff with 403', async () => {
    const res = await call(app, people.staffA);
    expect(res.status).toBe(403);
    expect(codeOf(res)).toBe('FORBIDDEN');
  });

  it('answers 503 PAYMENT_PROVIDER_UNAVAILABLE without a Stripe key', async () => {
    const res = await call(off, people.ownerA);
    expect(res.status).toBe(503);
    expect(codeOf(res)).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
  });
});

describe('StripeAccountsWriter', () => {
  const pending = {
    onboardingStatus: 'PENDING',
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: false,
  } as const;
  const complete = {
    onboardingStatus: 'COMPLETE',
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  } as const;
  const accountC = `acct_${run}C`;
  // The owner client bypasses the RLS, so every read names the firm.
  const rowOf = async (businessId: string) => {
    const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
    try {
      return await owner.stripeAccount.findMany({ where: { businessId } });
    } finally {
      await owner.$disconnect();
    }
  };

  it("inserts the firm's first account, and refuses a second one", async () => {
    const writer = app.get(StripeAccountsWriter);
    await writer.insert(ids.firmC, accountC, pending);
    expect(await rowOf(ids.firmC)).toEqual([
      expect.objectContaining({ businessId: ids.firmC, accountId: accountC, ...pending }),
    ]);
    await expect(writer.insert(ids.firmC, `acct_${run}C2`, pending)).rejects.toThrow();
    expect(await rowOf(ids.firmC)).toHaveLength(1);
  });

  it("updates the firm's own account only", async () => {
    const writer = app.get(StripeAccountsWriter);
    await writer.update(ids.firmC, accountC, { ...pending, detailsSubmitted: true });
    expect((await rowOf(ids.firmC))[0]).toMatchObject({ detailsSubmitted: true });
    // Firm A naming firm B's account changes nothing.
    await expect(writer.update(ids.firmA, `acct_${run}B`, pending)).rejects.toThrow();
    expect((await rowOf(ids.firmB))[0]).toMatchObject(complete);
    expect(await rowOf(ids.firmA)).toEqual([]);
  });

  it('finds the firm by its acct_ id, and answers null for an unknown one', async () => {
    const writer = app.get(StripeAccountsWriter);
    expect(await writer.updateByAccountId(accountC, complete)).toBe(ids.firmC);
    expect((await rowOf(ids.firmC))[0]).toMatchObject(complete);
    expect(await writer.updateByAccountId(`acct_${run}unknown`, complete)).toBeNull();
    expect(await rowOf(ids.firmA)).toEqual([]);
  });
});
