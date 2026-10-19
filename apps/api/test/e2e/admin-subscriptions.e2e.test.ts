// End-to-end: R60, Super Admin Subscriptions on R0's stage A, B3 and the MRR rollup. Every route
// under /api/v1/admin/subscriptions: the plans, the KPI row, the table, the firms without a
// subscription, the detail panel, Add Subscription and Start Trial, plan, cycle, seat and location
// changes (prorated through Billing), the trial, Auto-Renew, suspension and reactivation, the
// negotiated price, the billing date, Close Account, notes and the export. Each change lands with
// its history or audit row; the subscription's recurring schedule follows it. Firms, plans and
// numbers are this run's own. A firm's session reaches none of it.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  previewSubscriptionChange,
  subscriptionAddDays,
  subscriptionAddMonths,
  subscriptionBillingDateCents,
  SubscriptionAvailableFirmList,
  SubscriptionMeta,
  SubscriptionNote,
  SubscriptionPage,
  SubscriptionRecord,
  SubscriptionResult,
  SubscriptionSummary,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE } from '../../src/notify/notify.types.js';

const fx = inject('fixtures');
const BASE = '/api/v1/admin/subscriptions';
const run = randomUUID().slice(0, 8);
const RUN = run.toUpperCase();
const today = new Date().toISOString().slice(0, 10);
const asDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

const FIRMS = [
  'trial',
  'paid',
  'seats',
  'inuse',
  'loc',
  'convert',
  'pending',
  'renew',
  'suspend',
  'pastdue',
  'close',
  'price',
  'date',
  'formula',
  'free',
] as const;
type FirmKey = (typeof FIRMS)[number];
const firms = {} as Record<FirmKey, { id: string; name: string }>;
const plans = { basic: '', pro: '', old: '' };
const subs = {} as Partial<Record<FirmKey, string>>;

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.69.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

async function owner<T>(
  scope: 'platform' | 'admin',
  work: Parameters<typeof runInScope<T>>[2],
): Promise<T> {
  const client = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(
      client,
      scope === 'admin' ? { kind: 'admin', adminUserId: fx.users.admin.id } : { kind: 'platform' },
      work,
    );
  } finally {
    await client.$disconnect();
  }
}

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

type Method = 'get' | 'post';
async function call(
  method: Method,
  path: string,
  body?: object,
  email = fx.users.admin.email,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`${BASE}${path}`)
    .set('authorization', `Bearer ${await tokenFor(email)}`)
    .set('x-forwarded-for', viewer());
  return body === undefined ? req : req.send(body);
}
const code = (res: Response) => (res.body as { error?: { code?: string } }).error?.code;
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};
const refused = (res: Response, status: number, errorCode: string) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(code(res)).toBe(errorCode);
};
const result = (res: Response, status = 200) => SubscriptionResult.parse(ok(res, status));
const detail = async (id: string) => SubscriptionRecord.parse(ok(await call('get', `/${id}`)));
const post = (id: string, action: string, body: object) => call('post', `/${id}/${action}`, body);

async function subscribe(key: FirmKey, over: Record<string, unknown> = {}) {
  const res = result(
    await call('post', '', {
      firmId: firms[key].id,
      mode: 'PAID',
      planId: plans.basic,
      billingCycle: 'MONTHLY',
      seats: 3,
      ...over,
    }),
    201,
  );
  subs[key] = res.subscription.id;
  return res;
}

/** Records a payment for every open invoice of the firm (Billing's job; here directly). */
async function payOpen(firmId: string) {
  await owner('platform', async (tx) => {
    const open = await tx.platformInvoice.findMany({
      where: { businessId: firmId, status: { in: ['SENT', 'PARTIALLY_PAID'] } },
    });
    for (const i of open)
      await tx.platformPayment.create({
        data: {
          businessId: firmId,
          invoiceId: i.id,
          amountCents: i.totalCents - i.paidCents - i.creditedCents,
          method: 'CHECK',
          status: 'COMPLETED',
          paidOn: asDate(today),
          idempotencyKey: randomUUID(),
          recordedByUserId: fx.users.admin.id,
        },
      });
  });
}

const schedulesOf = (subscriptionId: string) =>
  owner('admin', (tx) =>
    tx.platformRecurringInvoice.findMany({
      where: { subscriptionId },
      orderBy: { createdAt: 'asc' },
    }),
  );
const auditsOf = (subscriptionId: string) =>
  owner('admin', (tx) =>
    tx.auditLog.findMany({
      where: { businessId: null, entityType: 'subscription', entityId: subscriptionId },
      include: { investigationNotes: true },
      orderBy: { createdAt: 'asc' },
    }),
  );

