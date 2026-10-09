// Shared setup of the invoice e2e tests (R7 step 7): two firms, their people and clients, and the
// API on a free port. Each test file calls `startInvoiceApp()` once, with its own run id.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { expect, inject } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { z } from 'zod';
import {
  FirmInvoicePayment,
  Invoice as InvoiceShape,
  InvoiceLine,
  InvoiceListItem,
  InvoiceRefund,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import {
  STRIPE_GATEWAY,
  STRIPE_WEBHOOK_SECRET,
  type StripeGateway,
} from '../../src/payments/stripe/stripe-gateway.js';

/** The webhook signing secret of the test apps that get a fake Stripe. */
export const TEST_WEBHOOK_SECRET = 'whsec_testsecret0001';

// Strict copies of the contract's shapes: a leaked field fails the parse.
const Item = z.strictObject({
  ...InvoiceListItem.shape,
  client: z.strictObject(InvoiceListItem.shape.client.shape),
});
export const Invoice = z.strictObject({
  ...InvoiceShape.shape,
  client: Item.shape.client,
  lines: z.array(z.strictObject(InvoiceLine.shape)),
  payments: z.array(
    z.strictObject({
      ...FirmInvoicePayment.shape,
      refunds: z.array(z.strictObject(InvoiceRefund.shape)),
    }),
  ),
  createdBy: z.strictObject({ userId: z.uuid(), name: z.string() }).nullable(),
});
export type Invoice = z.infer<typeof Invoice>;
export const InvoiceList = z.strictObject({
  items: z.array(Item),
  nextCursor: z.string().nullable(),
  paymentsEnabled: z.boolean(),
});

export const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
export const expectOk = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res;
};
/** A calendar date `n` days from today in New York (the test firm's time zone). */
export const nyDay = (n = 0) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
    new Date(Date.now() + n * 86_400_000),
  );

/**
 * `stripe`: the Stripe the API talks to (a `FakeStripeGateway`); left out, the environment's (none
 * in tests: payments answer 503).
 */
