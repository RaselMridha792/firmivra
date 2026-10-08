// End-to-end: R10 step 6, services and engagements (contract in packages/types/src/engagements).
// The firm creates and moves a client's engagements through their lifecycle (Staff: their own
// clients only); the database keeps the rules too and writes the history. The portal's My
// Services: the client from the session, cancellation requests for ACTIVE recurring services up
// to 14 days before the next billing. Every read and change is audited, never a reason's text.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { z } from 'zod';
import { Engagement as EngagementShape, MyService as MineShape } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

// Strict copies of the contract's shapes: a leaked field fails the parse.
const Engagement = z.strictObject({
  ...EngagementShape.shape,
  service: z.strictObject(EngagementShape.shape.service.shape),
});
const Mine = z.strictObject({
  ...MineShape.shape,
  service: z.strictObject(MineShape.shape.service.shape),
});
type Engagement = z.infer<typeof Engagement>;
type Mine = z.infer<typeof Mine>;

const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r10e-${key}-${run}@r10.test` });
const people = {
  ownerA: person('owner-a'),
  staffA: person('staff-a'),
  staffA2: person('staff-a2'),
  primary: person('primary'),
  spouse: person('spouse'),
  other: person('other'),
  ownerB: person('owner-b'),
};
const ids = {
  firmA: '',
  firmB: '',
  slugA: `r10e-a-${run}`,
  one: '',
  two: '',
  old: '',
  tax: '',
  books: '',
  retired: '',
  serviceB: '',
};

let app: INestApplication;
const tokens = new Map<string, string>();

async function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .send({ email })
    .expect(200);
  const token = (res.body as { token: string }).token;
  tokens.set(email, token);
  return token;
}

async function firm(
  method: 'get' | 'post' | 'patch',
  path: string,
  who: { email: string },
  body?: object,
  businessId = ids.firmA,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', businessId)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}

async function portal(
  method: 'get' | 'post',
  path: string,
  who: { email: string },
  body?: object,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/portal/${ids.slugA}/me/services${path}`)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectOk = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res;
};
const create = async (clientId: string, body: object, who = people.ownerA) =>
  Engagement.parse(
    expectOk(await firm('post', `/clients/${clientId}/engagements`, who, body), 201).body,
  );