beforeAll(async () => {
  await owner('platform', async (tx) => {
    for (const key of FIRMS) {
      const name = key === 'formula' ? `=Fake Formula ${run}` : `Fake Subs ${key} ${run}`;
      const row = await tx.business.create({
        data: {
          slug: `subs-${run}-${key}`,
          name,
          status: key === 'pending' ? 'PENDING_SETUP' : 'ACTIVE',
        },
        select: { id: true },
      });
      firms[key] = { id: row.id, name };
      await tx.platformFirmBillingProfile.create({
        data: {
          businessId: row.id,
          billingContactName: 'Fake Billing Contact',
          billingContactEmail: `billing-${run}-${key}@example.test`,
          paymentTermDays: 30,
          taxRateBps: 0,
        },
      });
    }
    await tx.firmApplication.create({
      data: {
        legalName: `Fake Subs paid ${run}`,
        contactName: 'Fake Applicant',
        contactEmail: `apply-${run}@example.test`,
        data: { business: { website: `https://www.fake-${run}.example.test` } },
        businessId: firms.paid.id,
      },
    });
    // The daily firm rollup counts four staff logins for this firm.
    await tx.platformFirmMetricsDaily.create({
      data: { day: asDate(today), businessId: firms.inuse.id, totalUsers: 4 },
    });
    // The MRR rollup's row for 30 days ago (the KPI row's "previous").
    const comparedWith = asDate(subscriptionAddDays(today, -30));
    await tx.platformMrrDaily.upsert({
      where: { day: comparedWith },
      create: {
        day: comparedWith,
        mrrCents: 123_400,
        activeCount: 7,
        trialCount: 3,
        pastDueCount: 1,
      },
      update: {},
    });
  });
  await owner('admin', async (tx) => {
    const plan = (code: string, data: Record<string, unknown>) =>
      tx.platformPlan.create({
        data: {
          code: `E2E_${code}_${RUN}`,
          name: `Fake ${code} ${run}`,
          basePriceCents: 10_000,
          includedSeats: 2,
          displayOrder: 900,
          ...data,
        },
        select: { id: true },
      });
    plans.basic = (
      await plan('BASIC', {
        maxSeats: 10,
        overagePriceCentsPerSeat: 2_000,
        features: { create: [{ featureKey: 'fake_portal', label: 'Fake portal' }] },
      })
    ).id;
    plans.pro = (
      await plan('PRO', {
        basePriceCents: 30_000,
        includedSeats: 3,
        maxSeats: 20,
        overagePriceCentsPerSeat: 2_500,
        overagePriceCentsPerLocation: 5_000,
        displayOrder: 901,
      })
    ).id;
    plans.old = (await plan('OLD', { isActive: false, displayOrder: 899 })).id;
  });
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
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

describe('who may call', () => {
  it('a firm Owner’s session gets 401 on every admin route', async () => {
    expect((await call('get', '/meta', undefined, fx.users.ownerA.email)).status).toBe(401);
    expect((await call('get', '', undefined, fx.users.ownerA.email)).status).toBe(401);
    const res = await call(
      'post',
      '',
      {
        firmId: firms.free.id,
        mode: 'TRIAL',
        planId: plans.basic,
        billingCycle: 'MONTHLY',
        seats: 2,
      },
      fx.users.ownerA.email,
    );
    expect(res.status).toBe(401);
  });
});

describe('reference data', () => {
  it('GET /meta: today (UTC), the 14-day trial and the plans in display order', async () => {
    const meta = SubscriptionMeta.parse(ok(await call('get', '/meta')));
    expect(meta.today).toBe(today);
    expect(meta.trialDays).toBe(14);
    const mine = meta.plans.filter((p) => p.code.endsWith(`_${RUN}`));
    expect(mine.map((p) => p.code)).toEqual([
      `E2E_OLD_${RUN}`,
      `E2E_BASIC_${RUN}`,
      `E2E_PRO_${RUN}`,
    ]);
    expect(mine[1]).toMatchObject({
      priceCents: 10_000,
      billingCycle: 'MONTHLY',
      includedSeats: 2,
      maxSeats: 10,
      seatPriceCents: 2_000,
      locationPriceCents: null,
      active: true,
      features: [{ key: 'fake_portal', label: 'Fake portal' }],
    });
    expect(mine[0]!.active).toBe(false);
  });

  it('GET /available-firms: approved firms without a subscription; only an Active one can bill', async () => {
    const { items } = SubscriptionAvailableFirmList.parse(
      ok(await call('get', '/available-firms')),
    );
    expect(items.find((f) => f.id === firms.free.id)).toMatchObject({
      canBill: true,
      status: 'ACTIVE',
      email: `billing-${run}-free@example.test`,
    });
    expect(items.find((f) => f.id === firms.pending.id)).toMatchObject({ canBill: false });
    expect(items.some((f) => f.id === fx.suspended.id)).toBe(false);
  });
});

describe('Add Subscription and Start Trial', () => {
  it('POST / TRIAL: 14 days from today, nothing billed, a CREATED event', async () => {
    const res = await subscribe('trial', { mode: 'TRIAL', seats: 2 });
    expect(res.invoice).toBeNull();
    expect(res.subscription).toMatchObject({
      status: 'TRIAL',
      trialEndsOn: subscriptionAddDays(today, 14),
      nextBillingOn: null,
      priceCents: 10_000,
      seatsAllowed: 2,
    });
    const record = await detail(res.subscription.id);
    expect(record.trial).toMatchObject({ endsOn: subscriptionAddDays(today, 14), daysLeft: 14 });
    expect(record.events.map((e) => e.action)).toEqual(['CREATED']);
    expect(record.events[0]).toMatchObject({ source: 'CHANGE', toStatus: 'TRIAL', toSeats: 2 });
    expect(await schedulesOf(res.subscription.id)).toEqual([]);
  });

  it('POST / PAID: Active today, its schedule made and the first period invoiced', async () => {
    const res = await subscribe('paid');
    const next = subscriptionAddMonths(today, 1);
    expect(res.subscription).toMatchObject({
      status: 'ACTIVE',
      priceCents: 12_000,
      listPriceCents: 12_000,
      monthlyCents: 12_000,
      extraSeats: 1,
      nextBillingOn: next,
      firm: { domain: `www.fake-${run}.example.test` },
    });
    expect(res.invoice).toMatchObject({ totalCents: 12_000 });
    expect(res.invoice!.number).toMatch(/^INV-\d+$/);
    const [schedule] = await schedulesOf(res.subscription.id);
    expect(schedule).toMatchObject({ status: 'ACTIVE', amountCents: 12_000, frequency: 'MONTHLY' });
    expect(schedule!.nextInvoiceDate?.toISOString().slice(0, 10)).toBe(next);
    const record = await detail(res.subscription.id);
    expect(record.invoices[0]).toMatchObject({
      id: res.invoice!.id,
      forSubscription: true,
      status: 'PENDING',
      balanceCents: 12_000,
      description: `Fake BASIC ${run} (Monthly)`,
      sendError: 'EMAIL_NOT_SET_UP',
    });
    expect(record.amountDueCents).toBe(12_000);
    expect(record).toMatchObject({ currentPeriodStart: today, paidThroughOn: next });
  });

  it('POST / refusals: one per firm, approved firms, billable firms, seats, locations, plans', async () => {
    const body = (over: Record<string, unknown>) => ({
      firmId: firms.free.id,
      mode: 'TRIAL',
      planId: plans.basic,
      billingCycle: 'MONTHLY',
      seats: 2,
      ...over,
    });
    refused(await call('post', '', body({ firmId: firms.paid.id })), 409, 'ALREADY_SUBSCRIBED');
    refused(await call('post', '', body({ firmId: fx.suspended.id })), 422, 'FIRM_NOT_AVAILABLE');
    refused(await call('post', '', body({ firmId: randomUUID() })), 422, 'FIRM_NOT_AVAILABLE');
    refused(
      await call('post', '', body({ firmId: firms.pending.id, mode: 'PAID' })),
      409,
      'FIRM_NOT_BILLABLE',
    );
    refused(await call('post', '', body({ seats: 1 })), 422, 'SEATS_OUT_OF_RANGE');
    refused(await call('post', '', body({ seats: 11 })), 422, 'SEATS_OUT_OF_RANGE');
    refused(await call('post', '', body({ extraLocations: 1 })), 422, 'LOCATIONS_NOT_OFFERED');
    refused(await call('post', '', body({ planId: plans.old })), 422, 'PLAN_INACTIVE');
    refused(
      await call('post', '', body({ firmId: firms.inuse.id, planId: plans.pro, seats: 3 })),
      422,
      'SEATS_IN_USE',
    );
    refused(await call('post', '', body({ seats: 0 })), 400, 'VALIDATION_FAILED');
  });
});

describe('plan, cycle, seats and locations', () => {
  it('POST /:id/plan: an upgrade mid-period invoices the prorated difference', async () => {
    const id = subs.paid!;
    const before = await detail(id);
    const meta = SubscriptionMeta.parse(ok(await call('get', '/meta')));
    const pro = meta.plans.find((p) => p.id === plans.pro)!;
    const preview = previewSubscriptionChange(before, pro, { billingCycle: 'MONTHLY' }, today);
    expect(preview.amountCents).toBe(30_000 - 12_000);
    const res = result(await post(id, 'plan', { planId: plans.pro, billingCycle: 'MONTHLY' }));
    expect(res.invoice).toMatchObject({ totalCents: preview.amountCents });
    expect(res.creditNote).toBeNull();
    expect(res.subscription).toMatchObject({
      plan: { id: plans.pro },
      priceCents: preview.priceCents,
      seatsAllowed: 3,
    });
    const [schedule] = await schedulesOf(id);
    expect(schedule!.amountCents).toBe(30_000);
    const event = (await detail(id)).events.find((e) => e.action === 'UPGRADED')!;
    expect(event).toMatchObject({
      fromPlan: `Fake BASIC ${run}`,
      toPlan: `Fake PRO ${run}`,
      amountCents: 18_000,
      mrrCents: 30_000,
    });
  });

  it('POST /:id/plan: a new cycle bills the year less the unused month and moves the next billing', async () => {
    const id = subs.paid!;
    const res = result(await post(id, 'plan', { planId: plans.pro, billingCycle: 'ANNUAL' }));
    expect(res.subscription).toMatchObject({
      billingCycle: 'ANNUAL',
      priceCents: 360_000,
      monthlyCents: 30_000,
      nextBillingOn: subscriptionAddMonths(today, 12),
    });
    expect(res.invoice).toMatchObject({ totalCents: 360_000 - 30_000 });
    const [schedule] = await schedulesOf(id);
    expect(schedule).toMatchObject({ frequency: 'ANNUAL', amountCents: 360_000 });
    expect((await detail(id)).events[0]).toMatchObject({ action: 'CYCLE_CHANGED' });
    refused(
      await post(id, 'plan', { planId: plans.pro, billingCycle: 'ANNUAL' }),
      422,
      'NO_CHANGE',
    );
    refused(
      await post(id, 'plan', { planId: plans.old, billingCycle: 'ANNUAL' }),
      422,
      'PLAN_INACTIVE',
    );
    refused(
      await post(randomUUID(), 'plan', { planId: plans.pro, billingCycle: 'MONTHLY' }),
      404,
      'NOT_FOUND',
    );
  });

  it('POST /:id/seats: more seats invoice, fewer seats credit; the plan’s range holds', async () => {
    await subscribe('seats', { planId: plans.pro, seats: 3 });
    const id = subs.seats!;
    const up = result(await post(id, 'seats', { seats: 5 }));
    expect(up.subscription).toMatchObject({ seatsAllowed: 5, extraSeats: 2, priceCents: 35_000 });
    expect(up.invoice).toMatchObject({ totalCents: 5_000 });
    const down = result(await post(id, 'seats', { seats: 4 }));
    expect(down.invoice).toBeNull();
    expect(down.creditNote).toMatchObject({ totalCents: 2_500 });
    expect(down.creditNote!.number).toMatch(/^CN-\d+$/);
    expect(down.subscription.creditCents).toBe(2_500);
    refused(await post(id, 'seats', { seats: 4 }), 422, 'NO_CHANGE');
    refused(await post(id, 'seats', { seats: 21 }), 422, 'SEATS_OUT_OF_RANGE');
    refused(await post(id, 'seats', { seats: 2 }), 422, 'SEATS_OUT_OF_RANGE');
    const events = (await detail(id)).events.filter((e) => e.action === 'SEATS_CHANGED');
    expect(events.map((e) => [e.fromSeats, e.toSeats, e.amountCents])).toEqual([
      [5, 4, -2_500],
      [3, 5, 5_000],
    ]);
  });

  it('POST /:id/seats: never fewer seats than the firm uses (from the daily rollup)', async () => {
    const res = await subscribe('inuse', { planId: plans.pro, seats: 4, mode: 'TRIAL' });
    expect(res.subscription).toMatchObject({ seatsUsed: 4, usagePercent: 100 });
    refused(await post(subs.inuse!, 'seats', { seats: 3 }), 422, 'SEATS_IN_USE');
  });

  it('POST /:id/locations: the Additional Location add-on, prorated, on a plan that sells it', async () => {
    await subscribe('loc', { planId: plans.pro, seats: 3 });
    const res = result(await post(subs.loc!, 'locations', { extraLocations: 1 }));
    expect(res.subscription).toMatchObject({
      extraLocations: 1,
      locationsAllowed: 2,
      priceCents: 35_000,
    });
    expect(res.invoice).toMatchObject({ totalCents: 5_000 });
    const event = (await detail(subs.loc!)).events[0]!;
    expect(event).toMatchObject({
      source: 'AUDIT',
      action: 'LOCATIONS_CHANGED',
      fromLocations: 0,
      toLocations: 1,
      amountCents: 5_000,
    });
    refused(await post(subs.loc!, 'locations', { extraLocations: 1 }), 422, 'NO_CHANGE');
    refused(
      await post(subs.trial!, 'locations', { extraLocations: 1 }),
      422,
      'LOCATIONS_NOT_OFFERED',
    );
  });
});

describe('the trial', () => {
  it('POST /:id/extend-trial: more days with the reason kept in a note, never in the audit row', async () => {
    const id = subs.trial!;
    const res = result(
      await post(id, 'extend-trial', { days: 7, reason: 'Fake: still onboarding' }),
    );
    expect(res.subscription.trialEndsOn).toBe(subscriptionAddDays(today, 21));
    const event = (await detail(id)).events[0]!;
    expect(event).toMatchObject({
      action: 'TRIAL_EXTENDED',
      fromDay: subscriptionAddDays(today, 14),
      toDay: subscriptionAddDays(today, 21),
      reason: 'Fake: still onboarding',
    });
    const row = (await auditsOf(id)).find((a) => a.action === 'subscription.trial_extended')!;
    expect(JSON.stringify(row.metadata)).not.toContain('onboarding');
    expect(row.investigationNotes.map((n) => n.body)).toEqual(['Fake: still onboarding']);
    refused(
      await post(subs.paid!, 'extend-trial', { days: 7, reason: 'Fake' }),
      409,
      'STATUS_NOT_ALLOWED',
    );
    refused(await post(id, 'extend-trial', { days: 61, reason: 'Fake' }), 400, 'VALIDATION_FAILED');
  });

  it('POST /:id/convert: Trial to Active on the plan chosen, with its first invoice', async () => {
    await subscribe('convert', { mode: 'TRIAL', seats: 2 });
    const res = result(
      await post(subs.convert!, 'convert', { planId: plans.pro, billingCycle: 'MONTHLY' }),
    );
    expect(res.subscription).toMatchObject({
      status: 'ACTIVE',
      plan: { id: plans.pro },
      seatsAllowed: 3,
      nextBillingOn: subscriptionAddMonths(today, 1),
    });
    expect(res.invoice).toMatchObject({ totalCents: 30_000 });
    const record = await detail(subs.convert!);
    expect(record.trial).toMatchObject({ convertedOn: today, daysLeft: 0 });
    expect(record.events[0]).toMatchObject({
      action: 'STATUS_CHANGED',
      fromStatus: 'TRIAL',
      toStatus: 'ACTIVE',
      amountCents: 30_000,
    });
    refused(
      await post(subs.convert!, 'convert', { planId: plans.pro, billingCycle: 'MONTHLY' }),
      409,
      'STATUS_NOT_ALLOWED',
    );
  });

  it('POST /:id/convert: only an Active firm can be billed', async () => {
    await subscribe('pending', { mode: 'TRIAL', seats: 2 });
    refused(
      await post(subs.pending!, 'convert', { planId: plans.basic, billingCycle: 'MONTHLY' }),
      409,
      'FIRM_NOT_BILLABLE',
    );
  });
});

describe('Auto-Renew, suspension and reactivation', () => {
  it('auto-renew off then on: Non-Renewing to the paid-through day, then Active again', async () => {
    await subscribe('renew');
    const id = subs.renew!;
    const off = result(
      await post(id, 'auto-renew/off', {
        confirmed: true,
        source: 'EMAIL',
        notes: 'Fake: client wrote in',
      }),
    );
    const end = subscriptionAddMonths(today, 1);
    expect(off.subscription).toMatchObject({
      status: 'NON_RENEWING',
      autoRenew: false,
      nextBillingOn: null,
      accessEndsOn: end,
    });
    const record = await detail(id);
    expect(record.cancellation).toMatchObject({ source: 'EMAIL', notes: 'Fake: client wrote in' });
    expect(record.events[0]).toMatchObject({
      action: 'CANCEL_REQUESTED',
      toStatus: 'NON_RENEWING',
    });
    expect((await schedulesOf(id))[0]!.endDate?.toISOString().slice(0, 10)).toBe(
      subscriptionAddDays(end, -1),
    );
    refused(
      await post(id, 'auto-renew/off', { confirmed: true, source: 'EMAIL', notes: 'Fake' }),
      409,
      'RENEWAL_ALREADY_OFF',
    );
    const on = result(
      await post(id, 'auto-renew/on', { autoRenewOn: true, reason: 'Fake: changed mind' }),
    );
    expect(on.subscription).toMatchObject({
      status: 'ACTIVE',
      autoRenew: true,
      nextBillingOn: end,
    });
    expect((await detail(id)).cancellation).toBeNull();
    expect((await schedulesOf(id))[0]!.endDate).toBeNull();
    refused(
      await post(id, 'auto-renew/on', { autoRenewOn: true, reason: 'Fake' }),
      409,
      'RENEWAL_ALREADY_ON',
    );
  });

  it('a trial’s reversal changes no status: the audit event CANCEL_REVERSED', async () => {
    const id = subs.trial!;
    result(
      await post(id, 'auto-renew/off', { confirmed: true, source: 'PHONE', notes: 'Fake: no' }),
    );
    expect((await detail(id)).accessEndsOn).toBe(subscriptionAddDays(today, 21));
    result(await post(id, 'auto-renew/on', { autoRenewOn: true, reason: 'Fake: yes after all' }));
    expect((await detail(id)).events[0]).toMatchObject({
      source: 'AUDIT',
      action: 'CANCEL_REVERSED',
      reason: 'Fake: yes after all',
    });
  });

  it('suspend and reactivate: nothing may be due, then Active and billing again', async () => {
    await subscribe('suspend');
    const id = subs.suspend!;
    refused(
      await post(id, 'suspend', { kind: 'NONPAYMENT', reason: 'Fake' }),
      422,
      'NONPAYMENT_NOT_PAST_DUE',
    );
    const res = result(await post(id, 'suspend', { kind: 'ADMIN', reason: 'Fake: review' }));
    expect(res.subscription).toMatchObject({ status: 'SUSPENDED', nextBillingOn: null });
    expect((await detail(id)).suspension).toMatchObject({ kind: 'ADMIN', reason: 'Fake: review' });
    expect((await schedulesOf(id))[0]!.status).toBe('PAUSED');
    refused(await post(id, 'reactivate', { reason: 'Fake' }), 409, 'BALANCE_DUE');
    await payOpen(firms.suspend.id);
    const back = result(await post(id, 'reactivate', { reason: 'Fake: cleared' }));
    expect(back.subscription).toMatchObject({
      status: 'ACTIVE',
      nextBillingOn: subscriptionAddMonths(today, 1),
    });
    expect(back.invoice).toBeNull();
    expect((await schedulesOf(id))[0]!.status).toBe('ACTIVE');
    refused(await post(id, 'reactivate', { reason: 'Fake' }), 409, 'STATUS_NOT_ALLOWED');
  });

  it('a nonpayment suspension needs the payment confirmed; a paused trial goes back to Trial', async () => {
    await subscribe('pastdue');
    const id = subs.pastdue!;
    await payOpen(firms.pastdue.id);
    await owner('admin', (tx) =>
      tx.platformFirmSubscription.update({ where: { id }, data: { status: 'PAST_DUE' } }),
    );
    result(await post(id, 'suspend', { kind: 'NONPAYMENT', reason: 'Fake: unpaid' }));
    refused(await post(id, 'reactivate', { reason: 'Fake' }), 422, 'PAYMENT_CONFIRMATION_REQUIRED');
    const back = result(
      await post(id, 'reactivate', { reason: 'Fake: paid', paymentConfirmed: true }),
    );
    expect(back.subscription.status).toBe('ACTIVE');

    result(await post(subs.inuse!, 'suspend', { kind: 'PAUSE', reason: 'Fake: holiday' }));
    expect((await detail(subs.inuse!)).suspension).toMatchObject({ kind: 'PAUSE' });
    const trial = result(await post(subs.inuse!, 'reactivate', { reason: 'Fake: back' }));
    expect(trial.subscription.status).toBe('TRIAL');
  });

  it('Close Account and a restart on a plan', async () => {
    await subscribe('close');
    const id = subs.close!;
    refused(
      await post(id, 'close', {
        reason: 'Fake',
        confirmName: 'Another firm',
        impactReviewed: true,
      }),
      422,
      'CONFIRM_NAME_MISMATCH',
    );
    const closed = result(
      await post(id, 'close', {
        reason: 'Fake: leaving',
        confirmName: firms.close.name.toUpperCase(),
        impactReviewed: true,
      }),
    );
    expect(closed.subscription).toMatchObject({
      status: 'CANCELLED',
      autoRenew: false,
      accessEndsOn: today,
      nextBillingOn: null,
      monthlyCents: 12_000,
    });
    const record = await detail(id);
    expect(record.closure).toMatchObject({ reason: 'Fake: leaving' });
    expect(record.events[0]).toMatchObject({ action: 'CANCELED', toStatus: 'CANCELLED' });
    expect((await schedulesOf(id))[0]!.status).toBe('CANCELED');
    refused(
      await post(id, 'close', {
        reason: 'Fake',
        confirmName: firms.close.name,
        impactReviewed: true,
      }),
      409,
      'STATUS_NOT_ALLOWED',
    );
    refused(
      await post(id, 'price', { baseCents: null, reason: 'Fake' }),
      409,
      'STATUS_NOT_ALLOWED',
    );
    refused(await post(id, 'reactivate', { reason: 'Fake' }), 422, 'PLAN_REQUIRED');
    const back = result(
      await post(id, 'reactivate', {
        reason: 'Fake: returning',
        planId: plans.pro,
        billingCycle: 'MONTHLY',
      }),
    );
    expect(back.subscription).toMatchObject({
      status: 'ACTIVE',
      plan: { id: plans.pro },
      autoRenew: true,
    });
    expect(back.invoice).toMatchObject({ totalCents: 30_000 });
    const schedules = await schedulesOf(id);
    expect(schedules.map((s) => s.status)).toEqual(['CANCELED', 'ACTIVE']);
    expect((await detail(id)).closure).toBeNull();
  });
});

describe('billing terms', () => {
  it('POST /:id/price: a negotiated base with its approver, then back to the plan’s', async () => {
    await subscribe('price');
    const id = subs.price!;
    refused(
      await post(id, 'price', { baseCents: 9_000, reason: 'Fake' }),
      400,
      'VALIDATION_FAILED',
    );
    const set = result(
      await post(id, 'price', {
        baseCents: 9_000,
        reason: 'Fake: loyalty',
        approvedBy: 'Fake Approver',
      }),
    );
    expect(set.subscription).toMatchObject({
      baseOverrideCents: 9_000,
      priceCents: 11_000,
      listPriceCents: 12_000,
    });
    expect(set.invoice).toBeNull();
    expect((await schedulesOf(id))[0]!.amountCents).toBe(11_000);
    refused(
      await post(id, 'price', { baseCents: 9_000, reason: 'Fake', approvedBy: 'Fake' }),
      422,
      'NO_CHANGE',
    );
    result(await post(id, 'price', { baseCents: null, reason: 'Fake: promo over' }));
    const events = (await detail(id)).events.filter((e) => e.action === 'PRICE_CHANGED');
    expect(events.map((e) => [e.fromCents, e.toCents, e.reason, e.approvedBy])).toEqual([
      [9_000, null, 'Fake: promo over', null],
      [null, 9_000, 'Fake: loyalty', 'Fake Approver'],
    ]);
    const rows = (await auditsOf(id)).filter((a) => a.action === 'subscription.price_changed');
    expect(rows.map((r) => JSON.stringify(r.metadata)).join()).not.toMatch(/loyalty|Approver/);
  });

  it('POST /:id/billing-date: within one cycle; days removed credited, days added invoiced', async () => {
    await subscribe('date');
    const id = subs.date!;
    refused(
      await post(subs.trial!, 'billing-date', {
        date: subscriptionAddDays(today, 5),
        reason: 'Fake',
      }),
      409,
      'NO_BILLING_DATE',
    );
    refused(
      await post(id, 'billing-date', { date: today, reason: 'Fake' }),
      422,
      'BILLING_DATE_OUT_OF_RANGE',
    );
    refused(
      await post(id, 'billing-date', { date: subscriptionAddMonths(today, 2), reason: 'Fake' }),
      422,
      'BILLING_DATE_OUT_OF_RANGE',
    );
    const before = await detail(id);
    refused(
      await post(id, 'billing-date', { date: before.nextBillingOn!, reason: 'Fake' }),
      422,
      'NO_CHANGE',
    );
    const earlier = subscriptionAddDays(today, 10);
    const credit = subscriptionBillingDateCents(before, earlier);
    expect(credit).toBeLessThan(0);
    const moved = result(await post(id, 'billing-date', { date: earlier, reason: 'Fake: align' }));
    expect(moved.subscription.nextBillingOn).toBe(earlier);
    expect(moved.creditNote).toMatchObject({ totalCents: -credit });
    const after = await detail(id);
    expect(after.currentPeriodEnd).toBe(earlier);
    expect(after.currentPeriodStart).toBe(subscriptionAddMonths(earlier, -1));
    const later = subscriptionAddDays(today, 20);
    const charge = subscriptionBillingDateCents(after, later);
    expect(charge).toBeGreaterThan(0);
    const back = result(await post(id, 'billing-date', { date: later, reason: 'Fake: again' }));
    expect(back.invoice).toMatchObject({ totalCents: charge });
    expect((await schedulesOf(id))[0]!.nextInvoiceDate?.toISOString().slice(0, 10)).toBe(later);
    expect(
      (await detail(id)).events.filter((e) => e.action === 'BILLING_DATE_CHANGED')[0],
    ).toMatchObject({
      fromDay: earlier,
      toDay: later,
      amountCents: charge,
      reason: 'Fake: again',
    });
  });
});

describe('notes, the table, the KPI row and the export', () => {
  it('POST /:id/notes: an internal note as the signed-in member', async () => {
    const note = SubscriptionNote.parse(
      ok(await post(subs.paid!, 'notes', { body: 'Fake: call back in May' }), 201),
    );
    expect(note).toMatchObject({ body: 'Fake: call back in May', author: 'Fake admin' });
    const record = await detail(subs.paid!);
    expect(record.notes[0]).toMatchObject({ id: note.id, body: 'Fake: call back in May' });
    expect(record.events[0]).toMatchObject({ action: 'NOTE_ADDED', reason: null });
    refused(await post(randomUUID(), 'notes', { body: 'Fake' }), 404, 'NOT_FOUND');
  });

  it('GET /: filtered, sorted and paged on the server', async () => {
    await subscribe('formula', { mode: 'TRIAL', seats: 2 });
    const page = SubscriptionPage.parse(ok(await call('get', `?search=${run}&pageSize=100`)));
    const mine = Object.values(subs);
    expect(page.items.map((r) => r.id).sort()).toEqual([...mine].sort());
    expect(page.all).toBeGreaterThanOrEqual(page.total);
    const trials = SubscriptionPage.parse(
      ok(await call('get', `?search=${run}&status=TRIAL&planId=${plans.basic}`)),
    );
    expect(trials.items.every((r) => r.status === 'TRIAL' && r.plan.id === plans.basic)).toBe(true);
    expect(trials.items.map((r) => r.id)).toContain(subs.trial);
    const byPrice = SubscriptionPage.parse(
      ok(await call('get', `?search=${run}&sort=PRICE&dir=desc`)),
    );
    const monthly = byPrice.items.map((r) => r.monthlyCents);
    expect(monthly).toEqual([...monthly].sort((a, b) => b - a));
    const paged = SubscriptionPage.parse(ok(await call('get', `?search=${run}&pageSize=2&page=2`)));
    expect(paged).toMatchObject({ page: 2, pageSize: 2, total: page.total });
    expect(paged.items).toHaveLength(2);
    const byDomain = SubscriptionPage.parse(ok(await call('get', `?search=fake-${run}.example`)));
    expect(byDomain.items.map((r) => r.id)).toEqual([subs.paid]);
    const soon = SubscriptionPage.parse(
      ok(await call('get', `?search=${run}&status=RENEWING_SOON`)),
    );
    expect(soon.items.map((r) => r.id)).toContain(subs.date);
    for (const r of soon.items) {
      expect(r.autoRenew).toBe(true);
      expect(r.nextBillingOn! <= subscriptionAddDays(today, 30)).toBe(true);
    }
    refused(await call('get', `?from=${today}`), 400, 'VALIDATION_FAILED');
  });

  it('GET /summary: the cards now and on the rollup’s day 30 days ago; churn from the history', async () => {
    // A subscription paying before the period, canceled in it (churn's base and churned).
    await owner('admin', (tx) =>
      tx.platformSubscriptionChange.create({
        data: {
          businessId: firms.renew.id,
          subscriptionId: subs.renew!,
          kind: 'STATUS_CHANGED',
          toStatus: 'ACTIVE',
          effectiveAt: asDate(subscriptionAddDays(today, -3)),
        },
      }),
    );
    result(
      await post(subs.renew!, 'close', {
        reason: 'Fake: churned',
        confirmName: firms.renew.name,
        impactReviewed: true,
      }),
    );
    const s = SubscriptionSummary.parse(
      ok(await call('get', `/summary?from=${today}&to=${today}`)),
    );
    expect(s).toMatchObject({
      from: today,
      to: today,
      previousFrom: subscriptionAddDays(today, -1),
      previousTo: subscriptionAddDays(today, -1),
      comparedWith: subscriptionAddDays(today, -30),
      active: { previous: 7 },
      trial: { previous: 3 },
      mrrCents: { previous: 123_400 },
      arrCents: { previous: 123_400 * 12 },
      pastDue: { previous: 1 },
    });
    expect(s.arrCents.value).toBe(s.mrrCents.value * 12);
    expect(s.active.value).toBeGreaterThanOrEqual(6);
    expect(s.churn.base).toBeGreaterThanOrEqual(1);
    expect(s.churn.churned).toBeGreaterThanOrEqual(1);
    expect(s.churn.rateBp).toBe(Math.round((s.churn.churned * 10_000) / s.churn.base));
    const month = SubscriptionSummary.parse(ok(await call('get', '/summary')));
    expect(month.from).toBe(`${today.slice(0, 7)}-01`);
  });

  it('GET /export: a CSV of the ids given, formula-safe, with an EXPORTED event on each', async () => {
    const res = await call('get', `/export?ids=${subs.paid},${subs.formula}`);
    expect(res.status, res.text).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toContain('attachment');
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toMatch(/^Firm,Email,Domain,Plan,/);
    expect(lines).toHaveLength(3);
    expect(lines.some((l) => l.startsWith(`'=Fake Formula ${run},`))).toBe(true);
    expect((await detail(subs.formula!)).events[0]).toMatchObject({ action: 'EXPORTED' });
  });

  it('GET /:id: 404 for an unknown id, 400 for a malformed one; every change wrote an audit row', async () => {
    refused(await call('get', `/${randomUUID()}`), 404, 'NOT_FOUND');
    refused(await call('get', '/not-an-id'), 400, 'VALIDATION_FAILED');
    const actions = (await auditsOf(subs.paid!)).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'subscription.created',
        'subscription.plan_changed',
        'subscription.note_added',
        'subscription.exported',
      ]),
    );
    for (const a of await auditsOf(subs.close!))
      expect(a.metadata).toMatchObject({ firmId: firms.close.id });
  });
});
