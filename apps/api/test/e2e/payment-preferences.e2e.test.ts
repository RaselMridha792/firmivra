// End-to-end: Settings > Payments' Invoice Defaults, Reminders & Automations and Taxes & Fees
// (R55; Octavia's Invoices & Payments review of Oct 27, IP-F13). Every option is off until the
// firm saves; a stale save is 409; Owner and Admin only; one firm never reads another's; each
// change is audited by field or record name. Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { InvoiceTaxRateList, PaymentPreferences } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
let app: INestApplication;
const run = randomUUID().slice(0, 6);

beforeAll(async () => {
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
  await nest.init();
  app = nest;
});

afterAll(async () => {
  await app.close();
});

const tokens = new Map<string, string>();
async function call(
  method: 'get' | 'patch' | 'post' | 'put',
  path: string,
  who: { email: string },
  body?: object,
) {
  let token = tokens.get(who.email);
  if (!token) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/dev/token')
      .send({ email: who.email });
    token = (res.body as { token: string }).token;
    tokens.set(who.email, token);
  }
  const req = request(app.getHttpServer())
    [method](`/api/v1/business/settings/payment-preferences${path}`)
    .set('authorization', `Bearer ${token}`);
  return body ? req.send(body) : req;
}
const code = (res: request.Response) => (res.body as { error?: { code: string } }).error?.code;
const prefs = (res: request.Response) => PaymentPreferences.parse(res.body);

