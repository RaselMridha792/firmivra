// End-to-end: D4 and D5 (Octavia's Oct 25 dashboard review), Settings > Dashboard Cards
// (/business/settings/dashboard-cards) and the dashboard's service cards (summary.serviceCards).
// Each card's number is what the list it opens shows, for the same member; Owner and Admin change
// them; a stale change is 409; firm B never sees or changes firm A's. Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  DashboardCardPreview,
  DashboardCardSettings,
  DashboardCardTemplate,
  type DashboardServiceCard,
  DashboardSummary,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { TokenService } from '../../src/auth/token.service.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `d4-${key}-${run}@d4.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  ownerB: person('owner-b'),
};
type Person = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', { id: string }>;
const ids = {} as { bookkeeping: string; tax: string; serviceB: string };

let app: INestApplication;
const db = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
const inFirm = <T>(k: 'a' | 'b', work: (tx: TxClient) => Promise<T>) =>
  runInScope(db, { kind: 'business', businessId: firms[k].id }, work);

async function call(
  method: 'get' | 'post' | 'patch' | 'put',
  path: string,
  who: Person,
  firm: 'a' | 'b' = 'a',
  body?: object,
) {
  const { token } = await app.get(TokenService).signLocal(who.id, 'STAFF');
  const req = request(app.getHttpServer())
    [method](`/api/v1${path}`)
    .set('x-business-id', firms[firm].id)
    .set('authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body);
}
const CARDS = '/business/settings/dashboard-cards';
const codeOf = (res: request.Response) => (res.body as { error?: { code?: string } }).error?.code;

async function cards(who: Person = people.ownerA, firm: 'a' | 'b' = 'a', query = '') {
  const res = await call('get', `/business/dashboard/summary${query}`, who, firm);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return DashboardSummary.parse(res.body);
}
/** The total of the list a card opens, read by the same member. */
async function listTotal(who: Person, card: DashboardServiceCard): Promise<number> {
  const q = new URLSearchParams(card.link.query).toString();
  const path =
    card.link.list === 'clients' ? `/business/clients?${q}` : `/business/tax-returns?${q}`;
  const res = await call('get', path, who);
  expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(200);
  return (res.body as { total: number }).total;
}
const create = (body: object, who: Person = people.ownerA, firm: 'a' | 'b' = 'a') =>
  call('post', CARDS, who, firm, body);

beforeAll(async () => {
  await runInScope(db, { kind: 'platform' }, async (tx) => {
    await tx.user.createMany({
      data: Object.entries(people).map(([key, p]) => ({
        ...p,
        cognitoSub: p.id,
        pool: 'STAFF',
        name: `Fake D4 ${key}`,
      })),
    });
    for (const key of ['a', 'b'] as const) {
      firms[key] = await tx.business.create({
        data: { slug: `d4-${key}-${run}`, name: `D4 ${key} (fake)`, status: 'ACTIVE' },
        select: { id: true },
      });
    }
  });
  for (const [k, userId, role] of [
    ['a', people.ownerA.id, 'OWNER'],
    ['a', people.adminA.id, 'ADMIN'],
    ['a', people.staffA.id, 'STAFF'],
    ['b', people.ownerB.id, 'OWNER'],
  ] as const) {
    await inFirm(k, (tx) =>
      tx.membership.create({ data: { businessId: firms[k].id, userId, role, status: 'ACTIVE' } }),
    );
  }

  await inFirm('a', async (tx) => {
    const businessId = firms.a.id;
    const client = (key: string, extra: object = {}) =>
      tx.client
        .create({ data: { businessId, displayName: `D4 ${key} (fake)`, ...extra } })
        .then((c) => c.id);
    // c1 is Staff's; c2 and c3 are not.
    const c1 = await client('c1', { assignedUserId: people.staffA.id });
    const c2 = await client('c2');
    const c3 = await client('c3');
    const service = (kind: 'BOOKKEEPING' | 'ANNUAL_TAX', name: string) =>
      tx.service.create({ data: { businessId, kind, name } }).then((s) => s.id);
    ids.bookkeeping = await service('BOOKKEEPING', 'Bookkeeping (fake)');
    ids.tax = await service('ANNUAL_TAX', 'Personal Tax (fake)');
    const engagement = (clientId: string, serviceId: string, extra: object = {}) =>
      tx.engagement.create({
        data: { businessId, clientId, serviceId, title: 'Fake engagement', ...extra },
      });
    // Bookkeeping: c1 and c2 Active, c3 Completed today.
    await engagement(c1, ids.bookkeeping);
    await engagement(c2, ids.bookkeeping);
    await engagement(c3, ids.bookkeeping, { status: 'COMPLETED', completedAt: new Date() });
    // Tax: c1's return in the tax service (in progress), c2's with no engagement.
    const taxEngagement = await engagement(c1, ids.tax, { taxYear: 2025 });
    await tx.taxReturn.create({
      data: {
        businessId,
        clientId: c1,
        engagementId: taxEngagement.id,
        taxYear: 2025,
        filingType: 'INDIVIDUAL',
      },
    });
    await tx.taxReturn.create({
      data: { businessId, clientId: c2, taxYear: 2025, filingType: 'INDIVIDUAL' },
    });
  });
  ids.serviceB = await inFirm('b', (tx) =>
    tx.service
      .create({ data: { businessId: firms.b.id, kind: 'BOOKKEEPING', name: 'B Bookkeeping' } })
      .then((s) => s.id),
  );

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
}, 120_000);

afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});