const inFirm = async <T>(fn: (tx: TxClient) => Promise<T>) => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  try {
    return await runInScope(owner, { kind: 'business', businessId: ids.firmA }, fn);
  } finally {
    await owner.$disconnect();
  }
};

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      const pool = ['primary', 'spouse', 'other'].includes(key) ? 'CLIENT' : 'STAFF';
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool, email: p.email, name: `Fake R10e ${key}` },
      });
    }
    ids.firmA = (
      await tx.business.create({ data: { slug: ids.slugA, name: 'A', status: 'ACTIVE' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: `r10e-b-${run}`, name: 'B', status: 'ACTIVE' } })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const A = { businessId: ids.firmA };
    await tx.businessSettings.create({ data: { ...A, timezone: 'America/New_York' } });
    for (const [userId, role] of [
      [people.ownerA.id, 'OWNER'],
      [people.staffA.id, 'STAFF'],
      [people.staffA2.id, 'STAFF'],
    ] as const) {
      await tx.membership.create({ data: { ...A, userId, role, status: 'ACTIVE' } });
    }
    ids.one = (
      await tx.client.create({
        data: { ...A, displayName: 'One', assignedUserId: people.staffA.id },
      })
    ).id;
    ids.two = (await tx.client.create({ data: { ...A, displayName: 'Two' } })).id;
    ids.old = (
      await tx.client.create({ data: { ...A, displayName: 'Old', archivedAt: new Date() } })
    ).id;
    for (const [p, clientId, portalRole] of [
      [people.primary, ids.one, 'PRIMARY'],
      [people.spouse, ids.one, 'SPOUSE'],
      [people.other, ids.two, 'PRIMARY'],
    ] as const) {
      await tx.clientAccount.create({
        data: { ...A, userId: p.id, clientId, email: p.email, portalRole, status: 'ACTIVE' },
      });
    }
    ids.tax = (
      await tx.service.create({
        data: {
          ...A,
          kind: 'ANNUAL_TAX',
          name: `Tax ${run}`,
          stages: ['Intake', 'Review', 'Filed'],
        },
      })
    ).id;
    ids.books = (
      await tx.service.create({
        data: { ...A, kind: 'BOOKKEEPING', name: `Books ${run}`, billingInterval: 'MONTHLY' },
      })
    ).id;
    ids.retired = (
      await tx.service.create({
        data: { ...A, kind: 'OTHER', name: `Retired ${run}`, archivedAt: new Date() },
      })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    await tx.membership.create({
      data: { businessId: ids.firmB, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    });
    ids.serviceB = (
      await tx.service.create({
        data: { businessId: ids.firmB, kind: 'ANNUAL_TAX', name: `Tax B ${run}` },
      })
    ).id;
  });
  await owner.$disconnect();

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env)],
  }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('firm: create and list', () => {
  it("creates with the service's billing by default; lists newest first, by status", async () => {
    const tax = await create(ids.one, {
      serviceId: ids.tax,
      title: '2025 return',
      taxYear: 2025,
      stage: 'Intake',
    });
    expect(tax).toMatchObject({
      clientId: ids.one,
      service: { id: ids.tax, kind: 'ANNUAL_TAX' },
      status: 'ACTIVE',
      stage: 'Intake',
      billingInterval: 'ONE_TIME',
      recurring: false,
    });
    const books = await create(ids.one, {
      serviceId: ids.books,
      title: 'Monthly books',
      nextBillingOn: inDays(60),
      package: 'Starter',
    });
    expect(books).toMatchObject({ billingInterval: 'MONTHLY', recurring: true });
    const res = expectOk(await firm('get', `/clients/${ids.one}/engagements`, people.ownerA));
    const items = z.strictObject({ items: z.array(Engagement) }).parse(res.body).items;
    expect(items.map((e) => e.id).slice(0, 2)).toEqual([books.id, tax.id]);
    const filtered = expectOk(
      await firm('get', `/clients/${ids.one}/engagements?status=COMPLETED`, people.ownerA),
    );
    expect((filtered.body as { items: unknown[] }).items).toEqual([]);
  });

  it('refuses a bad stage, a next billing date on a one-time service, and services not on offer', async () => {
    const cases: [object, number, string][] = [
      [{ serviceId: ids.tax, title: 'x', stage: 'Nope' }, 409, 'INVALID_STAGE'],
      [{ serviceId: ids.tax, title: 'x', nextBillingOn: inDays(30) }, 400, 'VALIDATION_FAILED'],
      [{ serviceId: ids.retired, title: 'x' }, 404, 'NOT_FOUND'],
      [{ serviceId: ids.serviceB, title: 'x' }, 404, 'NOT_FOUND'],
      [
        { serviceId: ids.tax, title: 'x', periodStart: '2025-02-01', periodEnd: '2025-01-01' },
        400,
        'VALIDATION_FAILED',
      ],
      [{ serviceId: ids.tax, title: 'x', assignedUserId: randomUUID() }, 404, 'NOT_FOUND'],
    ];
    for (const [body, status, code] of cases) {
      const res = await firm('post', `/clients/${ids.one}/engagements`, people.ownerA, body);
      expect([res.status, codeOf(res)], JSON.stringify(body)).toEqual([status, code]);
    }
    const archived = await firm('post', `/clients/${ids.old}/engagements`, people.ownerA, {
      serviceId: ids.tax,
      title: 'x',
    });
    expect([archived.status, codeOf(archived)]).toEqual([409, 'CLIENT_ARCHIVED']);
  });

  it("Staff reach only their own clients' engagements and never set the assignee; firm B gets 404", async () => {
    await create(ids.one, { serviceId: ids.tax, title: 'By staff' }, people.staffA);
    const theirs = await create(ids.two, { serviceId: ids.tax, title: 'Not staff' });
    const refused: [Response, number, string][] = [
      [await firm('get', `/clients/${ids.two}/engagements`, people.staffA), 404, 'NOT_FOUND'],
      [
        await firm('post', `/clients/${ids.two}/engagements`, people.staffA, {
          serviceId: ids.tax,
          title: 'x',
        }),
        404,
        'NOT_FOUND',
      ],
      [await firm('get', `/engagements/${theirs.id}`, people.staffA), 404, 'NOT_FOUND'],
      [
        await firm('post', `/clients/${ids.one}/engagements`, people.staffA, {
          serviceId: ids.tax,
          title: 'x',
          assignedUserId: people.staffA.id,
        }),
        403,
        'FORBIDDEN',
      ],
      [
        await firm('get', `/engagements/${theirs.id}`, people.ownerB, undefined, ids.firmB),
        404,
        'NOT_FOUND',
      ],
      [await firm('get', `/clients/${ids.one}/engagements`, people.primary), 403, 'FORBIDDEN'],
    ];
    // The write routes too: another client's engagement for Staff, any of firm A's for firm B.
    for (const [method, path, body] of [
      ['patch', `/engagements/${theirs.id}`, { title: 'x' }],
      ['post', `/engagements/${theirs.id}/complete`, undefined],
      ['post', `/engagements/${theirs.id}/cancel`, { reason: 'x' }],
      ['post', `/engagements/${theirs.id}/reactivate`, undefined],
    ] as const) {
      refused.push([await firm(method, path, people.staffA, body), 404, 'NOT_FOUND']);
      refused.push([await firm(method, path, people.ownerB, body, ids.firmB), 404, 'NOT_FOUND']);
    }
    for (const [res, status, code] of refused) {
      expect([res.status, codeOf(res)]).toEqual([status, code]);
    }
    // The Owner reaches it.
    const seen = Engagement.parse(
      expectOk(await firm('get', `/engagements/${theirs.id}`, people.ownerA)).body,
    );
    expect([seen.id, seen.status]).toEqual([theirs.id, theirs.status]);
  });
});