describe('payment preferences (IP-F13)', () => {
  let current: PaymentPreferences;

  it('starts with every option off, for any firm that never saved', async () => {
    current = prefs(await call('get', '', fx.users.ownerB));
    expect(current).toEqual({
      invoiceDefaults: { invoicePrefix: 'INV-', defaultTerms: 'net_14', defaultMemo: null },
      reminders: {
        sendReminders: false,
        reminderDaysBefore: 3,
        notifyOverdue: false,
        overdueReminderDays: 7,
        autoReceipts: false,
        autoApplyPayments: false,
        retryAttempts: 0,
        retryIntervalDays: 3,
      },
      taxesAndFees: {
        lateFeeEnabled: false,
        lateFeeType: null,
        lateFeePercent: null,
        lateFeeCents: null,
        tippingEnabled: false,
        requirePaymentBeforeDue: false,
      },
      updatedAt: null,
    });
  });

  it('saves the three sections, audited by field, and refuses a stale save', async () => {
    const start = prefs(await call('get', '', fx.users.ownerA));
    const body = {
      ...start,
      invoiceDefaults: {
        invoicePrefix: 'LVP-',
        defaultTerms: 'net_30',
        defaultMemo: 'Thank you (fake)',
      },
      reminders: { ...start.reminders, autoReceipts: true, sendReminders: true },
      taxesAndFees: {
        ...start.taxesAndFees,
        lateFeeEnabled: true,
        lateFeeType: 'PERCENT',
        lateFeePercent: 1.5,
      },
    };
    const saved = prefs(await call('patch', '', fx.users.ownerA, body));
    expect(saved.invoiceDefaults.invoicePrefix).toBe('LVP-');
    expect(saved.taxesAndFees).toMatchObject({
      lateFeeType: 'PERCENT',
      lateFeePercent: 1.5,
      lateFeeCents: null,
    });
    expect(saved.updatedAt).not.toBeNull();
    // The same read again is stale now.
    expect(code(await call('patch', '', fx.users.ownerA, body))).toBe('SAVE_CONFLICT');
    // Another firm still has its defaults.
    expect(prefs(await call('get', '', fx.users.ownerB)).updatedAt).toBeNull();

    const db = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
    const [log] = await runInScope(db, { kind: 'platform' }, (tx) =>
      tx.auditLog.findMany({
        where: { businessId: fx.firmA.id, action: 'payment_preferences.updated' },
        orderBy: { createdAt: 'desc' },
        take: 1,
      }),
    );
    await db.$disconnect();
    expect((log?.metadata as { fields: string[] }).fields.sort()).toEqual(
      [
        'autoReceipts',
        'defaultMemo',
        'defaultTerms',
        'invoicePrefix',
        'lateFeeEnabled',
        'lateFeePercent',
        'lateFeeType',
        'sendReminders',
      ].sort(),
    );

    // Reset to Default (after the screen's confirmation): every option off again.
    const reset = prefs(
      await call('post', '/reset', fx.users.ownerA, { updatedAt: saved.updatedAt }),
    );
    expect(reset.reminders.autoReceipts).toBe(false);
    expect(reset.invoiceDefaults.invoicePrefix).toBe('INV-');
  });

  it('checks the input and lets only Owner and Admin in', async () => {
    const start = prefs(await call('get', '', fx.users.ownerA));
    for (const bad of [
      { ...start, invoiceDefaults: { ...start.invoiceDefaults, invoicePrefix: 'TOO LONG PREFIX' } },
      { ...start, invoiceDefaults: { ...start.invoiceDefaults, defaultTerms: 'net_99' } },
      { ...start, taxesAndFees: { ...start.taxesAndFees, lateFeeEnabled: true } },
      { ...start, reminders: { ...start.reminders, retryAttempts: 11 } },
      { ...start, businessId: fx.firmB.id },
    ]) {
      expect(code(await call('patch', '', fx.users.ownerA, bad))).toBe('VALIDATION_FAILED');
    }
    expect((await call('get', '', fx.users.staffA)).status).toBe(403);
    expect((await call('patch', '', fx.users.staffA, start)).status).toBe(403);
  });

  it('keeps one default tax, refuses a repeated name, archives, and keeps firms apart', async () => {
    const a = (
      await call('post', '/tax-rates', fx.users.ownerA, {
        name: `State ${run}`,
        rateBps: 600,
        isDefault: true,
      })
    ).body as { id: string };
    const b = (
      await call('post', '/tax-rates', fx.users.ownerA, {
        name: `County ${run}`,
        rateBps: 125,
        isDefault: true,
      })
    ).body as { id: string };
    const list = InvoiceTaxRateList.parse(
      (await call('get', '/tax-rates', fx.users.ownerA)).body,
    ).items;
    expect(list.filter((t) => t.isDefault).map((t) => t.id)).toEqual([b.id]);
    expect(
      code(await call('post', '/tax-rates', fx.users.ownerA, { name: `State ${run}`, rateBps: 1 })),
    ).toBe('NAME_TAKEN');
    expect(
      code(await call('post', '/tax-rates', fx.users.ownerA, { name: 'X', rateBps: 10_001 })),
    ).toBe('VALIDATION_FAILED');
    // Firm B reaches none of firm A's rates.
    expect(
      (await call('put', `/tax-rates/${a.id}`, fx.users.ownerB, { name: 'Taken', rateBps: 1 }))
        .status,
    ).toBe(404);
    expect(
      InvoiceTaxRateList.parse((await call('get', '/tax-rates', fx.users.ownerB)).body).items.map(
        (t) => t.id,
      ),
    ).not.toContain(a.id);
    const after = InvoiceTaxRateList.parse(
      (await call('post', `/tax-rates/${b.id}/archive`, fx.users.ownerA)).body,
    ).items;
    expect(after.map((t) => t.id)).not.toContain(b.id);
  });

  it('manages invoice templates the same way', async () => {
    const t = (
      await call('post', '/templates', fx.users.ownerA, {
        name: `Standard ${run}`,
        memo: 'Fake memo',
        isDefault: true,
      })
    ).body as { id: string; isDefault: boolean; showLogo: boolean };
    expect(t).toMatchObject({ isDefault: true, showLogo: true });
    expect(
      code(await call('post', '/templates', fx.users.ownerA, { name: `Standard ${run}` })),
    ).toBe('NAME_TAKEN');
    expect((await call('post', `/templates/${t.id}/archive`, fx.users.ownerB)).status).toBe(404);
    expect((await call('post', `/templates/${t.id}/archive`, fx.users.ownerA)).status).toBe(200);
  });
});
