// End-to-end: R60, Super Admin Billing on R0's B3 tables. Every route under /api/v1/admin/billing:
// firms and billing profiles, settings, invoices (create, edit, send, duplicate, void), payments
// and refunds, credit notes (issue, apply, refund, void), estimates (send, status, duplicate,
// delete, convert) and recurring schedules (pause, run). Firmivra bills firms; the database keeps
// the totals and money statuses. A firm's session reaches none of it.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  BillingCreditNote,
  BillingEstimate,
  BillingFirm,
  BillingInvoiceDetail,
  BillingInvoicePage,
  BillingPayment,
  BillingRecurring,
  BillingSettings,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE } from '../../src/notify/notify.types.js';

const fx = inject('fixtures');
const BASE = '/api/v1/admin/billing';
let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.67.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

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
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
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

const t0 = new Date().toISOString().slice(0, 10);
const plus = (days: number) => {
  const d = new Date(`${t0}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const invoiceBody = (over: Record<string, unknown> = {}) => ({
  firmId: fx.firmA.id,
  issueDate: t0,
  dueDate: plus(30),
  lines: [
    { description: 'Fake Business plan', quantity: 1, rateCents: 49_900, taxPercent: 8.25 },
    { description: 'Fake extra seats', quantity: 2.5, rateCents: 1_000 },
  ],
  ...over,
});
const newInvoice = async (over: Record<string, unknown> = {}) =>
  BillingInvoiceDetail.parse(ok(await call('post', '/invoices', invoiceBody(over)), 201));
const sentInvoice = async (over: Record<string, unknown> = {}) =>
  newInvoice({ ...over, send: true, emailFirm: false });

beforeAll(async () => {
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

describe('firms, the team and settings', () => {
  it('GET /firms and /firms/:id: the firm, its contact (its owner until a profile is saved) and its plan', async () => {
    const firms = (ok(await call('get', '/firms')) as unknown[]).map((f) => BillingFirm.parse(f));
    const a = firms.find((f) => f.id === fx.firmA.id)!;
    expect(a).toMatchObject({ canBill: true });
    expect(firms.find((f) => f.id === fx.suspended.id)).toMatchObject({ canBill: false });
    expect(BillingFirm.parse(ok(await call('get', `/firms/${fx.firmA.id}`))).id).toBe(fx.firmA.id);
    expect((await call('get', `/firms/${randomUUID()}`)).status).toBe(404);
  });

  it("PUT /firms/:id/billing-profile: the contact and the firm's own terms and tax", async () => {
    const saved = BillingFirm.parse(
      ok(
        await call('put', `/firms/${fx.firmA.id}/billing-profile`, {
          contactName: 'Fake Billing Contact',
          contactEmail: 'Billing@E2E-A.test',
          paymentTermDays: 15,
          taxPercent: 5,
        }),
      ),
    );
    expect(saved).toMatchObject({
      contactName: 'Fake Billing Contact',
      contactEmail: 'billing@e2e-a.test',
      paymentTermDays: 15,
      taxPercent: 5,
      hasProfile: true,
    });
  });

  it('GET /admins, /items and /next-number', async () => {
    const admins = ok(await call('get', '/admins')) as { id: string }[];
    expect(admins.some((a) => a.id === fx.users.admin.id)).toBe(true);
    expect(Array.isArray(ok(await call('get', '/items')))).toBe(true);
    expect(
      (ok(await call('get', '/next-number?kind=invoice')) as { number: string }).number,
    ).toMatch(/^INV-\d+$/);
    expect((await call('get', '/next-number?kind=receipt')).status).toBe(400);
  });

  it('GET and PUT /settings: the stored parts save; the other options cannot change yet', async () => {
    const settings = BillingSettings.parse(ok(await call('get', '/settings')));
    expect(settings.numbering.invoice.prefix).toBe('INV-');
    expect(Object.keys(settings.templates)).toHaveLength(6);
    const { numbering: _n, updatedAt: _u, updatedBy: _b, ...body } = settings;
    const saved = BillingSettings.parse(
      ok(
        await call('put', '/settings', {
          ...body,
          general: { ...body.general, estimateValidityDays: 45 },
        }),
      ),
    );
    expect(saved.general.estimateValidityDays).toBe(45);
    expect(saved.updatedBy).toBe('Fake admin');
    const refused = await call('put', '/settings', {
      ...body,
      preferences: { ...body.preferences, taxMode: 'INCLUSIVE' },
    });
    expect([refused.status, code(refused)]).toEqual([422, 'NOT_SUPPORTED_YET']);
    ok(await call('put', '/settings', body));
  });
});

describe('invoices, payments and refunds', () => {
  it("POST /invoices: a numbered draft with the database's totals; a suspended firm is refused", async () => {
    const inv = await newInvoice({ discountCents: 900 });
    expect(inv.number).toMatch(/^INV-\d+$/);
    // 49,900 + 2.5 x 1,000 = 52,400; tax 8.25% of 49,900 = 4,117 (4,116.75); the firm's 5% is not
    // applied over the line's own rate.
    expect(inv).toMatchObject({
      status: 'DRAFT',
      subtotalCents: 52_400,
      taxCents: 4_117,
      discountCents: 900,
      totalCents: 55_617,
      balanceCents: 55_617,
      billToName: 'Fake Billing Contact',
      sendStatus: 'NOT_SENT',
      paymentTerms: 'NET_30',
    });
    expect(inv.history.map((h) => h.action)).toContain('Created');
    const suspended = await call('post', '/invoices', invoiceBody({ firmId: fx.suspended.id }));
    expect([suspended.status, code(suspended)]).toEqual([409, 'FIRM_NOT_BILLABLE']);
    expect((await call('post', '/invoices', invoiceBody({ lines: [] }))).status).toBe(400);
  });

  it('PATCH /invoices/:id: drafts only', async () => {
    const inv = await newInvoice();
    const changed = BillingInvoiceDetail.parse(
      ok(
        await call(
          'patch',
          `/invoices/${inv.id}`,
          invoiceBody({ lines: [{ description: 'Fake setup', quantity: 1, rateCents: 10_000 }] }),
        ),
      ),
    );
    expect(changed).toMatchObject({
      totalCents: 10_000,
      lines: [expect.objectContaining({ description: 'Fake setup' })],
    });
    await call('post', `/invoices/${inv.id}/send`, { email: false });
    const refused = await call('patch', `/invoices/${inv.id}`, invoiceBody());
    expect([refused.status, code(refused)]).toEqual([409, 'NOT_A_DRAFT']);
  });

  it('POST /invoices/:id/send: issued; the email is recorded as not set up yet', async () => {
    const inv = await newInvoice();
    const sent = BillingInvoiceDetail.parse(ok(await call('post', `/invoices/${inv.id}/send`, {})));
    expect(sent).toMatchObject({ status: 'PENDING', sendStatus: 'FAILED' });
    expect(sent.sentAt).not.toBeNull();
    const quiet = await sentInvoice();
    expect(quiet).toMatchObject({ status: 'PENDING', sendStatus: 'NOT_SENT' });
  });

  it('POST /invoices/:id/duplicate: a new draft with the same lines', async () => {
    const inv = await sentInvoice();
    const copy = BillingInvoiceDetail.parse(
      ok(await call('post', `/invoices/${inv.id}/duplicate`), 201),
    );
    expect(copy).toMatchObject({ status: 'DRAFT', totalCents: inv.totalCents });
    expect(copy.number).not.toBe(inv.number);
  });

  it('POST /invoices/:id/void: only with no money on it', async () => {
    const inv = await sentInvoice();
    const voided = BillingInvoiceDetail.parse(
      ok(await call('post', `/invoices/${inv.id}/void`, { reason: 'Fake: billed twice' })),
    );
    expect(voided).toMatchObject({ status: 'VOIDED', voidReason: 'Fake: billed twice' });
    expect(code(await call('post', `/invoices/${inv.id}/void`, { reason: 'Again' }))).toBe(
      'ALREADY_VOIDED',
    );
    const paid = await sentInvoice();
    await call('post', `/invoices/${paid.id}/payments`, {
      requestId: randomUUID(),
      amountCents: 100,
      paidOn: t0,
      method: 'CASH',
    });
    expect(code(await call('post', `/invoices/${paid.id}/void`, { reason: 'x' }))).toBe(
      'HAS_MONEY',
    );
  });

  it('POST /invoices/:id/payments: once per request, never past the balance; the status follows', async () => {
    const inv = await sentInvoice();
    const requestId = randomUUID();
    const first = BillingPayment.parse(
      ok(
        await call('post', `/invoices/${inv.id}/payments`, {
          requestId,
          amountCents: 20_000,
          paidOn: t0,
          method: 'CHECK',
          reference: 'Fake 1042',
        }),
        201,
      ),
    );
    expect(first).toMatchObject({
      status: 'COMPLETED',
      amountCents: 20_000,
      refundableCents: 20_000,
      method: 'CHECK',
    });
    const again = BillingPayment.parse(
      ok(
        await call('post', `/invoices/${inv.id}/payments`, {
          requestId,
          amountCents: 20_000,
          paidOn: t0,
          method: 'CHECK',
        }),
        201,
      ),
    );
    expect(again.id).toBe(first.id);
    const detail = BillingInvoiceDetail.parse(ok(await call('get', `/invoices/${inv.id}`)));
    expect(detail).toMatchObject({
      status: 'PARTIALLY_PAID',
      paidCents: 20_000,
      payments: [expect.objectContaining({ id: first.id })],
    });
    const over = await call('post', `/invoices/${inv.id}/payments`, {
      requestId: randomUUID(),
      amountCents: detail.balanceCents + 1,
      paidOn: t0,
      method: 'CASH',
    });
    expect([over.status, code(over)]).toEqual([409, 'OVER_BALANCE']);
    ok(
      await call('post', `/invoices/${inv.id}/payments`, {
        requestId: randomUUID(),
        amountCents: detail.balanceCents,
        paidOn: t0,
        method: 'ACH',
      }),
      201,
    );
    expect(BillingInvoiceDetail.parse(ok(await call('get', `/invoices/${inv.id}`))).status).toBe(
      'PAID',
    );
    const draft = await newInvoice();
    expect(
      code(
        await call('post', `/invoices/${draft.id}/payments`, {
          requestId: randomUUID(),
          amountCents: 1,
          paidOn: t0,
          method: 'CASH',
        }),
      ),
    ).toBe('NOT_ISSUED');
  });

  it('GET /invoices and /invoices/summary: filters, the Overdue status and the cards', async () => {
    const late = await sentInvoice({
      issueDate: plus(-60),
      dueDate: plus(-30),
      reference: `Fake late ${t0}`,
    });
    const page = BillingInvoicePage.parse(
      ok(await call('get', '/invoices?status=OVERDUE&pageSize=100')),
    );
    expect(page.items.some((i) => i.id === late.id)).toBe(true);
    expect(page.items.every((i) => i.status === 'OVERDUE')).toBe(true);
    const searched = BillingInvoicePage.parse(
      ok(await call('get', `/invoices?search=${late.number}`)),
    );
    expect(searched.items.map((i) => i.id)).toEqual([late.id]);
    const sorted = BillingInvoicePage.parse(
      ok(await call('get', '/invoices?sort=amount&descending=true&pageSize=5')),
    );
    const amounts = sorted.items.map((i) => i.totalCents);
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
    const summary = ok(await call('get', `/invoices/summary?firmId=${fx.firmA.id}`)) as Record<
      string,
      number | null
    >;
    expect(summary.overdueCount).toBeGreaterThanOrEqual(1);
    expect(summary.invoicedTrend).toBeNull();
    const ranged = ok(await call('get', `/invoices/summary?from=${plus(-7)}&to=${t0}`)) as Record<
      string,
      number | null
    >;
    expect(typeof ranged.invoicedCents).toBe('number');
    expect((await call('get', `/invoices/${randomUUID()}`)).status).toBe(404);
  });

  it('GET /payments, /payments/summary and /payments/:id; POST /payments/:id/refunds', async () => {
    const inv = await sentInvoice({
      lines: [{ description: 'Fake plan', quantity: 1, rateCents: 10_000 }],
    });
    const part = await sentInvoice();
    const partPayment = BillingPayment.parse(
      ok(
        await call('post', `/invoices/${part.id}/payments`, {
          requestId: randomUUID(),
          amountCents: 1_000,
          paidOn: t0,
          method: 'CARD',
        }),
        201,
      ),
    );
    // B3 keeps refunded invoices fully paid: a part-paid invoice's payment waits.
    const early = await call('post', `/payments/${partPayment.id}/refunds`, {
      type: 'FULL',
      reason: 'x',
      confirmed: true,
    });
    expect([early.status, code(early)]).toEqual([422, 'NOT_SUPPORTED_YET']);
    const payment = BillingPayment.parse(
      ok(
        await call('post', `/invoices/${inv.id}/payments`, {
          requestId: randomUUID(),
          amountCents: 10_000,
          paidOn: t0,
          method: 'CARD',
        }),
        201,
      ),
    );
    const partial = BillingPayment.parse(
      ok(
        await call('post', `/payments/${payment.id}/refunds`, {
          type: 'PARTIAL',
          amountCents: 2_500,
          reason: 'Fake: one seat removed',
          confirmed: true,
        }),
      ),
    );
    expect(partial).toMatchObject({
      status: 'PARTIALLY_REFUNDED',
      refundedCents: 2_500,
      refundableCents: 7_500,
    });
    expect(partial.refunds).toEqual([
      expect.objectContaining({ amountCents: 2_500, type: 'PARTIAL', status: 'COMPLETED' }),
    ]);
    const over = await call('post', `/payments/${payment.id}/refunds`, {
      type: 'PARTIAL',
      amountCents: 9_000,
      reason: 'x',
      confirmed: true,
    });
    expect(code(over)).toBe('OVER_REFUNDABLE');
    const check = await call('post', `/payments/${payment.id}/refunds`, {
      type: 'FULL',
      reason: 'x',
      method: 'CHECK',
      confirmed: true,
    });
    expect(code(check)).toBe('NOT_SUPPORTED_YET');
    const full = BillingPayment.parse(
      ok(
        await call('post', `/payments/${payment.id}/refunds`, {
          type: 'FULL',
          reason: 'Fake: canceled',
          confirmed: true,
        }),
      ),
    );
    expect(full).toMatchObject({ status: 'REFUNDED', refundableCents: 0 });
    expect(BillingInvoiceDetail.parse(ok(await call('get', `/invoices/${inv.id}`))).status).toBe(
      'REFUNDED',
    );
    expect(BillingPayment.parse(ok(await call('get', `/payments/${payment.id}`))).id).toBe(
      payment.id,
    );
    const list = ok(await call('get', `/payments?invoiceId=${inv.id}`)) as {
      items: BillingPayment[];
    };
    expect(list.items.map((p) => p.id)).toEqual([payment.id]);
    const summary = ok(await call('get', '/payments/summary?method=CARD')) as Record<
      string,
      number
    >;
    expect(summary.refundsCents).toBeGreaterThanOrEqual(10_000);
  });
});

describe('credit notes', () => {
  it('POST, PATCH and issue; apply to an invoice; refund the rest; void an unused one', async () => {
    const draft = BillingCreditNote.parse(
      ok(
        await call('post', '/credit-notes', {
          firmId: fx.firmA.id,
          date: t0,
          reason: 'GOODWILL',
          method: 'ADJUSTMENT',
          adjustmentCents: 5_000,
        }),
        201,
      ),
    );
    expect(draft).toMatchObject({
      status: 'DRAFT',
      method: 'ADJUSTMENT',
      totalCents: 5_000,
      number: expect.stringMatching(/^CN-\d+$/),
    });
    const changed = BillingCreditNote.parse(
      ok(
        await call('patch', `/credit-notes/${draft.id}`, {
          firmId: fx.firmA.id,
          date: t0,
          reason: 'BILLING_ERROR',
          method: 'LINE_ITEMS',
          lines: [{ description: 'Fake overcharge', quantity: 1, rateCents: 6_000 }],
        }),
      ),
    );
    expect(changed).toMatchObject({
      reason: 'BILLING_ERROR',
      method: 'LINE_ITEMS',
      totalCents: 6_000,
    });
    const issued = BillingCreditNote.parse(
      ok(await call('post', `/credit-notes/${draft.id}/issue`)),
    );
    expect(issued).toMatchObject({ status: 'AVAILABLE', remainingCents: 6_000 });
    const available = ok(await call('get', `/credit-notes/available?firmId=${fx.firmA.id}`)) as {
      id: string;
    }[];
    expect(available.some((c) => c.id === draft.id)).toBe(true);
    const inv = await sentInvoice({
      lines: [{ description: 'Fake plan', quantity: 1, rateCents: 4_000 }],
    });
    const applied = BillingCreditNote.parse(
      ok(
        await call('post', `/credit-notes/${draft.id}/apply`, {
          invoiceId: inv.id,
          amountCents: 4_000,
          confirmed: true,
        }),
      ),
    );
    expect(applied).toMatchObject({
      status: 'PARTIALLY_APPLIED',
      appliedCents: 4_000,
      remainingCents: 2_000,
    });
    expect(BillingInvoiceDetail.parse(ok(await call('get', `/invoices/${inv.id}`)))).toMatchObject({
      status: 'PAID',
      creditedCents: 4_000,
      credits: [expect.objectContaining({ creditNoteId: draft.id })],
    });
    const over = await call('post', `/credit-notes/${draft.id}/refund`, {
      amountCents: 2_001,
      reason: 'x',
    });
    expect(code(over)).toBe('OVER_CREDIT');
    const refunded = BillingCreditNote.parse(
      ok(
        await call('post', `/credit-notes/${draft.id}/refund`, {
          amountCents: 2_000,
          reason: 'Fake: paid out',
        }),
      ),
    );
    expect(refunded).toMatchObject({ status: 'REFUNDED', remainingCents: 0 });
    expect(code(await call('post', `/credit-notes/${draft.id}/void`, { reason: 'x' }))).toBe(
      'HAS_MONEY',
    );
    const other = BillingCreditNote.parse(
      ok(
        await call('post', '/credit-notes', {
          firmId: fx.firmA.id,
          date: t0,
          reason: 'OTHER',
          method: 'ADJUSTMENT',
          adjustmentCents: 100,
          issue: true,
        }),
        201,
      ),
    );
    expect(
      BillingCreditNote.parse(
        ok(await call('post', `/credit-notes/${other.id}/void`, { reason: 'Fake: mistake' })),
      ).status,
    ).toBe('VOIDED');
    expect(
      BillingCreditNote.parse(ok(await call('get', `/credit-notes/${draft.id}`))).history.length,
    ).toBeGreaterThan(3);
  });

  it("GET /credit-notes and /credit-notes/summary; another firm's invoice takes no credit", async () => {
    const note = BillingCreditNote.parse(
      ok(
        await call('post', '/credit-notes', {
          firmId: fx.firmA.id,
          date: t0,
          reason: 'GOODWILL',
          method: 'ADJUSTMENT',
          adjustmentCents: 300,
          issue: true,
        }),
        201,
      ),
    );
    const list = ok(await call('get', '/credit-notes?status=AVAILABLE&pageSize=100')) as {
      items: { id: string }[];
    };
    expect(list.items.some((c) => c.id === note.id)).toBe(true);
    const summary = ok(await call('get', `/credit-notes/summary?firmId=${fx.firmA.id}`)) as Record<
      string,
      number
    >;
    expect(summary.availableCents).toBeGreaterThanOrEqual(300);
    await call('put', `/firms/${fx.firmB.id}/billing-profile`, {
      contactName: 'Fake B',
      contactEmail: 'billing@e2e-b.test',
    });
    const invB = BillingInvoiceDetail.parse(
      ok(
        await call(
          'post',
          '/invoices',
          invoiceBody({ firmId: fx.firmB.id, send: true, emailFirm: false }),
        ),
        201,
      ),
    );
    const cross = await call('post', `/credit-notes/${note.id}/apply`, {
      invoiceId: invB.id,
      amountCents: 100,
      confirmed: true,
    });
    expect([cross.status, code(cross)]).toEqual([409, 'OTHER_FIRM']);
  });
});

describe('estimates', () => {
  const estimateBody = (over: Record<string, unknown> = {}) => ({
    firmId: fx.firmA.id,
    contactName: 'Fake Prospect Contact',
    email: 'quotes@e2e-a.test',
    issueDate: t0,
    expirationDate: plus(30),
    lines: [{ description: 'Fake annual plan', quantity: 1, rateCents: 59_880 }],
    discountCents: 880,
    ...over,
  });

  it('POST, PATCH, send, status, duplicate and delete', async () => {
    const e = BillingEstimate.parse(ok(await call('post', '/estimates', estimateBody()), 201));
    expect(e).toMatchObject({
      status: 'DRAFT',
      totalCents: 59_000,
      number: expect.stringMatching(/^EST-\d+$/),
    });
    const changed = BillingEstimate.parse(
      ok(
        await call(
          'patch',
          `/estimates/${e.id}`,
          estimateBody({ discountCents: 0, assignedToId: fx.users.admin.id }),
        ),
      ),
    );
    expect(changed).toMatchObject({ totalCents: 59_880, assignedToName: 'Fake admin' });
    const sent = BillingEstimate.parse(
      ok(await call('post', `/estimates/${e.id}/send`, { email: false })),
    );
    expect(sent.status).toBe('SENT');
    expect(code(await call('patch', `/estimates/${e.id}`, estimateBody()))).toBe('NOT_A_DRAFT');
    expect(code(await call('delete', `/estimates/${e.id}`))).toBe('NOT_A_DRAFT');
    const approved = BillingEstimate.parse(
      ok(await call('post', `/estimates/${e.id}/status`, { status: 'APPROVED' })),
    );
    expect(approved.status).toBe('APPROVED');
    const copy = BillingEstimate.parse(ok(await call('post', `/estimates/${e.id}/duplicate`), 201));
    expect(copy).toMatchObject({ status: 'DRAFT', totalCents: 59_880 });
    expect(ok(await call('delete', `/estimates/${copy.id}`))).toEqual({ ok: true });
    expect((await call('get', `/estimates/${copy.id}`)).status).toBe(404);
    const declined = BillingEstimate.parse(
      ok(await call('post', '/estimates', estimateBody({ send: true, emailFirm: false })), 201),
    );
    ok(await call('post', `/estimates/${declined.id}/status`, { status: 'DECLINED' }));
    expect(
      code(await call('post', `/estimates/${declined.id}/status`, { status: 'APPROVED' })),
    ).toBe('ESTIMATE_DECIDED');
  });

  it('POST /estimates/:id/convert: a draft invoice from it, once', async () => {
    const e = BillingEstimate.parse(
      ok(await call('post', '/estimates', estimateBody({ send: true, emailFirm: false })), 201),
    );
    const inv = BillingInvoiceDetail.parse(
      ok(await call('post', `/estimates/${e.id}/convert`), 201),
    );
    expect(inv).toMatchObject({
      status: 'DRAFT',
      estimateId: e.id,
      estimateNumber: e.number,
      totalCents: e.totalCents,
    });
    expect(BillingEstimate.parse(ok(await call('get', `/estimates/${e.id}`)))).toMatchObject({
      status: 'CONVERTED',
      convertedInvoiceId: inv.id,
    });
    expect(code(await call('post', `/estimates/${e.id}/convert`))).toBe('ESTIMATE_CONVERTED');
  });

  it('GET /estimates and /estimates/summary: an expired one reads as Expired', async () => {
    const old = BillingEstimate.parse(
      ok(
        await call(
          'post',
          '/estimates',
          estimateBody({
            issueDate: plus(-40),
            expirationDate: plus(-10),
            send: true,
            emailFirm: false,
          }),
        ),
        201,
      ),
    );
    expect(BillingEstimate.parse(ok(await call('get', `/estimates/${old.id}`))).status).toBe(
      'EXPIRED',
    );
    const list = ok(await call('get', '/estimates?status=EXPIRED&pageSize=100')) as {
      items: { id: string }[];
    };
    expect(list.items.some((x) => x.id === old.id)).toBe(true);
    const summary = ok(await call('get', `/estimates/summary?firmId=${fx.firmA.id}`)) as Record<
      string,
      number
    >;
    expect(summary.totalCount).toBeGreaterThanOrEqual(1);
  });
});

describe('recurring schedules', () => {
  it('POST, PATCH, status and run: one invoice per occurrence, the next date moves on', async () => {
    const created = BillingRecurring.parse(
      ok(
        await call('post', '/recurring', {
          firmId: fx.firmA.id,
          template: 'Fake Premium Plan',
          description: 'Fake monthly subscription',
          frequency: 'MONTHLY',
          amountCents: 29_900,
          startDate: plus(10),
          nextInvoiceDate: plus(10),
          autoSend: false,
        }),
        201,
      ),
    );
    expect(created).toMatchObject({
      status: 'ACTIVE',
      template: 'Fake Premium Plan',
      nextInvoiceDate: plus(10),
    });
    const changed = BillingRecurring.parse(
      ok(
        await call('patch', `/recurring/${created.id}`, {
          firmId: fx.firmA.id,
          template: 'Fake Premium Plan',
          description: 'Fake monthly subscription',
          frequency: 'MONTHLY',
          amountCents: 31_900,
          startDate: plus(10),
          nextInvoiceDate: plus(10),
          autoSend: true,
        }),
      ),
    );
    expect(changed).toMatchObject({ amountCents: 31_900, autoSend: true });
    const paused = BillingRecurring.parse(
      ok(await call('post', `/recurring/${created.id}/status`, { status: 'PAUSED' })),
    );
    expect(paused.status).toBe('PAUSED');
    expect(code(await call('post', `/recurring/${created.id}/run`))).toBe('SCHEDULE_CANCELED');
    ok(await call('post', `/recurring/${created.id}/status`, { status: 'ACTIVE' }));
    const inv = BillingInvoiceDetail.parse(
      ok(await call('post', `/recurring/${created.id}/run`), 201),
    );
    expect(inv).toMatchObject({
      recurringId: created.id,
      status: 'PENDING',
      issueDate: plus(10),
      schedule: { id: created.id },
    });
    expect(inv.lines[0]).toMatchObject({ description: 'Fake Premium Plan', rateCents: 31_900 });
    const after = BillingRecurring.parse(ok(await call('get', `/recurring/${created.id}`)));
    expect(after.invoices.map((i) => i.id)).toEqual([inv.id]);
    expect(after.nextInvoiceDate).not.toBe(plus(10));
    const list = ok(await call('get', `/recurring?firmId=${fx.firmA.id}&pageSize=100`)) as {
      items: { id: string }[];
    };
    expect(list.items.some((r) => r.id === created.id)).toBe(true);
    const counts = ok(await call('get', `/recurring/counts?firmId=${fx.firmA.id}`)) as Record<
      string,
      number
    >;
    expect(counts.all).toBeGreaterThanOrEqual(counts.active!);
    ok(await call('post', `/recurring/${created.id}/status`, { status: 'CANCELED' }));
    expect(code(await call('post', `/recurring/${created.id}/status`, { status: 'ACTIVE' }))).toBe(
      'SCHEDULE_CANCELED',
    );
  });
});

describe('the Super Admin site only', () => {
  it("a firm Owner's session reaches no Billing route", async () => {
    for (const [method, path] of [
      ['get', '/invoices'],
      ['get', '/firms'],
      ['get', '/settings'],
      ['post', '/invoices'],
    ] as const) {
      const res = await call(
        method,
        path,
        method === 'post' ? invoiceBody() : undefined,
        fx.users.ownerA.email,
      );
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });
});
