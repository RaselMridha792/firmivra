// End-to-end: Settings > Billing & Subscriptions, the firm's side (R60; Octavia's Billing guide of
// Oct 18). The firm reads its own subscription, usage, issued invoices (never a draft), their PDF
// and its billing profile; a plan change or a new billing contact is a support ticket for the
// Super Admin team, refused when the plan does not fit today's usage. Owner and Admin only; one
// firm never sees another's invoices or requests; audit entries carry no emails or values.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  BillingInvoiceDetail,
  FirmBillingInvoice,
  FirmBillingInvoicePage,
  FirmBillingOverview,
  FirmBillingRequest,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE } from '../../src/notify/notify.types.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const RUN = run.toUpperCase();
const person = (key: string) => ({ id: randomUUID(), email: `r60bl-${key}-${run}@r60bl.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  invitedA: person('invited-a'),
  ownerB: person('owner-b'),
};
const firms = {} as Record<'a' | 'b', { id: string }>;
const plans = {} as Record<'small' | 'mid' | 'big', { id: string; code: string }>;

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.68.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

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
  method: 'get' | 'post',
  path: string,
  who: { email: string },
  businessId?: string,
  body?: object,
): Promise<Response> {
  let req = request(app.getHttpServer())
    [method](`/api/v1${path}`)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`)
    .set('x-forwarded-for', viewer());
  if (businessId) req = req.set('x-business-id', businessId);
  return body === undefined ? req : req.send(body);
}
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};

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