describe('firm: change and lifecycle', () => {
  let e: Engagement;
  beforeAll(async () => {
    e = await create(ids.one, {
      serviceId: ids.tax,
      title: 'Lifecycle',
      stage: 'Intake',
      package: 'Premium',
    });
  });

  it('updates the fields sent ("" clears), checks the stage and the period against what is stored', async () => {
    const res = expectOk(
      await firm('patch', `/engagements/${e.id}`, people.ownerA, {
        stage: 'Review',
        package: '',
        periodStart: '2025-01-01',
        assignedUserId: people.staffA2.id,
      }),
    );
    expect(Engagement.parse(res.body)).toMatchObject({
      stage: 'Review',
      package: null,
      periodStart: '2025-01-01',
      assignedTo: { userId: people.staffA2.id, name: 'Fake R10e staffA2' },
    });
    const cases: [object, { email: string }, number, string][] = [
      [{ stage: 'Nope' }, people.ownerA, 409, 'INVALID_STAGE'],
      [{ periodEnd: '2024-12-31' }, people.ownerA, 400, 'VALIDATION_FAILED'],
      [{ nextBillingOn: inDays(30) }, people.ownerA, 400, 'VALIDATION_FAILED'],
      [{ assignedUserId: null }, people.staffA, 403, 'FORBIDDEN'],
      [{}, people.ownerA, 400, 'VALIDATION_FAILED'],
    ];
    for (const [body, who, status, code] of cases) {
      const r = await firm('patch', `/engagements/${e.id}`, who, body);
      expect([r.status, codeOf(r)], JSON.stringify(body)).toEqual([status, code]);
    }
  });

  it('completes once; cancels with the reason; reactivates within 90 days only', async () => {
    const done = await create(ids.one, { serviceId: ids.tax, title: 'To complete' });
    const completed = Engagement.parse(
      expectOk(await firm('post', `/engagements/${done.id}/complete`, people.staffA)).body,
    );
    expect(completed.status).toBe('COMPLETED');
    expect(completed.completedAt).not.toBeNull();
    const again = await firm('post', `/engagements/${done.id}/complete`, people.ownerA);
    expect([again.status, codeOf(again)]).toEqual([409, 'INVALID_STATUS']);

    const cancelled = Engagement.parse(
      expectOk(
        await firm('post', `/engagements/${e.id}/cancel`, people.ownerA, {
          reason: 'Client moved away.',
        }),
      ).body,
    );
    expect(cancelled).toMatchObject({
      status: 'CANCELLED',
      cancellationReason: 'Client moved away.',
    });
    const twice = await firm('post', `/engagements/${e.id}/cancel`, people.ownerA, {
      reason: 'x',
    });
    expect([twice.status, codeOf(twice)]).toEqual([409, 'INVALID_STATUS']);
    const back = Engagement.parse(
      expectOk(await firm('post', `/engagements/${e.id}/reactivate`, people.ownerA)).body,
    );
    expect(back).toMatchObject({ status: 'ACTIVE', cancelledAt: null, cancellationReason: null });
    const notCancelled = await firm('post', `/engagements/${e.id}/reactivate`, people.ownerA);
    expect([notCancelled.status, codeOf(notCancelled)]).toEqual([409, 'INVALID_STATUS']);

    const late = await create(ids.one, { serviceId: ids.tax, title: 'Late' });
    expectOk(await firm('post', `/engagements/${late.id}/cancel`, people.ownerA, { reason: 'x' }));
    await inFirm((tx) =>
      tx.engagement.update({
        where: { id: late.id },
        data: { cancelledAt: new Date(Date.now() - 91 * DAY) },
      }),
    );
    const window = await firm('post', `/engagements/${late.id}/reactivate`, people.ownerA);
    expect([window.status, codeOf(window)]).toEqual([409, 'REACTIVATION_WINDOW_PASSED']);
  });

  it("an archived client's engagements: no edit or reactivation (409), complete and cancel allowed", async () => {
    const clientId = await inFirm(
      async (tx) =>
        (await tx.client.create({ data: { businessId: ids.firmA, displayName: `Arch ${run}` } }))
          .id,
    );
    const open = await create(clientId, { serviceId: ids.books, title: `Open ${run}` });
    const ended = await create(clientId, { serviceId: ids.books, title: `Ended ${run}` });
    const winding = await create(clientId, { serviceId: ids.books, title: `Winding ${run}` });
    expectOk(await firm('post', `/engagements/${ended.id}/cancel`, people.ownerA, { reason: 'x' }));
    await inFirm((tx) =>
      tx.client.update({ where: { id: clientId }, data: { archivedAt: new Date() } }),
    );
    const refused = await firm('patch', `/engagements/${open.id}`, people.ownerA, {
      title: 'Changed',
    });
    expect([refused.status, codeOf(refused)]).toEqual([409, 'CLIENT_ARCHIVED']);
    const again = await firm('post', `/engagements/${ended.id}/reactivate`, people.ownerA);
    expect([again.status, codeOf(again)]).toEqual([409, 'CLIENT_ARCHIVED']);
    const fresh = await firm('post', `/clients/${clientId}/engagements`, people.ownerA, {
      serviceId: ids.books,
      title: 'New',
    });
    expect([fresh.status, codeOf(fresh)]).toEqual([409, 'CLIENT_ARCHIVED']);
    // Winding the work down stays possible.
    expectOk(await firm('post', `/engagements/${open.id}/complete`, people.ownerA));
    expectOk(
      await firm('post', `/engagements/${winding.id}/cancel`, people.ownerA, { reason: 'x' }),
    );
    const rows = await inFirm((tx) =>
      tx.engagement.findMany({ where: { clientId }, orderBy: { createdAt: 'asc' } }),
    );
    expect(rows.map((r) => [r.title, r.status])).toEqual([
      [`Open ${run}`, 'COMPLETED'],
      [`Ended ${run}`, 'CANCELLED'],
      [`Winding ${run}`, 'CANCELLED'],
    ]);
  });

  it('a completed engagement cancelled and then reactivated keeps no completion date', async () => {
    const e = await create(ids.one, { serviceId: ids.books, title: `Done then back ${run}` });
    expectOk(await firm('post', `/engagements/${e.id}/complete`, people.ownerA));
    expectOk(await firm('post', `/engagements/${e.id}/cancel`, people.ownerA, { reason: 'x' }));
    const back = Engagement.parse(
      expectOk(await firm('post', `/engagements/${e.id}/reactivate`, people.ownerA)).body,
    );
    expect([back.status, back.completedAt, back.cancelledAt]).toEqual(['ACTIVE', null, null]);
  });

  it('history: every status or stage change, newest first, by whom', async () => {
    const res = expectOk(await firm('get', `/engagements/${e.id}/history`, people.ownerA));
    const items = (
      res.body as {
        items: { status: string; stage: string | null; changedBy: { userId: string } | null }[];
      }
    ).items;
    expect(items.map((h) => [h.status, h.stage])).toEqual([
      ['ACTIVE', 'Review'],
      ['CANCELLED', 'Review'],
      ['ACTIVE', 'Review'],
      ['ACTIVE', 'Intake'],
    ]);
    expect(items[0]!.changedBy?.userId).toBe(people.ownerA.id);
  });
});