export async function startInvoiceApp(tag: string, stripe?: StripeGateway | null) {
  const fx = inject('fixtures');
  const run = randomUUID().slice(0, 8);
  const person = (key: string) => ({ id: randomUUID(), email: `${tag}-${key}-${run}@r7.test` });
  const people = {
    ownerA: person('owner-a'),
    adminA: person('admin-a'),
    staffA: person('staff-a'),
    primary: person('primary'),
    spouse: person('spouse'),
    other: person('other'),
    ownerB: person('owner-b'),
    clientB: person('client-b'),
  };
  const ids = {
    firmA: '',
    firmB: '',
    slugA: `${tag}-a-${run}`,
    slugB: `${tag}-b-${run}`,
    one: '',
    two: '',
    old: '',
    clientB: '',
    engagementOne: '',
    engagementTwo: '',
  };
  const ownerUrl = testDatabaseUrls('test_api').owner;
  const owner = createPrismaClient(ownerUrl);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      const pool = ['primary', 'spouse', 'other', 'clientB'].includes(key) ? 'CLIENT' : 'STAFF';
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool, email: p.email, name: `Fake ${tag} ${key}` },
      });
    }
    for (const [key, slug] of [
      ['firmA', ids.slugA],
      ['firmB', ids.slugB],
    ] as const) {
      ids[key] = (await tx.business.create({ data: { slug, name: slug, status: 'ACTIVE' } })).id;
    }
    // Firm A takes card payments; firm B has no Stripe account.
    await tx.stripeAccount.create({
      data: {
        businessId: ids.firmA,
        accountId: `acct_${run}A`,
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        onboardingStatus: 'COMPLETE',
      },
    });
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const A = { businessId: ids.firmA };
    await tx.businessSettings.create({ data: { ...A, timezone: 'America/New_York' } });
    for (const [userId, role] of [
      [people.ownerA.id, 'OWNER'],
      [people.adminA.id, 'ADMIN'],
      [people.staffA.id, 'STAFF'],
    ] as const) {
      await tx.membership.create({ data: { ...A, userId, role, status: 'ACTIVE' } });
    }
    const client = async (displayName: string, extra: object = {}) =>
      (await tx.client.create({ data: { ...A, displayName, ...extra } })).id;
    ids.one = await client(`Alpha ${run}`, { assignedUserId: people.staffA.id });
    ids.two = await client(`Bravo ${run}`);
    ids.old = await client(`Old ${run}`, { archivedAt: new Date() });
    for (const [p, clientId, portalRole] of [
      [people.primary, ids.one, 'PRIMARY'],
      [people.spouse, ids.one, 'SPOUSE'],
      [people.other, ids.two, 'PRIMARY'],
    ] as const) {
      await tx.clientAccount.create({
        data: { ...A, userId: p.id, clientId, email: p.email, portalRole, status: 'ACTIVE' },
      });
    }
    const service = await tx.service.create({
      data: { ...A, kind: 'ANNUAL_TAX', name: `Tax ${run}` },
    });
    const engagement = async (clientId: string) =>
      (
        await tx.engagement.create({
          data: { ...A, clientId, serviceId: service.id, title: '2025 Tax Return' },
        })
      ).id;
    ids.engagementOne = await engagement(ids.one);
    ids.engagementTwo = await engagement(ids.two);
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    const B = { businessId: ids.firmB };
    await tx.membership.create({
      data: { ...B, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    });
    ids.clientB = (await tx.client.create({ data: { ...B, displayName: `Bravo B ${run}` } })).id;
    await tx.clientAccount.create({
      data: {
        ...B,
        userId: people.clientB.id,
        clientId: ids.clientB,
        email: people.clientB.email,
        status: 'ACTIVE',
      },
    });
  });
  await owner.$disconnect();

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const builder = Test.createTestingModule({ imports: [AppModule.forRoot(env)] });
  if (stripe !== undefined) {
    builder.overrideProvider(STRIPE_GATEWAY).useValue(stripe);
    builder.overrideProvider(STRIPE_WEBHOOK_SECRET).useValue(TEST_WEBHOOK_SECRET);
  }
  const moduleRef = await builder.compile();
  const app: INestApplication = moduleRef.createNestApplication<NestExpressApplication>({
    logger: false,
    rawBody: true,
  });
  configureApp(app as NestExpressApplication, env);
  await app.listen(0, '127.0.0.1');

  const tokens = new Map<string, string>();
  const tokenFor = async (email: string) => {
    const cached = tokens.get(email);
    if (cached) return cached;
    const res = await request(app.getHttpServer())
      .post('/api/v1/dev/token')
      .send({ email })
      .expect(200);
    const token = (res.body as { token: string }).token;
    tokens.set(email, token);
    return token;
  };

  type Method = 'get' | 'post' | 'put';
  const firm = async (
    method: Method,
    path: string,
    who: { email: string },
    body?: object,
    businessId = ids.firmA,
  ): Promise<Response> => {
    const req = request(app.getHttpServer())
      [method](`/api/v1/business/invoices${path}`)
      .set('x-business-id', businessId)
      .set('authorization', `Bearer ${await tokenFor(who.email)}`);
    return body === undefined ? req : req.send(body);
  };
  const portal = async (
    method: Method,
    path: string,
    who: { email: string },
    body?: object,
    slug = ids.slugA,
  ): Promise<Response> => {
    const req = request(app.getHttpServer())
      [method](`/api/v1/portal/${slug}/me/invoices${path}`)
      .set('authorization', `Bearer ${await tokenFor(who.email)}`);
    return body === undefined ? req : req.send(body);
  };
  const inScope = async <T>(businessId: string, fn: (tx: TxClient) => Promise<T>) => {
    const db = createPrismaClient(ownerUrl);
    try {
      return await runInScope(db, { kind: 'business', businessId }, fn);
    } finally {
      await db.$disconnect();
    }
  };
  let seq = 0;
  /**
   * An invoice for `clientId` in firm A, written straight to the database (the database computes
   * its amounts), then read back through the API with the strict shape.
   */
  const draft = async (
    clientId: string,
    extra: { lines?: { description: string; unitAmountCents: number }[]; status?: 'OPEN' } = {},
  ) => {
    const id = await inScope(ids.firmA, async (tx) => {
      const invoice = await tx.invoice.create({
        data: {
          businessId: ids.firmA,
          clientId,
          number: `INV-${run}-${String(++seq).padStart(4, '0')}`,
          dueOn: new Date(`${nyDay(30)}T00:00:00.000Z`),
          createdByUserId: people.ownerA.id,
        },
      });
      await tx.invoiceLine.createMany({
        data: (extra.lines ?? [{ description: 'Tax return', unitAmountCents: 50_000 }]).map(
          (l, sortOrder) => ({ businessId: ids.firmA, invoiceId: invoice.id, ...l, sortOrder }),
        ),
      });
      if (extra.status === 'OPEN') {
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { status: 'OPEN', issuedAt: new Date() },
        });
      }
      return invoice.id;
    });
    return Invoice.parse(expectOk(await firm('get', `/${id}`, people.ownerA)).body);
  };

  return { app, run, people, ids, firm, portal, inScope, draft, appUrl: fx.appUrl };
}
