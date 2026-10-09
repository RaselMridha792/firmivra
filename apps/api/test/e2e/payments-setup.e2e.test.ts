// Settings > Payments (R7): the firm's Stripe Connect account. GET /business/payments/setup,
// POST .../onboarding and .../onboarding/refresh (the Owner connects through Stripe's onboarding),
// and StripeAccountsWriter (the only writer of `stripe_accounts`, platform scope) on the app's role.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { z } from 'zod';
import { PaymentsSetup, StripeOnboardingLink } from '@firmivra/types';
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
  ownerC: person('owner-c'),
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
    [ids.firmC, [[people.ownerC, 'OWNER']]],
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
  route: '' | '/onboarding' | '/onboarding/refresh' = '',
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
  const url = `/api/v1/business/payments/setup${route}`;
  const req = (
    route ? request(app.getHttpServer()).post(url) : request(app.getHttpServer()).get(url)
  )
    .set('x-business-id', businessId)
    .set('authorization', `Bearer ${token}`);
  return route ? req.send({}) : req;
}
const post = (
  who: { email: string },
  route: '/onboarding' | '/onboarding/refresh',
  businessId = ids.firmA,
) => call(app, who, businessId, route);
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;

let app: INestApplication;
let off: INestApplication;
const fake = new FakeStripeGateway();
beforeAll(async () => {
  await seed();
  app = await startApp(fake);
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

const Link = z.strictObject(StripeOnboardingLink.shape);
const auditCount = async (businessId: string, action: string) => {
  const db = createPrismaClient(testDatabaseUrls('test_api').owner);
  try {
    return await runInScope(db, { kind: 'business', businessId }, (tx) =>
      tx.auditLog.count({ where: { businessId, action } }),
    );
  } finally {
    await db.$disconnect();
  }
};

describe('POST .../onboarding and .../onboarding/refresh', () => {
  it('lets only the Owner connect (Admin and Staff 403)', async () => {
    for (const who of [people.adminA, people.staffA]) {
      for (const route of ['/onboarding', '/onboarding/refresh'] as const) {
        const res = await post(who, route);
        expect([res.status, codeOf(res)]).toEqual([403, 'FORBIDDEN']);
      }
    }
  });

  it('answers 503 on both routes without a Stripe key', async () => {
    for (const route of ['/onboarding', '/onboarding/refresh'] as const) {
      const res = await call(off, people.ownerA, ids.firmA, route);
      expect([res.status, codeOf(res)]).toEqual([503, 'PAYMENT_PROVIDER_UNAVAILABLE']);
    }
  });

  it('refresh before any start is 409 PAYMENTS_NOT_SET_UP', async () => {
    const res = await post(people.ownerA, '/onboarding/refresh');
    expect([res.status, codeOf(res)]).toEqual([409, 'PAYMENTS_NOT_SET_UP']);
  });

  it('makes one account and one row for two clicks at once, then links to Stripe', async () => {
    fake.delayMs = 150;
    const [one, two] = await Promise.all([
      post(people.ownerA, '/onboarding'),
      post(people.ownerA, '/onboarding'),
    ]);
    fake.delayMs = 0;
    for (const res of [one, two]) {
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(new URL(Link.parse(res.body).url).host).toBe('connect.stripe.com');
    }
    const creates = fake.calls.filter(
      (c) => c.method === 'createAccount' && JSON.stringify(c.params).includes(ids.firmA),
    );
    expect(creates).toHaveLength(1);
    expect(creates[0]!.params).toMatchObject({
      businessId: ids.firmA,
      idempotencyKey: `fv-connect-${ids.firmA}`,
    });
    const link = fake.calls.filter((c) => c.method === 'createAccountLink').at(-1)!;
    const base = process.env.APP_BASE_URL!.replace(/\/$/, '');
    expect(link.params).toMatchObject({
      returnUrl: `${base}/settings/payments?stripe=return`,
      refreshUrl: `${base}/settings/payments?stripe=refresh`,
    });
    const setup = Setup.parse((await call(app, people.ownerA)).body);
    expect(setup).toMatchObject({
      connected: true,
      onboardingStatus: 'PENDING',
      requirementsDue: true,
    });
    expect(await auditCount(ids.firmA, 'payments.stripe_account_created')).toBe(1);
    expect(await auditCount(ids.firmA, 'payments.onboarding_link_created')).toBe(2);
  });

  it("refresh stores Stripe's state and gives a new link; COMPLETE is 409 PAYMENTS_ALREADY_SET_UP", async () => {
    const db = createPrismaClient(testDatabaseUrls('test_api').owner);
    const { accountId } = await runInScope(db, { kind: 'platform' }, (tx) =>
      tx.stripeAccount.findUniqueOrThrow({ where: { businessId: ids.firmA } }),
    );
    await db.$disconnect();
    expect(
      Link.parse(expectOk(await post(people.ownerA, '/onboarding/refresh')).body).url,
    ).toContain(accountId);
    fake.update(accountId, {
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
    });
    const done = await post(people.ownerA, '/onboarding/refresh');
    expect([done.status, codeOf(done)]).toEqual([409, 'PAYMENTS_ALREADY_SET_UP']);
    expect(Setup.parse((await call(app, people.ownerA)).body)).toMatchObject({
      onboardingStatus: 'COMPLETE',
      chargesEnabled: true,
    });
    const again = await post(people.ownerA, '/onboarding');
    expect([again.status, codeOf(again)]).toEqual([409, 'PAYMENTS_ALREADY_SET_UP']);
  });

  it("keeps firms apart: B's Owner gets 404 on firm A, and B's finished account is its own", async () => {
    expect((await post(people.ownerB, '/onboarding', ids.firmA)).status).toBe(404);
    const res = await post(people.ownerB, '/onboarding');
    expect(res.status).toBe(404);
    const b = await post(people.ownerB, '/onboarding', ids.firmB);
    expect([b.status, codeOf(b)]).toEqual([409, 'PAYMENTS_ALREADY_SET_UP']);
  });

  it('writes nothing when Stripe does not answer (503)', async () => {
    fake.down = true;
    const res = await post(people.ownerC, '/onboarding', ids.firmC);
    fake.down = false;
    expect([res.status, codeOf(res)]).toEqual([503, 'PAYMENT_PROVIDER_UNAVAILABLE']);
    expect(Setup.parse((await call(app, people.ownerC, ids.firmC)).body).connected).toBe(false);
  });
});

const expectOk = (res: Response) => {
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res;
};

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

  it("makes the firm's first account once; a second ensure finds it and asks Stripe nothing", async () => {
    const writer = app.get(StripeAccountsWriter);
    const account = (id: string) => async () => ({
      id,
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      requirements: { currently_due: ['x'], past_due: [], disabled_reason: null },
    });
    const first = await writer.ensure(ids.firmC, account(accountC));
    expect(first.created).toBe(true);
    let asked = false;
    const second = await writer.ensure(ids.firmC, async () => {
      asked = true;
      return account(`acct_${run}C2`)();
    });
    expect([second.created, second.row.accountId, asked]).toEqual([false, accountC, false]);
    expect(await rowOf(ids.firmC)).toEqual([
      expect.objectContaining({ businessId: ids.firmC, accountId: accountC, ...pending }),
    ]);
  });

  it("updates the firm's own account only", async () => {
    const writer = app.get(StripeAccountsWriter);
    await writer.update(ids.firmC, accountC, { ...pending, detailsSubmitted: true });
    expect((await rowOf(ids.firmC))[0]).toMatchObject({ detailsSubmitted: true });
    // Firm A naming firm B's account changes nothing.
    await expect(writer.update(ids.firmA, `acct_${run}B`, pending)).rejects.toThrow();
    expect((await rowOf(ids.firmB))[0]).toMatchObject(complete);
    expect((await rowOf(ids.firmA)).map((r) => r.accountId)).not.toContain(`acct_${run}B`);
  });

  it('finds the firm by its acct_ id, and answers null for an unknown one', async () => {
    const writer = app.get(StripeAccountsWriter);
    expect(await writer.updateByAccountId(accountC, complete)).toBe(ids.firmC);
    expect((await rowOf(ids.firmC))[0]).toMatchObject(complete);
    expect(await writer.updateByAccountId(`acct_${run}unknown`, complete)).toBeNull();
    expect((await rowOf(ids.firmA)).map((r) => r.accountId)).not.toContain(accountC);
  });
});