describe('portal: My Services', () => {
  it("lists only the signed-in client's services, with the last day to cancel", async () => {
    const mine = z
      .strictObject({ items: z.array(Mine) })
      .parse(expectOk(await portal('get', '', people.primary)).body).items;
    const books = mine.find((s) => s.title === 'Monthly books');
    expect(books).toMatchObject({
      recurring: true,
      cancelBy: inDays(46),
      documentAccessUntil: null,
    });
    expect(mine.every((s) => s.title !== 'Not staff')).toBe(true);
    const spouse = z
      .strictObject({ items: z.array(Mine) })
      .parse(expectOk(await portal('get', '', people.spouse)).body).items;
    expect(spouse.map((s) => s.id)).toEqual(mine.map((s) => s.id));
    const other = (expectOk(await portal('get', '', people.other)).body as { items: Mine[] }).items;
    expect(other.map((s) => s.title)).toEqual(['Not staff']);
    expect((await portal('get', '', people.ownerA)).status).toBe(401);
  });

  it('a cancellation request: ACTIVE recurring, in time, once; never for one-time, ended or late services', async () => {
    const all = (expectOk(await portal('get', '', people.primary)).body as { items: Mine[] }).items;
    const books = all.find((s) => s.title === 'Monthly books')!;
    const asked = Mine.parse(
      expectOk(
        await portal('post', `/${books.id}/cancel-request`, people.primary, {
          reason: 'Doing it myself.',
        }),
      ).body,
    );
    expect(asked.cancelRequestedAt).not.toBeNull();
    const again = Mine.parse(
      expectOk(await portal('post', `/${books.id}/cancel-request`, people.primary, {})).body,
    );
    expect(again.cancelRequestedAt).toBe(asked.cancelRequestedAt);
    const stored = await inFirm(async (tx) => ({
      engagement: await tx.engagement.findUniqueOrThrow({ where: { id: books.id } }),
      tasks: await tx.task.findMany({ where: { engagementId: books.id } }),
      audit: await tx.auditLog.findMany({
        where: { action: 'portal.cancellation_requested', entityId: books.id },
        orderBy: { createdAt: 'asc' },
      }),
    }));
    expect(stored.engagement.cancelRequestReason).toBe('Doing it myself.');
    // The firm hears of it: one GENERAL task for the client's assigned staff member.
    expect(stored.tasks).toHaveLength(1);
    expect(stored.tasks[0]).toMatchObject({
      kind: 'GENERAL',
      status: 'OPEN',
      clientId: ids.one,
      assignedUserId: people.staffA.id,
    });
    expect(stored.tasks[0]!.details).toContain('Doing it myself.');
    // Both asks are audited (the repeat as one), with ids only.
    expect(stored.audit.map((r) => r.metadata)).toEqual([
      { clientId: ids.one, taskId: stored.tasks[0]!.id },
      { clientId: ids.one, repeated: true },
    ]);

    const soon = await create(ids.one, {
      serviceId: ids.books,
      title: 'Bills soon',
      nextBillingOn: inDays(5),
    });
    const oneTime = all.find((s) => s.title === '2025 return')!;
    const ended = await create(ids.one, { serviceId: ids.books, title: 'Ended' });
    expectOk(await firm('post', `/engagements/${ended.id}/complete`, people.ownerA));
    const theirs = (
      await inFirm((tx) => tx.engagement.findFirstOrThrow({ where: { clientId: ids.two } }))
    ).id;
    const cases: [string, { email: string }, number, string][] = [
      [soon.id, people.primary, 409, 'TOO_LATE_TO_CANCEL'],
      [oneTime.id, people.primary, 409, 'NOT_RECURRING'],
      [ended.id, people.primary, 409, 'INVALID_STATUS'],
      [books.id, people.spouse, 403, 'FORBIDDEN'],
      [theirs, people.primary, 404, 'NOT_FOUND'],
    ];
    for (const [id, who, status, code] of cases) {
      const res = await portal('post', `/${id}/cancel-request`, who, {});
      expect([res.status, codeOf(res)]).toEqual([status, code]);
    }
  });

  it('a cancellation request for a client with no assignee makes an unassigned task', async () => {
    const e = await create(ids.two, {
      serviceId: ids.books,
      title: `Nobody assigned ${run}`,
      nextBillingOn: inDays(60),
    });
    expectOk(await portal('post', `/${e.id}/cancel-request`, people.other, {}));
    const tasks = await inFirm((tx) => tx.task.findMany({ where: { engagementId: e.id } }));
    expect(tasks.map((t) => [t.kind, t.clientId, t.assignedUserId])).toEqual([
      ['GENERAL', ids.two, null],
    ]);
  });

  it('a next billing date already past sets no deadline: cancelBy is null and the request is taken', async () => {
    const e = await create(ids.one, {
      serviceId: ids.books,
      title: `Stale billing ${run}`,
      nextBillingOn: inDays(30),
    });
    await inFirm((tx) =>
      tx.engagement.update({
        where: { id: e.id },
        data: { nextBillingOn: new Date(`${inDays(-3)}T00:00:00Z`) },
      }),
    );
    const listed = (
      expectOk(await portal('get', '', people.primary)).body as { items: Mine[] }
    ).items.find((m) => m.id === e.id)!;
    expect(listed.cancelBy).toBeNull();
    const asked = Mine.parse(
      expectOk(await portal('post', `/${e.id}/cancel-request`, people.primary, {})).body,
    );
    expect(asked.cancelRequestedAt).not.toBeNull();
  });

  it('after a request, the firm cancel and a reactivation, the client can ask again (stored, audited)', async () => {
    const e = await create(ids.one, {
      serviceId: ids.books,
      title: `Asks again ${run}`,
      nextBillingOn: inDays(60),
    });
    const first = Mine.parse(
      expectOk(
        await portal('post', `/${e.id}/cancel-request`, people.primary, { reason: 'First ask.' }),
      ).body,
    );
    expectOk(await firm('post', `/engagements/${e.id}/cancel`, people.ownerA, { reason: 'x' }));
    expectOk(await firm('post', `/engagements/${e.id}/reactivate`, people.ownerA));
    const cleared = await inFirm((tx) => tx.engagement.findUniqueOrThrow({ where: { id: e.id } }));
    expect([cleared.cancelRequestedAt, cleared.cancelRequestReason]).toEqual([null, null]);
    const second = Mine.parse(
      expectOk(
        await portal('post', `/${e.id}/cancel-request`, people.primary, { reason: 'Second ask.' }),
      ).body,
    );
    expect(second.cancelRequestedAt).not.toBeNull();
    expect(second.cancelRequestedAt).not.toBe(first.cancelRequestedAt);
    const after = await inFirm(async (tx) => ({
      reason: (await tx.engagement.findUniqueOrThrow({ where: { id: e.id } })).cancelRequestReason,
      audited: await tx.auditLog.count({
        where: { action: 'portal.cancellation_requested', entityId: e.id },
      }),
    }));
    expect(after).toEqual({ reason: 'Second ask.', audited: 2 });
  });

  it("a cancelled service keeps its documents open for 60 days from the firm's cancel date", async () => {
    const gone = await create(ids.one, { serviceId: ids.tax, title: 'Gone' });
    expectOk(await firm('post', `/engagements/${gone.id}/cancel`, people.ownerA, { reason: 'x' }));
    const all = (expectOk(await portal('get', '', people.primary)).body as { items: Mine[] }).items;
    const row = all.find((s) => s.id === gone.id)!;
    const cancelDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
      new Date(row.cancelledAt!),
    );
    const until = new Date(Date.parse(`${cancelDay}T00:00:00.000Z`) + 60 * DAY)
      .toISOString()
      .slice(0, 10);
    expect(row).toMatchObject({ status: 'CANCELLED', cancelBy: null, documentAccessUntil: until });
  });
});

describe('audit', () => {
  it('logs reads and changes with ids and field names, never a reason', async () => {
    const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
    const rows = await runInScope(owner, { kind: 'business', businessId: ids.firmA }, (tx) =>
      tx.auditLog.findMany({ where: { businessId: ids.firmA } }),
    );
    await owner.$disconnect();
    const actions = new Set(rows.map((r) => r.action));
    for (const action of [
      'engagements.listed',
      'engagement.created',
      'engagement.updated',
      'engagement.completed',
      'engagement.cancelled',
      'engagement.reactivated',
      'engagement.viewed',
      'engagement.history_viewed',
      'portal.services_viewed',
      'portal.cancellation_requested',
    ]) {
      expect(actions.has(action), action).toBe(true);
    }
    const all = JSON.stringify(rows.map((r) => r.metadata));
    for (const text of ['Client moved away', 'Doing it myself', 'Lifecycle', 'Monthly books']) {
      expect(all).not.toContain(text);
    }
  });
});
