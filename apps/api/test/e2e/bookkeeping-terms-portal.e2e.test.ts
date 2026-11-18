// End-to-end: Client Portal BK-CP3 (R55), the bookkeeping terms the firm sent, in the client's
// portal (contract in packages/types/src/bookkeeping/terms-portal.ts). Sending tells the client;
// the client reads only what left the firm's drafts, in the portal version (no internal notes, no
// discount reasons); the Primary login accepts (in force, the version before replaced) or
// declines (back to draft); each answer is in History, Activity and the audit, and tells the
// firm. Another client's, another firm's or a draft version is 404. Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { z } from 'zod';
import {
  BookkeepingClientWorkspace,
  BookkeepingTerms,
  BookkeepingTermsHistory,
  BookkeepingTermsPage,
  MyBookkeepingTerms as MyTermsShape,
  MyBookkeepingTermsRow as MyRowShape,
  MyTermsDiscount,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

// Strict copies of the portal's shapes, so a leaked field (internalNotes, a reason) fails.
const MyRow = z.strictObject(MyRowShape.shape);
const MyList = z.strictObject({ items: z.array(MyRow) });
const MyTerms = z.strictObject({
  ...MyTermsShape.shape,
  discounts: z.array(z.strictObject(MyTermsDiscount.shape)),
  can: z.strictObject(MyTermsShape.shape.can.shape),
});
type MyTerms = z.infer<typeof MyTerms>;

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `bkcp3-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  staffA2: person('staff-a2'),
  clientA: person('client-a'),
  spouseA: person('spouse-a'),
  authorizedA: person('authorized-a'),
  clientA2: person('client-a2'),
  ownerB: person('owner-b'),
  clientB: person('client-b'),
};
type Who = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', { id: string; slug: string }>;
const clients = {} as Record<'c1' | 'c2' | 'cB', string>;
const bk = {} as Record<'c1' | 'c2' | 'cB', BookkeepingClientWorkspace>;

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.67.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

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
const inFirm = <T>(firm: 'a' | 'b', work: Parameters<typeof runInScope<T>>[2]) =>
  asOwner({ kind: 'business', businessId: firms[firm].id }, work);

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

/** A firm call under /api/v1/business/bookkeeping. */
async function firm(
  method: 'get' | 'post' | 'patch' | 'put',
  path: string,
  who: Who = people.ownerA,
  body?: object,
  at: 'a' | 'b' = 'a',
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business/bookkeeping${path}`)
    .set('x-business-id', firms[at].id)
    .set('x-forwarded-for', viewer())
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}

