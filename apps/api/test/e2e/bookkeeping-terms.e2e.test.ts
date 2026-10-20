// End-to-end: R55, a bookkeeping client's Terms (contract in packages/types/src/bookkeeping/
// terms.ts): New Terms, edits of a draft only, send, back to draft, the signed agreement,
// activation superseding the version before, notices, termination, History and the Payment
// Schedule. Owner and Admin change; Staff read their assigned clients; firm B reaches nothing.
import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  BookkeepingClientWorkspace,
  BookkeepingPaymentSchedule,
  BookkeepingTerms,
  BookkeepingTermsEvent,
  BookkeepingTermsHistory,
  BookkeepingTermsPage,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55t-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  ownerB: person('owner-b'),
};
type Who = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', string>;

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.66.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

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
  asOwner({ kind: 'business', businessId: firms[firm] }, work);

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

type Method = 'get' | 'post' | 'patch' | 'put';
async function call(
  method: Method,
  path: string,
  who: Who,
  body?: object,
  firm: 'a' | 'b' = 'a',
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business/bookkeeping${path}`)
    .set('x-business-id', firms[firm])
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
const { ownerA, adminA, staffA, ownerB } = people;
const clients = {} as Record<'assigned' | 'other', string>;
const bk = {} as Record<'assigned' | 'other', BookkeepingClientWorkspace>;
const docs = {} as Record<'agreement' | 'signed' | 'otherClient', string>;

const terms = (res: Response, status = 200) => BookkeepingTerms.parse(ok(res, status));
const pageOf = async (id: string, who: Who = ownerA) =>
  BookkeepingTermsPage.parse(ok(await call('get', `/clients/${id}/terms`, who)));

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people))
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: 'STAFF',
          email: p.email,
          name: `Fake R55t ${key}`,
        },
      });
    for (const key of ['a', 'b'] as const) {
      const slug = `r55t-${key}-${run}`;
      firms[key] = (
        await tx.business.create({
          data: { slug, name: `Firm ${slug}`, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
    }
  });
  for (const [firm, key, role] of [
    ['a', 'ownerA', 'OWNER'],
    ['a', 'adminA', 'ADMIN'],
    ['a', 'staffA', 'STAFF'],
    ['b', 'ownerB', 'OWNER'],
  ] as const)
    await inFirm(firm, (tx) =>
      tx.membership.create({
        data: { businessId: firms[firm], userId: people[key].id, role, status: 'ACTIVE' },
      }),
    );
  await inFirm('a', async (tx) => {
    await tx.service.create({
      data: {
        businessId: firms.a,
        kind: 'BOOKKEEPING',
        name: `Fake books ${run}`,
        status: 'ACTIVE',
      },
    });
    clients.assigned = (
      await tx.client.create({
        data: {
          businessId: firms.a,
          displayName: `Fake Green Leaf Cafe ${run}`,
          assignedUserId: staffA.id,
        },
      })
    ).id;
    clients.other = (
      await tx.client.create({ data: { businessId: firms.a, displayName: `Fake Turner ${run}` } })
    ).id;
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

  for (const key of ['assigned', 'other'] as const)
    bk[key] = BookkeepingClientWorkspace.parse(
      ok(
        await call('post', '/clients', ownerA, { clientId: clients[key], plan: 'Growth Plan' }),
        201,
      ),
    );
  await inFirm('a', async (tx) => {
    const doc = (clientId: string, engagementId: string, name: string) =>
      tx.document
        .create({
          data: {
            businessId: firms.a,
            clientId,
            engagementId,
            direction: 'FIRM_TO_CLIENT',
            fileName: name,
            contentType: 'application/pdf',
            sizeBytes: 9,
            sha256: createHash('sha256')
              .update(name + run)
              .digest('hex'),
            s3Key: `tenant/${firms.a}/documents/${randomUUID()}`,
          },
          select: { id: true },
        })
        .then((d) => d.id);
    docs.agreement = await doc(clients.assigned, bk.assigned.engagementId, 'Fake agreement.pdf');
    docs.signed = await doc(clients.assigned, bk.assigned.engagementId, 'Fake signed.pdf');
    docs.otherClient = await doc(clients.other, bk.other.engagementId, 'Fake other.pdf');
  });
});

afterAll(async () => {
  await app.close();
});

describe('Terms', () => {
  let v1: BookkeepingTerms;
  let v2: BookkeepingTerms;

  it('starts empty, then New Terms is a draft from the package', async () => {
    const empty = await pageOf(bk.assigned.id);
    expect(empty).toMatchObject({ current: null, draft: null, versions: [] });
    v1 = terms(await call('post', `/clients/${bk.assigned.id}/terms`, ownerA, {}), 201);
    expect(v1).toMatchObject({
      version: 1,
      status: 'DRAFT',
      packageName: 'Growth Plan',
      renewalType: 'AUTO',
      billingFrequency: 'MONTHLY',
      paymentTerms: 'DUE_ON_RECEIPT',
      can: { edit: true, send: true, activate: true, terminate: false },
    });
    expectError(
      await call('post', `/clients/${bk.assigned.id}/terms`, adminA, {}),
      409,
      'TERMS_DRAFT_EXISTS',
    );
  });

  it("edits a draft's six tabs and records what changed", async () => {
    v1 = terms(
      await call('patch', `/terms/${v1.id}`, adminA, {
        startDate: '2026-01-15',
        endDate: '2027-01-15',
        monthlyFeeCents: 29_000,
        paymentTerms: 'NET_7',
        preferredPaymentMethod: 'Auto-Debit (ACH)',
        lateFeeRule: { amountCents: 2_500, afterDays: 7 },
        additionalBilling: [{ service: 'Payroll processing', billing: 'SEPARATE' }],
        includedServices: ['Transaction categorization', 'Bank & credit card reconciliations'],
        excludedServices: ['Payroll processing', 'Sales tax filing'],
        internalNotes: 'Client asked for a quarterly call',
      }),
    );
    expect(v1).toMatchObject({
      monthlyFeeCents: 29_000,
      endDate: '2027-01-15',
      lateFeeRule: { amountCents: 2_500, afterDays: 7 },
      excludedServices: ['Payroll processing', 'Sales tax filing'],
      internalNotes: 'Client asked for a quarterly call',
    });
    // Staff read their assigned client's terms, without the internal notes, and change nothing.
    const asStaff = await pageOf(bk.assigned.id, staffA);
    expect(asStaff.draft).toMatchObject({ internalNotes: null, can: { edit: false } });
    expectError(
      await call('patch', `/terms/${v1.id}`, staffA, { monthlyFeeCents: 1 }),
      403,
      'FORBIDDEN',
    );
    expectError(await call('get', `/clients/${bk.other.id}/terms`, staffA), 404, 'NOT_FOUND');
    expectError(
      await call('patch', `/terms/${v1.id}`, ownerA, { paymentTerms: 'CUSTOM' }),
      400,
      'VALIDATION_FAILED',
    );
    const history = BookkeepingTermsHistory.parse(
      ok(await call('get', `/clients/${bk.assigned.id}/terms/history`, ownerA)),
    );
    const pricing = history.items.find((e) => e.kind === 'PRICING_CHANGED');
    expect(pricing?.details).toMatchObject({ monthlyFeeCents: { from: 0, to: 29_000 } });
    expect(history.items.map((e) => e.kind)).toEqual(
      expect.arrayContaining(['CREATED', 'PRICING_CHANGED', 'SCOPE_CHANGED', 'RENEWAL_CHANGED']),
    );
  });

  it('sends, takes back, and refuses edits once sent', async () => {
    v1 = terms(await call('post', `/terms/${v1.id}/send`, ownerA, { note: 'Emailed for review' }));
    expect(v1.status).toBe('SENT');
    expect(v1.sentAt).toBeTruthy();
    expectError(
      await call('patch', `/terms/${v1.id}`, ownerA, { monthlyFeeCents: 1 }),
      409,
      'TERMS_STATE',
    );
    expect(terms(await call('post', `/terms/${v1.id}/back-to-draft`, ownerA)).status).toBe('DRAFT');
    expect(terms(await call('post', `/terms/${v1.id}/send`, ownerA, {})).status).toBe('SENT');
  });

  it('wants the signed agreement before activation, and links only this client’s documents', async () => {
    expectError(
      await call('post', `/terms/${v1.id}/activate`, ownerA, {}),
      409,
      'AGREEMENT_NOT_SIGNED',
    );
    expectError(
      await call('put', `/terms/${v1.id}/agreement`, ownerA, {
        signedAgreementDocumentId: docs.otherClient,
      }),
      409,
      'NOT_THIS_CLIENTS',
    );
    expectError(
      await call('put', `/terms/${v1.id}/agreement`, ownerA, { signed: true }),
      409,
      'AGREEMENT_NOT_SIGNED',
    );
    // The agreement to sign changes on a draft only (this one is SENT).
    expectError(
      await call('put', `/terms/${v1.id}/agreement`, ownerA, {
        agreementDocumentId: docs.agreement,
      }),
      409,
      'TERMS_STATE',
    );
    v1 = terms(
      await call('put', `/terms/${v1.id}/agreement`, ownerA, {
        signedAgreementDocumentId: docs.signed,
        signed: true,
      }),
    );
    expect(v1.documents).toMatchObject({
      signedAgreement: { id: docs.signed, name: 'Fake signed.pdf' },
    });
    expect(v1.documents.signedAt).toBeTruthy();
    v1 = terms(await call('post', `/terms/${v1.id}/activate`, ownerA, {}));
    expect(v1).toMatchObject({ status: 'ACTIVE', can: { terminate: true, newVersion: true } });
    expectError(
      await call('patch', `/terms/${v1.id}`, ownerA, { monthlyFeeCents: 1 }),
      409,
      'TERMS_STATE',
    );
    // Notes may still change on the terms in force.
    expect(
      terms(
        await call('patch', `/terms/${v1.id}`, ownerA, { internalNotes: 'Renewal call booked' }),
      ).internalNotes,
    ).toBe('Renewal call booked');
  });

  it('makes a change a new version, and activating it supersedes the one before', async () => {
    v2 = terms(await call('post', `/clients/${bk.assigned.id}/terms`, ownerA, {}), 201);
    expect(v2).toMatchObject({
      version: 2,
      status: 'DRAFT',
      monthlyFeeCents: 29_000,
      excludedServices: ['Payroll processing', 'Sales tax filing'],
    });
    v2 = terms(await call('patch', `/terms/${v2.id}`, ownerA, { monthlyFeeCents: 31_000 }));
    v2 = terms(await call('post', `/terms/${v2.id}/activate`, ownerA, { requireSigned: false }));
    expect(v2.status).toBe('ACTIVE');
    const page = await pageOf(bk.assigned.id);
    expect(page.current?.id).toBe(v2.id);
    expect(page.draft).toBeNull();
    expect(page.versions.map((v) => [v.version, v.status])).toEqual([
      [2, 'ACTIVE'],
      [1, 'SUPERSEDED'],
    ]);
    expectError(
      await call('patch', `/terms/${v1.id}`, ownerA, { internalNotes: 'Too late' }),
      409,
      'TERMS_STATE',
    );
  });

  it('records notices on the terms in force, then terminates them', async () => {
    const notice = BookkeepingTermsEvent.parse(
      ok(
        await call('post', `/terms/${v2.id}/notices`, ownerA, {
          kind: 'PRICE_CHANGE_NOTICE',
          effectiveDate: '2027-01-01',
          noticeSentAt: '2026-10-19T12:00:00.000Z',
          newMonthlyFeeCents: 33_000,
        }),
        201,
      ),
    );
    expect(notice).toMatchObject({
      kind: 'PRICE_CHANGE_NOTICE',
      version: 2,
      effectiveDate: '2027-01-01',
      details: { monthlyFeeCents: { from: 31_000, to: 33_000 } },
      actorName: 'Fake R55t ownerA',
    });
    expectError(
      await call('post', `/terms/${v1.id}/notices`, ownerA, { kind: 'NOTE', reason: 'x' }),
      409,
      'TERMS_STATE',
    );
    const ended = terms(
      await call('post', `/terms/${v2.id}/terminate`, adminA, {
        reason: 'Client moved to another firm',
        effectiveDate: '2026-12-31',
      }),
    );
    expect(ended).toMatchObject({
      status: 'TERMINATED',
      terminationReason: 'Client moved to another firm',
    });
    expectError(
      await call('post', `/terms/${v2.id}/terminate`, adminA, {
        reason: 'again',
        effectiveDate: '2026-12-31',
      }),
      409,
      'TERMS_STATE',
    );
  });

  it('pages the History, newest first, and filters it by kind', async () => {
    const first = BookkeepingTermsHistory.parse(
      ok(await call('get', `/clients/${bk.assigned.id}/terms/history?limit=3`, ownerA)),
    );
    expect(first.items[0]).toMatchObject({
      kind: 'TERMINATED',
      reason: 'Client moved to another firm',
    });
    expect(first.nextCursor).toBeTruthy();
    const rest = BookkeepingTermsHistory.parse(
      ok(
        await call(
          'get',
          `/clients/${bk.assigned.id}/terms/history?limit=100&cursor=${first.nextCursor}`,
          ownerA,
        ),
      ),
    );
    const kinds = [...first.items, ...rest.items].map((e) => e.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(['SENT', 'SIGNED', 'ACTIVATED', 'SUPERSEDED', 'CREATED']),
    );
    const superseded = BookkeepingTermsHistory.parse(
      ok(await call('get', `/clients/${bk.assigned.id}/terms/history?kind=SUPERSEDED`, ownerA)),
    );
    expect(superseded.items).toEqual([expect.objectContaining({ version: 1, kind: 'SUPERSEDED' })]);
    const audit = await inFirm('a', (tx) =>
      tx.auditLog.findMany({ where: { businessId: firms.a, entityType: 'bookkeeping_terms' } }),
    );
    expect(audit.length).toBeGreaterThan(5);
    expect(JSON.stringify(audit.map((a) => a.metadata))).not.toContain('Renewal call booked');
  });
});

describe('Payment Schedule', () => {
  it("lists the engagement's invoices, never a draft", async () => {
    await inFirm('a', async (tx) => {
      // As Invoices & Payments makes them: an empty draft, its lines, then issued.
      const mk = async (number: string, issue: boolean) => {
        const invoice = await tx.invoice.create({
          data: {
            businessId: firms.a,
            clientId: clients.assigned,
            engagementId: bk.assigned.engagementId,
            number: `${number}-${run}`,
            dueOn: new Date('2027-01-08T00:00:00Z'),
          },
          select: { id: true },
        });
        await tx.invoiceLine.create({
          data: {
            businessId: firms.a,
            invoiceId: invoice.id,
            description: 'Fake monthly bookkeeping',
            unitAmountCents: 29_000,
          },
        });
        if (issue)
          await tx.invoice.update({
            where: { id: invoice.id },
            data: { status: 'OPEN', issuedAt: new Date() },
          });
      };
      await mk('INV-DRAFT', false);
      await mk('INV-OPEN', true);
    });
    const schedule = BookkeepingPaymentSchedule.parse(
      ok(await call('get', `/clients/${bk.assigned.id}/terms/payment-schedule`, staffA)),
    );
    expect(schedule.items.map((r) => r.number)).toEqual([`INV-OPEN-${run}`]);
    const row = schedule.items[0]!;
    expect(row).toMatchObject({ dueOn: '2027-01-08', status: 'OPEN', amountCents: 29_000 });
    const issued = new Date(`${row.issuedOn}T12:00:00Z`);
    expect(row.period).toBe(
      issued.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    );
    const drafts = BookkeepingPaymentSchedule.parse(
      ok(
        await call('get', `/clients/${bk.assigned.id}/terms/payment-schedule?status=DRAFT`, ownerA),
      ),
    );
    expect(drafts.total).toBe(0);
  });
});

describe('firm B', () => {
  it("reaches none of firm A's terms", async () => {
    const page = await pageOf(bk.assigned.id);
    const id = page.versions[0]!.id;
    for (const [method, path, body] of [
      ['get', `/clients/${bk.assigned.id}/terms`, undefined],
      ['post', `/clients/${bk.other.id}/terms`, {}],
      ['get', `/clients/${bk.assigned.id}/terms/history`, undefined],
      ['get', `/clients/${bk.assigned.id}/terms/payment-schedule`, undefined],
      ['get', `/terms/${id}`, undefined],
      ['patch', `/terms/${id}`, { internalNotes: 'x' }],
      ['post', `/terms/${id}/send`, {}],
      ['post', `/terms/${id}/notices`, { kind: 'NOTE', reason: 'x' }],
      ['put', `/terms/${id}/agreement`, { signed: false }],
    ] as const)
      expectError(await call(method, path, ownerB, body, 'b'), 404, 'NOT_FOUND');
  });
});
