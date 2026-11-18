// End-to-end: Dashboard Review Two V8, the dashboard on a large firm. One firm with thousands of
// clients, leads, returns (with their status history), invoices and payments, appointments,
// intakes and tasks, built in bulk, and a firm with one client. The guard is deterministic: GET
// /business/dashboard/summary sends the large firm's numbers in exactly as many database queries
// as the small firm's (nothing grows with the data), and few of them. The time is logged (median
// of seven, after a warm-up) with only a loose ceiling: a shared CI runner is no stopwatch. The
// 1 s target is measured locally and on dev (docs/qa/dashboard.md). Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { DashboardSummary, INTAKE_FORMS } from '@firmivra/types';
import type { Database } from '@firmivra/db';
import { AppModule } from '../../src/app.module.js';
import { DATABASE } from '../../src/database/database.module.js';
import { TokenService } from '../../src/auth/token.service.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const owner = { id: randomUUID(), email: `v8-owner-${run}@v8.test` };
const staff = { id: randomUUID(), email: `v8-staff-${run}@v8.test` };
const SIZE = {
  clients: 3_000,
  returns: 1_500,
  leads: 1_500,
  engagements: 1_000,
  intakes: 600,
  appointments: 2_000,
  tasks: 5_000,
  invoices: 2_000,
};
const DAY = 86_400_000;
const HOUR = 3_600_000;

let app: INestApplication;
let businessId = '';
/** A firm with one client: the same summary in the same queries. */
let smallId = '';
const db = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
const inFirm = <T>(work: (tx: TxClient) => Promise<T>) =>
  runInScope(db, { kind: 'business', businessId, actorUserId: owner.id }, work);
/** createMany in chunks, so no statement grows too large. */
async function bulk<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += 1_000) await insert(rows.slice(i, i + 1_000));
}