describe('D5: a firm with no cards saved', () => {
  it('shows Returns In Progress and Accepted Returns, the same numbers as the KPIs', async () => {
    const s = await cards();
    expect(s.serviceCards.map((c) => c.label)).toEqual(['Returns In Progress', 'Accepted Returns']);
    expect(s.serviceCards[0]).toMatchObject({
      value: s.kpis.returnsInProgress.value,
      link: { list: 'tax-returns', query: { workflowGroup: 'IN_PROGRESS' } },
    });
    expect(s.serviceCards[1]).toMatchObject({
      value: s.kpis.acceptedReturns.value,
      link: { list: 'tax-returns', query: { workflowStatus: 'ACCEPTED' } },
    });
    const settings = DashboardCardSettings.parse((await call('get', CARDS, people.ownerA)).body);
    expect(settings).toMatchObject({ items: [], usingDefaults: true });
    expect(settings.services.map((x) => x.id).sort()).toEqual([ids.bookkeeping, ids.tax].sort());
  });
});

describe('D4: Settings > Dashboard Cards', () => {
  it('Staff may not read or change the cards; a client never', async () => {
    expect((await call('get', CARDS, people.staffA)).status).toBe(403);
    expect(
      (
        await create(
          { serviceId: ids.bookkeeping, metric: 'ACTIVE_ENGAGEMENTS', statusKey: null, label: 'X' },
          people.staffA,
        )
      ).status,
    ).toBe(403);
  });

  it('refuses choices that do not fit, and a label that would disguise the count', async () => {
    const cases: [object, string][] = [
      [
        { serviceId: null, metric: 'ACTIVE_ENGAGEMENTS', statusKey: null, label: 'Active' },
        'SERVICE_REQUIRED',
      ],
      [
        {
          serviceId: ids.bookkeeping,
          metric: 'ACTIVE_ENGAGEMENTS',
          statusKey: 'engagement:ACTIVE',
          label: 'Active',
        },
        'STATUS_NOT_ALLOWED',
      ],
      [
        {
          serviceId: ids.bookkeeping,
          metric: 'ENGAGEMENTS_IN_STATUS',
          statusKey: null,
          label: 'Active',
        },
        'STATUS_REQUIRED',
      ],
      [
        {
          serviceId: ids.bookkeeping,
          metric: 'ENGAGEMENTS_IN_STATUS',
          statusKey: 'tax:ACCEPTED',
          label: 'Accepted Returns',
        },
        'STATUS_NOT_FOR_SERVICE',
      ],
      [
        {
          serviceId: ids.bookkeeping,
          metric: 'COMPLETED_IN_PERIOD',
          statusKey: 'engagement:ACTIVE',
          label: 'Done',
        },
        'STATUS_NOT_ALLOWED',
      ],
      // A tax word on a clients count, and a clients word on a tax count.
      [
        {
          serviceId: ids.bookkeeping,
          metric: 'ACTIVE_ENGAGEMENTS',
          statusKey: null,
          label: 'Accepted Returns',
        },
        'LABEL_MISMATCH',
      ],
      [
        {
          serviceId: null,
          metric: 'ENGAGEMENTS_IN_STATUS',
          statusKey: 'tax:IN_PROGRESS',
          label: 'Active Bookkeeping',
        },
        'LABEL_MISMATCH',
      ],
    ];
    for (const [body, code] of cases) {
      const res = await create(body);
      expect([res.status, codeOf(res)], JSON.stringify(body)).toEqual([400, code]);
    }
    // Firm B's service is not one of firm A's.
    const foreign = await create({
      serviceId: ids.serviceB,
      metric: 'ACTIVE_ENGAGEMENTS',
      statusKey: null,
      label: 'Active Bookkeeping',
    });
    expect(foreign.status).toBe(404);
    expect(
      DashboardCardSettings.parse((await call('get', CARDS, people.ownerA)).body).items,
    ).toEqual([]);
  });

  let bookkeepingCard: DashboardCardTemplate;
  it('a saved card replaces the defaults; its count is the list it opens, for Owner and Staff', async () => {
    const res = await create({
      serviceId: ids.bookkeeping,
      metric: 'ENGAGEMENTS_IN_STATUS',
      statusKey: 'engagement:ACTIVE',
      label: 'Active Bookkeeping',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    bookkeepingCard = DashboardCardTemplate.parse(res.body);
    expect(bookkeepingCard).toMatchObject({
      slot: 1,
      enabled: true,
      version: 1,
      service: { id: ids.bookkeeping, kind: 'BOOKKEEPING' },
      updatedBy: { userId: people.ownerA.id },
    });

    const owner = await cards(people.ownerA);
    expect(owner.serviceCards.map((c) => c.label)).toEqual(['Active Bookkeeping']);
    const [card] = owner.serviceCards;
    expect(card).toMatchObject({
      value: 2,
      link: {
        list: 'clients',
        query: { serviceId: ids.bookkeeping, engagementStatus: 'ACTIVE' },
      },
    });
    expect(await listTotal(people.ownerA, card!)).toBe(2);
    // Staff count only their own client, as their list shows.
    const [mine] = (await cards(people.staffA)).serviceCards;
    expect(mine!.value).toBe(1);
    expect(await listTotal(people.staffA, mine!)).toBe(1);

    const audit = await inFirm('a', (tx) =>
      tx.auditLog.findMany({
        where: { businessId: firms.a.id, action: 'dashboard_card.created' },
        select: { entityId: true, actorUserId: true },
      }),
    );
    expect(audit).toEqual([{ entityId: bookkeepingCard.id, actorUserId: people.ownerA.id }]);
  });

  it('Completed in the period and a tax service card agree with their lists', async () => {
    const done = await create(
      {
        serviceId: ids.bookkeeping,
        metric: 'COMPLETED_IN_PERIOD',
        statusKey: 'engagement:COMPLETED',
        label: 'Bookkeeping Completed',
      },
      people.adminA,
    );
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    const tax = await create({
      serviceId: ids.tax,
      metric: 'ENGAGEMENTS_IN_STATUS',
      statusKey: 'tax:IN_PROGRESS',
      label: 'Personal Returns In Progress',
    });
    expect(tax.status, JSON.stringify(tax.body)).toBe(201);
    const s = await cards();
    const [, completed, returns] = s.serviceCards;
    expect(completed).toMatchObject({
      value: 1,
      link: {
        list: 'clients',
        query: {
          engagementStatus: 'COMPLETED',
          completedFrom: s.range.from,
          completedTo: s.range.to,
        },
      },
    });
    expect(await listTotal(people.ownerA, completed!)).toBe(1);
    // Only the return prepared in the tax service, not c2's with no engagement.
    expect(returns).toMatchObject({
      value: 1,
      link: { list: 'tax-returns', query: { workflowGroup: 'IN_PROGRESS', serviceId: ids.tax } },
    });
    expect(await listTotal(people.ownerA, returns!)).toBe(1);
  });

  it('a change needs the version it was read at (409 otherwise); a card switched off is not shown', async () => {
    const body = {
      serviceId: ids.bookkeeping,
      metric: 'ENGAGEMENTS_IN_STATUS',
      statusKey: 'engagement:ACTIVE',
      label: 'Bookkeeping Clients',
      enabled: false,
    };
    const ok = await call('patch', `${CARDS}/${bookkeepingCard.id}`, people.ownerA, 'a', {
      ...body,
      version: 1,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(DashboardCardTemplate.parse(ok.body)).toMatchObject({ version: 2, enabled: false });
    const late = await call('patch', `${CARDS}/${bookkeepingCard.id}`, people.adminA, 'a', {
      ...body,
      enabled: true,
      version: 1,
    });
    expect([late.status, codeOf(late)]).toEqual([409, 'STALE_VERSION']);
    expect((await cards()).serviceCards.map((c) => c.label)).toEqual([
      'Bookkeeping Completed',
      'Personal Returns In Progress',
    ]);
  });

  it('a new order moves the cards between the slots; the ones not named follow', async () => {
    const list = async () =>
      DashboardCardSettings.parse((await call('get', CARDS, people.ownerA)).body).items;
    const before = await list();
    const last = before[2]!.id;
    for (const ids of [
      [last, last],
      [last, randomUUID()],
    ]) {
      const bad = await call('put', `${CARDS}/order`, people.ownerA, 'a', { ids });
      expect(bad.status, JSON.stringify(ids)).toBe(400);
    }
    // Only the last named: it moves to slot 1, the others follow as they were.
    const first = await call('put', `${CARDS}/order`, people.ownerA, 'a', { ids: [last] });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const moved = DashboardCardSettings.parse(first.body).items;
    expect(moved.map((c) => c.label)).toEqual([
      before[2]!.label,
      before[0]!.label,
      before[1]!.label,
    ]);
    // Back as it was, then reversed in full.
    await call('put', `${CARDS}/order`, people.ownerA, 'a', {
      ids: before.map((b) => moved.find((m) => m.label === b.label)!.id),
    });
    const now = await list();
    expect(now.map((c) => c.label)).toEqual(before.map((c) => c.label));
    const res = await call('put', `${CARDS}/order`, people.ownerA, 'a', {
      ids: [...now].reverse().map((c) => c.id),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = DashboardCardSettings.parse(res.body).items;
    expect(after.map((c) => c.label)).toEqual([...before].reverse().map((c) => c.label));
    expect(after.map((c) => c.slot)).toEqual([1, 2, 3]);
    expect((await cards()).serviceCards.map((c) => c.label)).toEqual([
      'Personal Returns In Progress',
      'Bookkeeping Completed',
    ]);
  });

  it('six cards at most (409 CARDS_FULL)', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await create({
        serviceId: ids.bookkeeping,
        metric: 'ACTIVE_ENGAGEMENTS',
        statusKey: null,
        label: `Bookkeeping ${i}`,
        enabled: false,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
    const full = await create({
      serviceId: ids.bookkeeping,
      metric: 'ACTIVE_ENGAGEMENTS',
      statusKey: null,
      label: 'One too many',
    });
    expect([full.status, codeOf(full)]).toEqual([409, 'CARDS_FULL']);
  });

  it('a member who may not view Clients gets no clients card, and it is not counted', async () => {
    await inFirm('a', async (tx) => {
      const m = await tx.membership.findFirstOrThrow({
        where: { businessId: firms.a.id, userId: people.staffA.id },
        select: { id: true },
      });
      await tx.memberPermission.create({
        data: {
          businessId: firms.a.id,
          membershipId: m.id,
          module: 'CLIENTS',
          capability: 'VIEW',
          granted: false,
        },
      });
    });
    // The grid is cached per member for a moment.
    await expect
      .poll(async () => (await cards(people.staffA)).serviceCards.map((c) => c.link.list), {
        timeout: 15_000,
      })
      .toEqual(['tax-returns']);
  });

  it("the preview counts a card for This Month and saves nothing; firm B's own cards are its own", async () => {
    const res = await call('post', `${CARDS}/preview`, people.adminA, 'a', {
      serviceId: ids.bookkeeping,
      metric: 'ACTIVE_ENGAGEMENTS',
      statusKey: null,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(DashboardCardPreview.parse(res.body)).toMatchObject({
      value: 2,
      link: { list: 'clients', query: { serviceId: ids.bookkeeping, engagementStatus: 'ACTIVE' } },
    });

    // Firm B: firm A's cards are not found, and B's dashboard still has the defaults.
    const card = DashboardCardSettings.parse((await call('get', CARDS, people.ownerA)).body)
      .items[0]!;
    const theirs = await call('patch', `${CARDS}/${card.id}`, people.ownerB, 'b', {
      serviceId: null,
      metric: 'ENGAGEMENTS_IN_STATUS',
      statusKey: 'tax:IN_PROGRESS',
      label: 'Returns',
      enabled: true,
      version: card.version,
    });
    expect(theirs.status).toBe(404);
    const b = await cards(people.ownerB, 'b');
    expect(b.serviceCards.map((c) => c.label)).toEqual(['Returns In Progress', 'Accepted Returns']);
    expect(
      DashboardCardSettings.parse((await call('get', CARDS, people.ownerB, 'b')).body),
    ).toMatchObject({ items: [], usingDefaults: true, services: [{ id: ids.serviceB }] });
  });
});

describe('Dashboard Review 2 (K4, V1): a past period', () => {
  it('opens each card on the list as it stood at the period end, the same number', async () => {
    const DAY = 86_400_000;
    // A return made 70 days ago in the tax service, Accepted only now: last month it was in
    // progress, today it is not.
    await inFirm('a', async (tx) => {
      const businessId = firms.a.id;
      const c = await tx.client.create({
        data: {
          businessId,
          displayName: 'D4 then (fake)',
          createdAt: new Date(Date.now() - 80 * DAY),
        },
      });
      const e = await tx.engagement.create({
        data: {
          businessId,
          clientId: c.id,
          serviceId: ids.tax,
          title: 'Fake 2024 engagement',
          taxYear: 2024,
          createdAt: new Date(Date.now() - 75 * DAY),
        },
      });
      const r = await tx.taxReturn.create({
        data: {
          businessId,
          clientId: c.id,
          engagementId: e.id,
          taxYear: 2024,
          filingType: 'INDIVIDUAL',
          createdAt: new Date(Date.now() - 70 * DAY),
        },
      });
      await tx.taxReturn.update({
        where: { id: r.id },
        data: { workflowStatus: 'ACCEPTED', filedOn: new Date() },
      });
    });
    const then = await cards(people.ownerA, 'a', '?period=LAST_MONTH');
    const returns = then.serviceCards.find((c) => c.label === 'Personal Returns In Progress');
    expect(returns).toMatchObject({
      value: 1,
      link: { list: 'tax-returns', query: { workflowGroup: 'IN_PROGRESS', asOf: then.range.to } },
    });
    const now = await cards(people.ownerA, 'a');
    expect(
      now.serviceCards.find((c) => c.label === 'Personal Returns In Progress')?.link.query,
    ).not.toHaveProperty('asOf');
    for (const who of [people.ownerA, people.staffA]) {
      for (const query of ['', '?period=LAST_MONTH', '?period=LAST_YEAR']) {
        const s = await cards(who, 'a', query);
        for (const card of s.serviceCards) {
          expect([query, card.label, await listTotal(who, card)]).toEqual([
            query,
            card.label,
            card.value,
          ]);
        }
      }
    }
  });
});