/** A portal call under /api/v1/portal/{slug}/me/bookkeeping-terms. */
async function portal(
  method: 'get' | 'post',
  path: string,
  who: Who,
  body?: object,
  at: 'a' | 'b' = 'a',
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/portal/${firms[at].slug}/me/bookkeeping-terms${path}`)
    .set('x-forwarded-for', viewer())
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};
const { ownerA, adminA, staffA, clientA, spouseA, authorizedA, clientA2, ownerB, clientB } = people;

const terms = (res: Response, status = 200) => BookkeepingTerms.parse(ok(res, status));
const mine = async (who: Who = clientA, at: 'a' | 'b' = 'a') =>
  MyList.parse(ok(await portal('get', '', who, undefined, at))).items;
const one = async (id: string, who: Who = clientA) =>
  MyTerms.parse(ok(await portal('get', `/${id}`, who)));
/** A new draft for a bookkeeping client, then sent to the client. */
async function sentTerms(id: string, body: object = {}, who: Who = ownerA, at: 'a' | 'b' = 'a') {
  const draft = terms(await firm('post', `/clients/${id}/terms`, who, body, at), 201);
  return terms(await firm('post', `/terms/${draft.id}/send`, who, {}, at));
}
const audits = (action: string, id: string) =>
  inFirm('a', (tx) =>
    tx.auditLog.findMany({
      where: { businessId: firms.a.id, action, entityId: id },
      select: { metadata: true },
    }),
  );
const bells = (eventKeyStart: string, at: 'a' | 'b' = 'a') =>
  inFirm(at, (tx) =>
    tx.notification.findMany({
      where: { businessId: firms[at].id, eventKey: { startsWith: eventKeyStart } },
      select: { recipientUserId: true, entityType: true, entityId: true, payload: true },
      orderBy: { recipientUserId: 'asc' },
    }),
  );

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people))
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: /client|spouse|authorized/i.test(key) ? 'CLIENT' : 'STAFF',
          email: p.email,
          name: `Fake Bkcp3 ${key}`,
        },
      });
    for (const key of ['a', 'b'] as const) {
      const slug = `bkcp3-${key}-${run}`;
      firms[key] = await tx.business.create({
        data: { slug, name: `Firm ${slug}`, status: 'ACTIVE' },
        select: { id: true, slug: true },
      });
    }
  });
  for (const [at, who, role] of [
    ['a', ownerA, 'OWNER'],
    ['a', adminA, 'ADMIN'],
    ['a', staffA, 'STAFF'],
    ['a', people.staffA2, 'STAFF'],
    ['b', ownerB, 'OWNER'],
  ] as const)
    await inFirm(at, (tx) =>
      tx.membership.create({
        data: { businessId: firms[at].id, userId: who.id, role, status: 'ACTIVE' },
      }),
    );
  for (const at of ['a', 'b'] as const)
    await inFirm(at, async (tx) => {
      const businessId = firms[at].id;
      await tx.service.create({
        data: { businessId, kind: 'BOOKKEEPING', name: `Fake books ${run}`, status: 'ACTIVE' },
      });
      const client = (name: string, assignedUserId: string | null = null) =>
        tx.client
          .create({ data: { businessId, displayName: name, assignedUserId }, select: { id: true } })
          .then((c) => c.id);
      const login = (who: Who, clientId: string, portalRole: 'PRIMARY' | 'SPOUSE' | 'AUTHORIZED') =>
        tx.clientAccount.create({
          data: {
            businessId,
            userId: who.id,
            email: who.email,
            clientId,
            portalRole,
            status: 'ACTIVE',
          },
        });
      if (at === 'a') {
        clients.c1 = await client(`Fake Willow Bakery ${run}`, staffA.id);
        clients.c2 = await client(`Fake Turner ${run}`, people.staffA2.id);
        await login(clientA, clients.c1, 'PRIMARY');
        await login(spouseA, clients.c1, 'SPOUSE');
        await login(authorizedA, clients.c1, 'AUTHORIZED');
        await login(clientA2, clients.c2, 'PRIMARY');
      } else {
        clients.cB = await client(`Fake Other Firm Client ${run}`);
        await login(clientB, clients.cB, 'PRIMARY');
      }
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

  const add = async (key: 'c1' | 'c2' | 'cB', who: Who, at: 'a' | 'b') =>
    (bk[key] = BookkeepingClientWorkspace.parse(
      ok(
        await firm('post', '/clients', who, { clientId: clients[key], plan: 'Growth Plan' }, at),
        201,
      ),
    ));
  await add('c1', ownerA, 'a');
  await add('c2', ownerA, 'a');
  await add('cB', ownerB, 'b');
});

afterAll(async () => {
  await app.close();
});

describe('BK-CP3: the client sees the bookkeeping terms that were sent', () => {
  let v1: BookkeepingTerms;

  it('shows nothing of a draft; sending tells the client and lists the version for the household only', async () => {
    const draft = terms(
      await firm('post', `/clients/${bk.c1.id}/terms`, ownerA, {
        monthlyFeeCents: 45_000,
        setupFeeCents: 10_000,
        internalNotes: `Fake internal margin note ${run}`,
        discounts: [
          {
            label: 'Loyalty credit',
            kind: 'PERCENT',
            value: 10,
            reason: `Fake owner favour ${run}`,
          },
        ],
        includedServices: ['Monthly reconciliation'],
        excludedServices: ['Payroll'],
        clientResponsibilities: ['Upload statements by the 5th'],
      }),
      201,
    );
    expect(await mine()).toEqual([]);
    expectError(await portal('get', `/${draft.id}`, clientA), 404, 'NOT_FOUND');

    v1 = terms(await firm('post', `/terms/${draft.id}/send`, ownerA, {}));
    expect(v1.status).toBe('SENT');
    const rows = await mine();
    expect(rows).toEqual([
      {
        id: v1.id,
        serviceId: bk.c1.engagementId,
        serviceTitle: expect.any(String),
        version: 1,
        state: 'AWAITING_ANSWER',
        packageName: 'Growth Plan',
        monthlyFeeCents: 45_000,
        effectiveFrom: v1.effectiveFrom,
        sentAt: v1.sentAt,
        activatedAt: null,
      },
    ]);
    // The spouse reads it too; an Authorized login, another client and another firm see nothing.
    expect((await mine(spouseA)).map((r) => r.id)).toEqual([v1.id]);
    expect(await mine(authorizedA)).toEqual([]);
    expectError(await portal('get', `/${v1.id}`, authorizedA), 404, 'NOT_FOUND');
    expect(await mine(clientA2)).toEqual([]);
    expectError(await portal('get', `/${v1.id}`, clientA2), 404, 'NOT_FOUND');
    expectError(await portal('get', `/${v1.id}`, clientB, undefined, 'b'), 404, 'NOT_FOUND');

    // The send told the client's primary login only, naming the service, never the figures.
    const told = await bells(`bookkeeping-terms.sent:${v1.id}:`);
    expect(told.map((n) => [n.recipientUserId, n.entityType, n.entityId])).toEqual([
      [clientA.id, 'engagement', bk.c1.engagementId],
    ]);
    expect(JSON.stringify(told[0]!.payload)).not.toContain('45000');
    // The listing is audited with counts only.
    expect(await audits('portal.bookkeeping_terms_listed', clients.c1)).not.toHaveLength(0);
  });

  it('opens the portal version only: no internal notes, no discount reasons, audited', async () => {
    const view = await one(v1.id);
    expect(view).toMatchObject({
      id: v1.id,
      state: 'AWAITING_ANSWER',
      monthlyFeeCents: 45_000,
      setupFeeCents: 10_000,
      discounts: [
        { label: 'Loyalty credit', kind: 'PERCENT', value: 10, startsOn: null, endsOn: null },
      ],
      includedServices: ['Monthly reconciliation'],
      excludedServices: ['Payroll'],
      clientResponsibilities: ['Upload statements by the 5th'],
      acceptedAt: null,
      signature: null,
      can: { accept: true, decline: true },
    });
    const text = JSON.stringify(view);
    for (const secret of ['internal margin', 'owner favour', 'internalNotes', 'createdBy'])
      expect(text).not.toContain(secret);
    // The spouse reads, but only the Primary login answers.
    expect((await one(v1.id, spouseA)).can).toEqual({ accept: false, decline: false });
    expect(await audits('portal.bookkeeping_terms_viewed', v1.id)).toContainEqual({
      metadata: expect.objectContaining({ clientId: clients.c1, version: 1 }),
    });
  });

  it('Accept puts the version in force: History, Activity, audit and the firm told', async () => {
    const answer = { sentAt: v1.sentAt! };
    // Another client, another firm and a Spouse login are refused; so is another sending.
    expectError(await portal('post', `/${v1.id}/accept`, clientA2, answer), 404, 'NOT_FOUND');
    expectError(await portal('post', `/${v1.id}/accept`, clientB, answer, 'b'), 404, 'NOT_FOUND');
    expectError(await portal('post', `/${v1.id}/accept`, spouseA, answer), 403, 'FORBIDDEN');
    expectError(
      await portal('post', `/${v1.id}/accept`, clientA, { sentAt: '2026-01-01T00:00:00.000Z' }),
      409,
      'TERMS_CHANGED',
    );

    const accepted = MyTerms.parse(ok(await portal('post', `/${v1.id}/accept`, clientA, answer)));
    expect(accepted).toMatchObject({
      state: 'IN_FORCE',
      acceptedAt: expect.any(String),
      can: { accept: false, decline: false },
    });
    expectError(await portal('post', `/${v1.id}/accept`, clientA, answer), 409, 'TERMS_STATE');

    // The firm's page: in force, with the client's answer in History (no staff author).
    const page = BookkeepingTermsPage.parse(ok(await firm('get', `/clients/${bk.c1.id}/terms`)));
    expect(page.current?.id).toBe(v1.id);
    const history = BookkeepingTermsHistory.parse(
      ok(await firm('get', `/clients/${bk.c1.id}/terms/history?kind=ACTIVATED`)),
    );
    expect(history.items[0]).toMatchObject({
      termsId: v1.id,
      details: { version: 1, signed: false, by: 'CLIENT' },
      actorName: null,
    });
    const ws = BookkeepingClientWorkspace.parse(ok(await firm('get', `/clients/${bk.c1.id}`)));
    expect(ws.recentActivity.map((a) => a.summary)).toContain(
      'Terms version 1: accepted by the client in the portal',
    );
    expect(await audits('bookkeeping_terms.client_accepted', v1.id)).toEqual([
      {
        metadata: {
          from: 'SENT',
          to: 'ACTIVE',
          supersededTermsId: null,
          clientId: clients.c1,
          clientAccountId: expect.any(String),
          by: 'CLIENT',
        },
      },
    ]);
    // The client's assigned member and the Owners and Admins, opening the Terms page.
    const told = await bells(`bookkeeping-terms.client-accepted:${v1.id}:`);
    expect(told.map((n) => n.recipientUserId).sort()).toEqual(
      [ownerA.id, adminA.id, staffA.id].sort(),
    );
    expect(
      told.every((n) => n.entityType === 'bookkeeping_client' && n.entityId === bk.c1.id),
    ).toBe(true);
  });

  it('a new version accepted replaces the one in force; Decline sends one back to the firm as a draft', async () => {
    const v2 = await sentTerms(bk.c1.id, { monthlyFeeCents: 50_000 });
    expect((await mine()).map((r) => [r.version, r.state])).toEqual([
      [2, 'AWAITING_ANSWER'],
      [1, 'IN_FORCE'],
    ]);
    ok(await portal('post', `/${v2.id}/accept`, clientA, { sentAt: v2.sentAt }));
    expect((await mine()).map((r) => [r.version, r.state])).toEqual([
      [2, 'IN_FORCE'],
      [1, 'REPLACED'],
    ]);
    expect((await audits('bookkeeping_terms.client_accepted', v2.id))[0]!.metadata).toMatchObject({
      supersededTermsId: v1.id,
    });

    const v3 = await sentTerms(bk.c1.id, { monthlyFeeCents: 60_000 });
    expectError(
      await portal('post', `/${v3.id}/decline`, spouseA, { sentAt: v3.sentAt }),
      403,
      'FORBIDDEN',
    );
    expect(
      ok(
        await portal('post', `/${v3.id}/decline`, clientA, {
          sentAt: v3.sentAt,
          reason: 'The fee is higher than we agreed',
        }),
      ),
    ).toEqual({ ok: true });
    // Back with the firm as a draft: gone from the client's portal.
    expectError(await portal('get', `/${v3.id}`, clientA), 404, 'NOT_FOUND');
    expect((await mine()).map((r) => r.version)).toEqual([2, 1]);
    const back = terms(await firm('get', `/terms/${v3.id}`));
    expect(back.status).toBe('DRAFT');
    const history = BookkeepingTermsHistory.parse(
      ok(await firm('get', `/clients/${bk.c1.id}/terms/history?kind=NOTE`)),
    );
    expect(history.items[0]).toMatchObject({
      termsId: v3.id,
      reason: 'Declined by the client in the portal: The fee is higher than we agreed',
      details: { from: 'SENT', to: 'DRAFT', by: 'CLIENT' },
      actorName: null,
    });
    // The audit has ids only, never the client's words.
    const audit = await audits('bookkeeping_terms.client_declined', v3.id);
    expect(audit).toEqual([
      {
        metadata: {
          from: 'SENT',
          to: 'DRAFT',
          clientId: clients.c1,
          clientAccountId: expect.any(String),
          by: 'CLIENT',
          withReason: true,
        },
      },
    ]);
    expect((await bells(`bookkeeping-terms.client-declined:${v3.id}:`)).length).toBe(3);

    // Sent again: a new sending, so an answer to the old one is refused.
    const again = terms(await firm('post', `/terms/${v3.id}/send`, ownerA, {}));
    expectError(
      await portal('post', `/${v3.id}/accept`, clientA, { sentAt: v3.sentAt }),
      409,
      'TERMS_CHANGED',
    );
    expect((await one(v3.id)).sentAt).toBe(again.sentAt);
  });

  it('Accept waits for the Firm Sign request linked to the terms while it waits for signatures', async () => {
    const v3 = (await mine()).find((r) => r.state === 'AWAITING_ANSWER')!;
    const esign = await inFirm('a', async (tx) => {
      const row = await tx.esignRequest.create({
        data: {
          businessId: firms.a.id,
          title: 'Fake engagement letter',
          source: 'CLIENT_RECORD',
          clientId: clients.c1,
          senderUserId: ownerA.id,
          routing: 'SEQUENTIAL',
          expiryDays: 30,
          reminderFirstAfterDays: 3,
          reminderEveryDays: 3,
          reminderMax: 3,
          expiryWarningDays: 2,
        },
        select: { id: true },
      });
      await tx.esignRequest.update({
        where: { id: row.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          expiresAt: new Date(Date.now() + 30 * 86_400_000),
          originalSha256: 'a'.repeat(64),
        },
      });
      return row.id;
    });
    terms(await firm('put', `/terms/${v3.id}/agreement`, ownerA, { esignRequestId: esign }));
    expect(await one(v3.id)).toMatchObject({
      signature: 'WAITING',
      can: { accept: false, decline: true },
    });
    expectError(
      await portal('post', `/${v3.id}/accept`, clientA, { sentAt: v3.sentAt }),
      409,
      'SIGNATURE_PENDING',
    );
    await inFirm('a', async (tx) => {
      await tx.esignRequest.update({ where: { id: esign }, data: { status: 'PARTIALLY_SIGNED' } });
      await tx.esignRequest.update({
        where: { id: esign },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          finalSha256: 'b'.repeat(64),
          certificateSha256: 'c'.repeat(64),
        },
      });
    });
    expect((await one(v3.id)).signature).toBe('SIGNED');
    expect(
      MyTerms.parse(ok(await portal('post', `/${v3.id}/accept`, clientA, { sentAt: v3.sentAt })))
        .state,
    ).toBe('IN_FORCE');
  });

  it("another firm's client sees only its own firm's terms", async () => {
    const theirs = await sentTerms(bk.cB.id, {}, ownerB, 'b');
    expect((await mine(clientB, 'b')).map((r) => r.id)).toEqual([theirs.id]);
    // Firm A's client has no login at firm B; firm A's terms never show there.
    expectError(await portal('get', `/${theirs.id}`, clientA), 404, 'NOT_FOUND');
    expect((await mine()).map((r) => r.id)).not.toContain(theirs.id);
  });
});