beforeAll(async () => {
  await runInScope(db, { kind: 'platform' }, async (tx) => {
    await tx.user.createMany({
      data: [owner, staff].map((p, i) => ({
        ...p,
        cognitoSub: p.id,
        pool: 'STAFF' as const,
        name: `Fake V8 ${i ? 'staff' : 'owner'}`,
      })),
    });
    businessId = (
      await tx.business.create({
        data: { slug: `v8-${run}`, name: 'V8 large firm (fake)', status: 'ACTIVE' },
        select: { id: true },
      })
    ).id;
    smallId = (
      await tx.business.create({
        data: { slug: `v8s-${run}`, name: 'V8 small firm (fake)', status: 'ACTIVE' },
        select: { id: true },
      })
    ).id;
  });
  await runInScope(db, { kind: 'business', businessId: smallId }, async (tx) => {
    await tx.membership.create({
      data: { businessId: smallId, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
    });
    await tx.client.create({
      data: { businessId: smallId, displayName: 'V8 small client (fake)' },
    });
  });
  await runInScope(db, { kind: 'business', businessId }, async (tx) => {
    for (const [userId, role] of [
      [owner.id, 'OWNER'],
      [staff.id, 'STAFF'],
    ] as const)
      await tx.membership.create({ data: { businessId, userId, role, status: 'ACTIVE' } });
  });
  const now = Date.now();
  // Clients (a third the staff member's, some archived), with returns and engagements.
  const clients = Array.from({ length: SIZE.clients }, (_, i) => ({
    id: randomUUID(),
    businessId,
    displayName: `V8 client ${i} (fake)`,
    assignedUserId: i % 3 === 0 ? staff.id : null,
    createdAt: new Date(now - (i % 400) * DAY),
    ...(i % 25 === 0 ? { archivedAt: new Date(now - DAY) } : {}),
  }));
  await inFirm(async (tx) => {
    await bulk(clients, (data) => tx.client.createMany({ data }));
    const service = await tx.service.create({
      data: { businessId, kind: 'BOOKKEEPING', name: 'V8 Bookkeeping (fake)' },
    });
    const returns = clients.slice(0, SIZE.returns).map((c, i) => ({
      id: randomUUID(),
      businessId,
      clientId: c.id,
      taxYear: 2025,
      filingType: 'INDIVIDUAL' as const,
      createdAt: new Date(now - (i % 300) * DAY),
    }));
    await bulk(returns, (data) => tx.taxReturn.createMany({ data }));
    // Some move on, so the history has rows to read: in review, then accepted.
    await tx.taxReturn.updateMany({
      where: { businessId, id: { in: returns.filter((_, i) => i % 3 === 0).map((r) => r.id) } },
      data: { workflowStatus: 'READY_FOR_REVIEW' },
    });
    await tx.taxReturn.updateMany({
      where: { businessId, id: { in: returns.filter((_, i) => i % 6 === 0).map((r) => r.id) } },
      data: {
        workflowStatus: 'ACCEPTED',
        filedOn: new Date(new Date(now).toISOString().slice(0, 10)),
      },
    });
    const leads = Array.from({ length: SIZE.leads }, (_, i) => ({
      businessId,
      serviceId: service.id,
      firstName: 'V8',
      lastName: `Lead ${i} (fake)`,
      email: `v8-lead-${i}-${run}@lead.test`,
      status: (i % 4 === 0 ? 'IN_REVIEW' : 'SUBMITTED') as 'IN_REVIEW' | 'SUBMITTED',
      submittedAt: new Date(now - (i % 90) * DAY),
      assignedUserId: i % 2 === 0 ? staff.id : null,
    }));
    await bulk(leads, (data) => tx.lead.createMany({ data }));
    const engagements = clients.slice(0, SIZE.engagements).map((c, i) => ({
      id: randomUUID(),
      businessId,
      clientId: c.id,
      serviceId: service.id,
      title: `V8 engagement ${i} (fake)`,
    }));
    await bulk(engagements, (data) => tx.engagement.createMany({ data }));
    const form = await tx.intakeForm.create({
      data: {
        businessId,
        serviceId: service.id,
        version: 1,
        title: 'V8 intake (fake)',
        definition: (INTAKE_FORMS.BOOKKEEPING ?? {}) as object,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        createdByUserId: owner.id,
      },
    });
    const intakes = engagements.slice(0, SIZE.intakes).map((e, i) => ({
      businessId,
      formId: form.id,
      engagementId: e.id,
      sentAt: new Date(now - (i % 60) * DAY),
      status: (i % 5 === 0 ? 'COMPLETED' : 'SENT') as 'COMPLETED' | 'SENT',
    }));
    await bulk(intakes, (data) => tx.intake.createMany({ data }));
    // Appointments an hour apart, from six weeks ago to six weeks ahead.
    const start = now - 42 * DAY;
    const appointments = Array.from({ length: SIZE.appointments }, (_, i) => ({
      businessId,
      clientId: clients[i % SIZE.clients]!.id,
      staffUserId: i % 2 === 0 ? owner.id : staff.id,
      startsAt: new Date(start + i * 2 * HOUR),
      endsAt: new Date(start + i * 2 * HOUR + HOUR / 2),
      locationKind: 'PHONE' as const,
    }));
    await bulk(appointments, (data) => tx.appointment.createMany({ data }));
    const tasks = Array.from({ length: SIZE.tasks }, (_, i) => ({
      businessId,
      clientId: clients[i % SIZE.clients]!.id,
      title: `V8 task ${i} (fake)`,
      dueOn: new Date(new Date(now + ((i % 120) - 60) * DAY).toISOString().slice(0, 10)),
      ...(i % 7 === 0 ? { status: 'DONE' as const, completedAt: new Date(now - DAY) } : {}),
    }));
    await bulk(tasks, (data) => tx.task.createMany({ data }));
    // Invoices: lines, then open; half with cash received over the last year.
    const invoices = Array.from({ length: SIZE.invoices }, (_, i) => ({
      id: randomUUID(),
      businessId,
      clientId: clients[i % SIZE.clients]!.id,
      number: `V8-${run}-${i}`,
    }));
    await bulk(invoices, (data) => tx.invoice.createMany({ data }));
    await bulk(
      invoices.map((inv, i) => ({
        businessId,
        invoiceId: inv.id,
        description: 'V8 fee (fake)',
        unitAmountCents: 10_000 + (i % 50) * 1_000,
      })),
      (data) => tx.invoiceLine.createMany({ data }),
    );
    await tx.invoice.updateMany({
      where: { businessId, id: { in: invoices.map((v) => v.id) } },
      data: { status: 'OPEN', issuedAt: new Date() },
    });
    await bulk(
      invoices
        .filter((_, i) => i % 2 === 0)
        .map((inv, i) => ({
          businessId,
          invoiceId: inv.id,
          recordedByUserId: owner.id,
          method: 'CASH' as const,
          amountCents: 5_000,
          receivedOn: new Date(new Date(now - (i % 360) * DAY).toISOString().slice(0, 10)),
          idempotencyKey: randomUUID(),
        })),
      (data) => tx.offlinePayment.createMany({ data }),
    );
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
  await nest.listen(0, '127.0.0.1');
  app = nest;
}, 300_000);

afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});

/** Milliseconds per call: a warm-up, then `times` calls; the median and the slowest. */
/**
 * Counts the queries the app sends through its database: each model call and raw query, in a
 * transaction (withScope) or a scoped client (forBusiness). `stop` puts the client back.
 */
function countQueries(database: Database) {
  let n = 0;
  const count = <F extends (...args: never[]) => unknown>(fn: F, self: object) =>
    ((...args: Parameters<F>) => {
      n++;
      return fn.apply(self, args);
    }) as F;
  const counted = <T extends object>(client: T): T =>
    new Proxy(client, {
      get(target, prop, receiver) {
        const value: unknown = Reflect.get(target, prop, receiver);
        if (typeof prop !== 'string') return value;
        if (/^\$(query|execute)/.test(prop) && typeof value === 'function')
          return count(value as (...args: never[]) => unknown, target);
        if (!prop.startsWith('$') && value !== null && typeof value === 'object')
          return new Proxy(value, {
            get(model, method, r) {
              const fn: unknown = Reflect.get(model, method, r);
              return typeof fn === 'function' ? count(fn as (...a: never[]) => unknown, model) : fn;
            },
          });
        return value;
      },
    });
  const { withScope, forBusiness } = database;
  database.withScope = ((scope, fn, limits) =>
    withScope(scope, (tx) => fn(counted(tx)), limits)) as Database['withScope'];
  database.forBusiness = ((id, options) =>
    counted(forBusiness(id, options))) as Database['forBusiness'];
  return {
    reset: () => (n = 0),
    count: () => n,
    stop: () => Object.assign(database, { withScope, forBusiness }),
  };
}

async function timed(path: string, times = 7, firm = businessId) {
  const { token } = await app.get(TokenService).signLocal(owner.id, 'STAFF');
  const call = () =>
    request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('x-business-id', firm)
      .set('authorization', `Bearer ${token}`);
  // The warm-up is not timed. On a laptop whose database other suites keep busy, the first call
  // after the bulk insert can wait past the transaction start limit (503): try it again.
  let first = await call();
  for (let tries = 1; first.status === 503 && tries < 5; tries++) {
    await new Promise((done) => setTimeout(done, 2_000));
    first = await call();
  }
  expect(first.status, `${path}: ${JSON.stringify(first.body)}`).toBe(200);
  const ms: number[] = [];
  for (let i = 0; i < times; i++) {
    const t0 = performance.now();
    const res = await call();
    ms.push(performance.now() - t0);
    expect(res.status).toBe(200);
  }
  ms.sort((a, b) => a - b);
  return { median: Math.round(ms[Math.floor(ms.length / 2)]!), slowest: Math.round(ms.at(-1)!) };
}

describe('the dashboard on a large firm (Dashboard Review Two V8)', () => {
  it('sends the summary in the same few queries as for a one-client firm, and logs the times', async () => {
    const summary = await timed('/business/dashboard/summary');
    // The guard: the same queries for 3,000 clients as for one (no query per row), and few.
    const counter = countQueries(app.get<Database>(DATABASE));
    try {
      counter.reset();
      await timed('/business/dashboard/summary', 1);
      const large = counter.count();
      counter.reset();
      await timed('/business/dashboard/summary', 1, smallId);
      const small = counter.count();
      console.info(`V8 queries per summary: large firm ${large}, one-client firm ${small}`);
      expect(large).toBe(small);
      expect(large).toBeGreaterThan(0);
      // 28 on Nov 18 (the summary, its cards, Tasks Due and the view's audit).
      expect(large).toBeLessThanOrEqual(30);
    } finally {
      counter.stop();
    }
    // The numbers are the large firm's.
    const { token } = await app.get(TokenService).signLocal(owner.id, 'STAFF');
    const body = DashboardSummary.parse(
      (
        await request(app.getHttpServer())
          .get('/api/v1/business/dashboard/summary')
          .set('x-business-id', businessId)
          .set('authorization', `Bearer ${token}`)
      ).body,
    );
    expect(body.kpis.totalClients?.value).toBeGreaterThan(2_000);
    const others = {
      timeZone: await timed('/business/availability'),
      messages: await timed('/business/message-threads?limit=5'),
      appointments: await timed(
        `/business/appointments?from=${new Date().toISOString()}&to=${new Date(Date.now() + 14 * DAY).toISOString()}`,
      ),
    };
    console.info(`V8 timings (ms, median/slowest): ${JSON.stringify({ summary, ...others })}`);
    // A loose ceiling only (a shared runner under load took 2.7 s); 1 s is measured, not gated.
    expect(summary.median).toBeLessThan(5_000);
  }, 120_000);
});