const t0 = new Date().toISOString().slice(0, 10);
const plus = (days: number) => {
  const d = new Date(`${t0}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const admin = fx.users.admin;
const newInvoice = async (over: Record<string, unknown>) =>
  BillingInvoiceDetail.parse(
    ok(
      await call('post', '/admin/billing/invoices', admin, undefined, {
        firmId: firms.a.id,
        issueDate: t0,
        dueDate: plus(30),
        lines: [{ description: 'Fake Mid plan', quantity: 1, rateCents: 11_400 }],
        ...over,
      }),
      201,
    ),
  );

const overviewOf = async (who: { email: string }, businessId: string) =>
  FirmBillingOverview.parse(ok(await call('get', '/business/billing', who, businessId)));

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people))
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake ${key}` },
      });
    for (const key of ['a', 'b'] as const)
      firms[key] = await tx.business.create({
        data: { slug: `r60bl-${key}-${run}`, name: `Fake Billing Firm ${key}`, status: 'ACTIVE' },
        select: { id: true },
      });
    const plan = (key: keyof typeof plans, data: Record<string, unknown>) =>
      tx.platformPlan.create({
        data: {
          code: `R60BL_${key.toUpperCase()}_${RUN}`,
          name: `Fake ${key[0]!.toUpperCase()}${key.slice(1)} ${run}`,
          billingCycle: 'MONTHLY',
          ...(data as {
            basePriceCents: number;
            includedSeats: number;
            displayOrder: number;
          }),
        },
        select: { id: true, code: true },
      });
    plans.small = await plan('small', {
      basePriceCents: 4_900,
      includedSeats: 2,
      maxSeats: 2,
      overagePriceCentsPerSeat: null,
      includedLocations: 1,
      displayOrder: 5_001,
    });
    plans.mid = await plan('mid', {
      basePriceCents: 9_900,
      includedSeats: 5,
      overagePriceCentsPerSeat: 1_500,
      includedLocations: 2,
      overagePriceCentsPerLocation: 2_500,
      displayOrder: 5_002,
    });
    plans.big = await plan('big', {
      basePriceCents: 19_900,
      includedSeats: 10,
      overagePriceCentsPerSeat: 1_500,
      includedLocations: 3,
      overagePriceCentsPerLocation: 2_500,
      displayOrder: 5_003,
    });
    await tx.platformPlanFeature.createMany({
      data: [
        { planId: plans.mid.id, featureKey: 'portal', label: 'Client portal' },
        { planId: plans.mid.id, featureKey: 'esign', label: 'Firm Sign' },
      ],
    });
    await tx.platformFirmSubscription.create({
      data: {
        businessId: firms.a.id,
        planId: plans.mid.id,
        status: 'ACTIVE',
        billingCycle: 'MONTHLY',
        seatsIncluded: 5,
        seatsPurchased: 1,
        locationsIncluded: 2,
        currentPeriodStart: new Date(`${plus(-10)}T00:00:00Z`),
        currentPeriodEnd: new Date(`${plus(20)}T00:00:00Z`),
        nextBillingDate: new Date(`${plus(21)}T00:00:00Z`),
      },
    });
    await tx.platformFirmBillingProfile.create({
      data: {
        businessId: firms.a.id,
        billingContactName: 'Fake Billing Contact',
        billingContactEmail: `billing-${run}@r60bl.test`,
        paymentTermDays: 30,
      },
    });
  });
  for (const [businessId, userId, role, status] of [
    [firms.a.id, people.ownerA.id, 'OWNER', 'ACTIVE'],
    [firms.a.id, people.adminA.id, 'ADMIN', 'ACTIVE'],
    [firms.a.id, people.staffA.id, 'STAFF', 'ACTIVE'],
    [firms.a.id, people.invitedA.id, 'STAFF', 'INVITED'],
    [firms.b.id, people.ownerB.id, 'OWNER', 'ACTIVE'],
  ] as const)
    await asOwner({ kind: 'business', businessId }, (tx) =>
      tx.membership.create({ data: { businessId, userId, role, status } }),
    );
  await asOwner({ kind: 'business', businessId: firms.a.id }, (tx) =>
    tx.businessSettings.create({
      data: {
        businessId: firms.a.id,
        addressLine1: '100 Sample Road',
        city: 'Springfield',
        state: 'GA',
        postalCode: '30000',
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
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({ send: () => Promise.resolve() })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('GET /business/billing', () => {
  it('the plan, its price, the usage, the billing details and the plans with what blocks them', async () => {
    const view = await overviewOf(people.ownerA, firms.a.id);
    expect(view.subscription).toMatchObject({
      status: 'ACTIVE',
      plan: {
        code: plans.mid.code,
        priceCents: 9_900,
        features: [
          // Added together: the key breaks the tie.
          { key: 'esign', label: 'Firm Sign' },
          { key: 'portal', label: 'Client portal' },
        ],
      },
      billingCycle: 'MONTHLY',
      // The base price and one extra seat at $15.
      priceCents: 11_400,
      seatsAllowed: 6,
      locationsAllowed: 2,
      periodStart: plus(-10),
      periodEnd: plus(20),
      nextBillingOn: plus(21),
      accessEndsOn: null,
      autoRenew: true,
    });
    expect(view.usage).toMatchObject({
      seats: { used: 3, allowed: 6 },
      locations: { used: 0, allowed: 2 },
      pendingInvitations: 1,
    });
    expect(view.billingDetails).toEqual({
      companyName: 'Fake Billing Firm a',
      legalName: null,
      contactName: 'Fake Billing Contact',
      contactEmail: `billing-${run}@r60bl.test`,
      address: ['100 Sample Road', 'Springfield, GA 30000', 'United States'],
      paymentTermDays: 30,
    });
    const choice = (key: keyof typeof plans) => view.plans.find((p) => p.code === plans[key].code)!;
    expect(choice('small')).toMatchObject({
      direction: 'DOWNGRADE',
      blockers: [`3 active staff users; Fake Small ${run} allows 2`],
    });
    expect(choice('mid')).toMatchObject({ direction: 'CURRENT', blockers: [] });
    expect(choice('big')).toMatchObject({ direction: 'UPGRADE', blockers: [] });
    expect(view.requests).toEqual([]);
    // The Admin reads the same; Staff are refused.
    expect((await overviewOf(people.adminA, firms.a.id)).subscription?.plan.code).toBe(
      plans.mid.code,
    );
    const staff = await call('get', '/business/billing', people.staffA, firms.a.id);
    expect([staff.status, codeOf(staff)]).toEqual([403, 'FORBIDDEN']);
  });

  it('a firm with no subscription: no plan, no allowances, nothing of firm A', async () => {
    const view = await overviewOf(people.ownerB, firms.b.id);
    expect(view.subscription).toBeNull();
    expect(view.usage).toMatchObject({
      seats: { used: 1, allowed: null },
      locations: { used: 0, allowed: null },
    });
    expect(view.billingDetails).toMatchObject({
      contactName: null,
      contactEmail: null,
      address: [],
    });
    expect(view.lastPayment).toBeNull();
    const outsider = await call('get', '/business/billing', people.ownerB, firms.a.id);
    expect([outsider.status, codeOf(outsider)]).toEqual([404, 'NOT_FOUND']);
  });
});

describe('invoices', () => {
  let current: BillingInvoiceDetail;
  let older: BillingInvoiceDetail;
  let draft: BillingInvoiceDetail;

  beforeAll(async () => {
    draft = await newInvoice({});
    older = await newInvoice({
      issueDate: plus(-240),
      dueDate: plus(-210),
      send: true,
      emailFirm: false,
    });
    current = await newInvoice({ send: true, emailFirm: false });
    const paid = await call(
      'post',
      `/admin/billing/invoices/${current.id}/payments`,
      admin,
      undefined,
      {
        requestId: randomUUID(),
        amountCents: 11_400,
        paidOn: t0,
        method: 'CARD',
      },
    );
    expect([200, 201], JSON.stringify(paid.body)).toContain(paid.status);
  });

  it('lists the issued ones newest first, in the range, never a draft', async () => {
    const recent = FirmBillingInvoicePage.parse(
      ok(await call('get', '/business/billing/invoices', people.ownerA, firms.a.id)),
    );
    expect(recent.items.map((i) => i.id)).toEqual([current.id]);
    expect(recent.items[0]).toMatchObject({
      number: current.number,
      totalCents: 11_400,
      balanceCents: 0,
      status: 'PAID',
    });
    const all = FirmBillingInvoicePage.parse(
      ok(await call('get', '/business/billing/invoices?range=ALL', people.ownerA, firms.a.id)),
    );
    expect(all.items.map((i) => i.id)).toEqual([current.id, older.id]);
    expect(all.items[1]?.status).toBe('OVERDUE');
    expect(all.total).toBe(2);
    expect(JSON.stringify(all)).not.toContain(draft.id);
    const bad = await call('get', '/business/billing/invoices?range=2Y', people.ownerA, firms.a.id);
    expect([bad.status, codeOf(bad)]).toEqual([400, 'VALIDATION_FAILED']);
    // The latest payment shows on the page.
    expect((await overviewOf(people.ownerA, firms.a.id)).lastPayment).toEqual({
      method: 'CARD',
      amountCents: 11_400,
      paidOn: t0,
      invoiceNumber: current.number,
    });
  });

  it('opens one with its lines and payments; a draft and another firm are 404', async () => {
    const one = FirmBillingInvoice.parse(
      ok(await call('get', `/business/billing/invoices/${current.id}`, people.adminA, firms.a.id)),
    );
    expect(one).toMatchObject({
      lines: [
        { description: 'Fake Mid plan', quantity: 1, unitPriceCents: 11_400, amountCents: 11_400 },
      ],
      totalCents: 11_400,
      paidCents: 11_400,
      payments: [{ paidOn: t0, amountCents: 11_400, method: 'CARD' }],
    });
    for (const [who, firm, id] of [
      [people.ownerA, firms.a.id, draft.id],
      [people.ownerB, firms.b.id, current.id],
    ] as const) {
      const res = await call('get', `/business/billing/invoices/${id}`, who, firm);
      expect([res.status, codeOf(res)]).toEqual([404, 'NOT_FOUND']);
    }
  });

  it('downloads its PDF, audited with the number only', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/business/billing/invoices/${current.id}/pdf`)
      .set('authorization', `Bearer ${await tokenFor(people.ownerA.email)}`)
      .set('x-forwarded-for', viewer())
      .set('x-business-id', firms.a.id)
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => done(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="${current.number}.pdf"`);
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    const audits = await asOwner({ kind: 'business', businessId: firms.a.id }, (tx) =>
      tx.auditLog.findMany({
        where: { businessId: firms.a.id, action: 'billing.invoice_downloaded' },
      }),
    );
    expect(audits.map((a) => a.metadata)).toEqual([{ number: current.number }]);
    const outsider = await call(
      'get',
      `/business/billing/invoices/${current.id}/pdf`,
      people.ownerB,
      firms.b.id,
    );
    expect(outsider.status).toBe(404);
  });
});

describe('POST /business/billing/requests', () => {
  it('asks for a plan that fits: a Billing ticket in the queue, the same key answered once', async () => {
    const requestId = randomUUID();
    const body = {
      requestId,
      kind: 'PLAN_CHANGE',
      planCode: plans.big.code,
      billingCycle: 'MONTHLY',
    };
    const res = await call('post', '/business/billing/requests', people.ownerA, firms.a.id, body);
    expect(res.status).toBe(201);
    const made = FirmBillingRequest.parse(res.body);
    expect(made).toMatchObject({
      kind: 'PLAN_CHANGE',
      summary: `Plan change: Fake Mid ${run} to Fake Big ${run} (Monthly)`,
      status: 'OPEN',
      submittedBy: 'Fake ownerA',
    });
    const again = await call('post', '/business/billing/requests', people.ownerA, firms.a.id, body);
    expect(FirmBillingRequest.parse(again.body).id).toBe(made.id);
    const ticket = await asOwner({ kind: 'platform' }, (tx) =>
      tx.supportTicket.findUniqueOrThrow({ where: { id: made.id }, include: { category: true } }),
    );
    expect(ticket).toMatchObject({
      source: 'PORTAL',
      businessId: firms.a.id,
      assignedUserId: null,
    });
    expect(ticket.category.name).toBe('Billing & Payments');
    for (const line of [
      `from Fake Mid ${run} (Monthly) to Fake Big ${run} (Monthly)`,
      'Current price: $114.00 per month.',
      // Big at today's usage: 3 users and no locations fit what it includes.
      `Fake Big ${run} at today's usage (estimate): $199.00 per month.`,
      'Usage now: 3 active staff users, 0 active locations.',
    ])
      expect(ticket.description).toContain(line);
  });

  it('refuses a plan that does not fit, the current plan, an unknown one, and a firm with none', async () => {
    const ask = (who: { email: string }, firm: string, over: object) =>
      call('post', '/business/billing/requests', who, firm, {
        requestId: randomUUID(),
        kind: 'PLAN_CHANGE',
        billingCycle: 'MONTHLY',
        ...over,
      });
    const small = await ask(people.ownerA, firms.a.id, { planCode: plans.small.code });
    expect([small.status, codeOf(small)]).toEqual([409, 'PLAN_NOT_AVAILABLE']);
    expect((small.body as { error: { details: unknown } }).error.details).toEqual([
      { path: 'planCode', message: `3 active staff users; Fake Small ${run} allows 2` },
    ]);
    for (const over of [{ planCode: plans.mid.code }, { planCode: `NOPE_${RUN}` }]) {
      const res = await ask(people.ownerA, firms.a.id, over);
      expect([res.status, codeOf(res)], JSON.stringify(over)).toEqual([409, 'PLAN_NOT_AVAILABLE']);
    }
    // The current plan on the other cycle is a change.
    const annual = await ask(people.adminA, firms.a.id, {
      planCode: plans.mid.code,
      billingCycle: 'ANNUAL',
    });
    expect(annual.status).toBe(201);
    const none = await ask(people.ownerB, firms.b.id, { planCode: plans.big.code });
    expect([none.status, codeOf(none)]).toEqual([409, 'NO_SUBSCRIPTION']);
    const staff = await ask(people.staffA, firms.a.id, { planCode: plans.big.code });
    expect(staff.status).toBe(403);
  });

  it('asks for a new billing contact; the page lists the requests; the audit has no email', async () => {
    const empty = await call('post', '/business/billing/requests', people.ownerA, firms.a.id, {
      requestId: randomUUID(),
      kind: 'BILLING_CONTACT',
    });
    expect([empty.status, codeOf(empty)]).toEqual([400, 'VALIDATION_FAILED']);
    const res = await call('post', '/business/billing/requests', people.ownerA, firms.a.id, {
      requestId: randomUUID(),
      kind: 'BILLING_CONTACT',
      contactEmail: `new-billing-${run}@r60bl.test`,
    });
    expect(res.status).toBe(201);
    const contact = FirmBillingRequest.parse(res.body);
    expect(contact).toMatchObject({ kind: 'BILLING_CONTACT', summary: 'Billing contact change' });
    const ticket = await asOwner({ kind: 'platform' }, (tx) =>
      tx.supportTicket.findUniqueOrThrow({ where: { id: contact.id } }),
    );
    expect(ticket.description).toContain(
      `Billing contact email\nCurrent: billing-${run}@r60bl.test\nProposed: new-billing-${run}@r60bl.test`,
    );
    const view = await overviewOf(people.ownerA, firms.a.id);
    expect(view.requests.map((r) => r.kind)).toEqual([
      'BILLING_CONTACT',
      'PLAN_CHANGE',
      'PLAN_CHANGE',
    ]);
    expect((await overviewOf(people.ownerB, firms.b.id)).requests).toEqual([]);
    const audits = await asOwner({ kind: 'business', businessId: firms.a.id }, (tx) =>
      tx.auditLog.findMany({ where: { businessId: firms.a.id, action: 'billing.request_raised' } }),
    );
    expect(audits).toHaveLength(3);
    expect(JSON.stringify(audits)).not.toContain('r60bl.test');
  });
});
