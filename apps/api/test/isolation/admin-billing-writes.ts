// R60: the Super Admin Billing writes for admin-scope.test.ts, each against a record of its own
// (drafts, sent and paid invoices, a payment, credit notes, estimates, schedules), made in platform
// scope (B3's billing staff) so every write meets something it can change.
import { randomUUID } from 'node:crypto';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { BillingTemplateKind } from '@firmivra/types';
import { DEFAULT_PREFERENCES } from '../../src/admin-billing/billing-settings.service.js';
import type { Fixtures } from '../global-setup.js';
import { records, type SupportWrite } from './admin-support-writes.js';

const day = (offset = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const date = (offset = 0) => new Date(`${day(offset)}T00:00:00.000Z`);
const LINE = {
  description: 'Fake scope line',
  quantity: 1,
  unitCents: 10_000,
  taxRateBps: 0,
  sortOrder: 0,
};

async function invoice(
  tx: TxClient,
  fx: Fixtures,
  status: 'DRAFT' | 'SENT',
  key: string,
): Promise<string> {
  const row = await tx.platformInvoice.create({
    data: {
      businessId: fx.firmA.id,
      invoiceDate: date(),
      dueDate: date(30),
      billToName: 'Fake Scope Contact',
      billToEmail: 'scope@e2e-a.test',
      createdByUserId: fx.users.admin.id,
      lines: { create: [LINE] },
    },
    select: { id: true },
  });
  if (status === 'SENT')
    await tx.platformInvoice.update({ where: { id: row.id }, data: { status: 'SENT' } });
  records[key] = row.id;
  return row.id;
}

async function credit(tx: TxClient, fx: Fixtures, status: 'DRAFT' | 'AVAILABLE', key: string) {
  const row = await tx.platformCreditNote.create({
    data: {
      businessId: fx.firmA.id,
      issueDate: date(),
      reason: 'GOODWILL',
      createdByUserId: fx.users.admin.id,
      lines: { create: [{ ...LINE, description: 'Credit adjustment', unitCents: 1_000 }] },
    },
    select: { id: true },
  });
  if (status === 'AVAILABLE')
    await tx.platformCreditNote.update({ where: { id: row.id }, data: { status: 'AVAILABLE' } });
  records[key] = row.id;
}

async function estimate(tx: TxClient, fx: Fixtures, status: 'DRAFT' | 'SENT', key: string) {
  const row = await tx.platformEstimate.create({
    data: {
      businessId: fx.firmA.id,
      issueDate: date(),
      expirationDate: date(30),
      contactName: 'Fake Scope Contact',
      contactEmail: 'scope@e2e-a.test',
      createdByUserId: fx.users.admin.id,
      lines: { create: [LINE] },
    },
    select: { id: true },
  });
  if (status === 'SENT')
    await tx.platformEstimate.update({ where: { id: row.id }, data: { status: 'SENT' } });
  records[key] = row.id;
}

async function schedule(tx: TxClient, fx: Fixtures, key: string) {
  const row = await tx.platformRecurringInvoice.create({
    data: {
      businessId: fx.firmA.id,
      description: 'Fake scope schedule',
      frequency: 'MONTHLY',
      lineTemplate: [
        { description: 'Fake scope plan', quantity: 1, unitCents: 10_000, taxRateBps: 0 },
      ],
      amountCents: 10_000,
      startDate: date(30),
      nextInvoiceDate: date(30 + Math.floor(Math.random() * 300)),
      autoSend: false,
      createdByUserId: fx.users.admin.id,
    },
    select: { id: true },
  });
  records[key] = row.id;
}

/** The records Billing's writes act on. */
export async function prepareBilling(fx: Fixtures): Promise<void> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    await runInScope(owner, { kind: 'platform' }, async (tx) => {
      records.billingFirm = fx.firmA.id;
      for (const key of ['bPatch', 'bSend', 'bVoid']) await invoice(tx, fx, 'DRAFT', key);
      for (const key of ['bDuplicate', 'bPayable', 'bApplyTo']) await invoice(tx, fx, 'SENT', key);
      // A fully paid invoice's payment, to refund.
      const paid = await invoice(tx, fx, 'SENT', 'bPaid');
      const payment = await tx.platformPayment.create({
        data: {
          businessId: fx.firmA.id,
          invoiceId: paid,
          amountCents: 10_000,
          method: 'CHECK',
          status: 'COMPLETED',
          paidOn: date(),
          idempotencyKey: randomUUID(),
          recordedByUserId: fx.users.admin.id,
        },
        select: { id: true },
      });
      records.bPayment = payment.id;
      for (const key of ['cPatch', 'cIssue', 'cVoid']) await credit(tx, fx, 'DRAFT', key);
      for (const key of ['cApply', 'cRefund']) await credit(tx, fx, 'AVAILABLE', key);
      for (const key of ['ePatch', 'eDelete', 'eSend']) await estimate(tx, fx, 'DRAFT', key);
      for (const key of ['eStatus', 'eDuplicate', 'eConvert']) await estimate(tx, fx, 'SENT', key);
      for (const key of ['rPatch', 'rStatus', 'rRun']) await schedule(tx, fx, key);
    });
  } finally {
    await owner.$disconnect();
  }
}

const B = '/api/v1/admin/billing';

/** Each Billing write with a body that passes validation, in the order the sweep runs them. */
export function billingWrites(fx: Fixtures): Record<string, SupportWrite> {
  const lines = [{ description: 'Fake scope line', quantity: 1, rateCents: 10_000 }];
  const invoiceBody = () =>
    Promise.resolve({ firmId: fx.firmA.id, issueDate: day(), dueDate: day(30), lines });
  const estimateBody = () =>
    Promise.resolve({
      firmId: fx.firmA.id,
      contactName: 'Fake Scope Contact',
      email: 'scope@e2e-a.test',
      issueDate: day(),
      expirationDate: day(30),
      lines,
    });
  const creditBody = () =>
    Promise.resolve({
      firmId: fx.firmA.id,
      date: day(),
      reason: 'GOODWILL',
      method: 'ADJUSTMENT',
      adjustmentCents: 100,
    });
  const recurringBody = () =>
    Promise.resolve({
      firmId: fx.firmA.id,
      template: 'Fake scope plan',
      description: 'Fake scope schedule',
      frequency: 'MONTHLY',
      amountCents: 10_000,
      startDate: day(30),
      nextInvoiceDate: day(30),
      autoSend: false,
    });
  return {
    [`PUT ${B}/firms/:id/billing-profile`]: {
      record: 'billingFirm',
      body: { contactName: 'Fake Owner A', contactEmail: fx.users.ownerA.email },
    },
    [`PUT ${B}/settings`]: {
      body: {
        general: {
          currency: 'USD',
          invoiceTerms: 'NET_30',
          estimateValidityDays: 30,
          enablePartialPayments: true,
          footerNote: '',
        },
        taxes: { defaultTaxPercent: 0, lateFee: { enabled: false, percent: 0, graceDays: 0 } },
        reminders: {
          invoiceDue: { enabled: true, days: 3 },
          overdue: { enabled: true, days: 1, repeatEveryDays: 7, maxReminders: 3 },
          estimateExpiring: { enabled: true, days: 3 },
          failedPayment: { enabled: true, days: 1 },
        },
        templates: Object.fromEntries(
          BillingTemplateKind.options.map((k) => [
            k,
            { name: k, subject: `Fake ${k}`, body: 'Fake' },
          ]),
        ),
        preferences: DEFAULT_PREFERENCES,
      },
    },
    [`POST ${B}/invoices`]: { body: invoiceBody },
    [`PATCH ${B}/invoices/:id`]: { record: 'bPatch', body: invoiceBody },
    [`POST ${B}/invoices/:id/send`]: { record: 'bSend', body: { email: false } },
    [`POST ${B}/invoices/:id/duplicate`]: { record: 'bDuplicate', body: {} },
    [`POST ${B}/invoices/:id/void`]: { record: 'bVoid', body: { reason: 'Fake reason' } },
    [`POST ${B}/invoices/:id/payments`]: {
      record: 'bPayable',
      body: () =>
        Promise.resolve({
          requestId: randomUUID(),
          amountCents: 100,
          paidOn: day(),
          method: 'CASH',
        }),
    },
    [`POST ${B}/payments/:id/refunds`]: {
      record: 'bPayment',
      body: { type: 'PARTIAL', amountCents: 100, reason: 'Fake reason', confirmed: true },
    },
    [`POST ${B}/credit-notes`]: { body: creditBody },
    [`PATCH ${B}/credit-notes/:id`]: { record: 'cPatch', body: creditBody },
    [`POST ${B}/credit-notes/:id/issue`]: { record: 'cIssue', body: {} },
    [`POST ${B}/credit-notes/:id/apply`]: {
      record: 'cApply',
      body: () =>
        Promise.resolve({ invoiceId: records.bApplyTo, amountCents: 500, confirmed: true }),
    },
    [`POST ${B}/credit-notes/:id/refund`]: {
      record: 'cRefund',
      body: { amountCents: 100, reason: 'Fake reason' },
    },
    [`POST ${B}/credit-notes/:id/void`]: { record: 'cVoid', body: { reason: 'Fake reason' } },
    [`POST ${B}/estimates`]: { body: estimateBody },
    [`PATCH ${B}/estimates/:id`]: { record: 'ePatch', body: estimateBody },
    [`DELETE ${B}/estimates/:id`]: { record: 'eDelete', body: {} },
    [`POST ${B}/estimates/:id/send`]: { record: 'eSend', body: { email: false } },
    [`POST ${B}/estimates/:id/status`]: { record: 'eStatus', body: { status: 'APPROVED' } },
    [`POST ${B}/estimates/:id/duplicate`]: { record: 'eDuplicate', body: {} },
    [`POST ${B}/estimates/:id/convert`]: { record: 'eConvert', body: {} },
    [`POST ${B}/recurring`]: { body: recurringBody },
    [`PATCH ${B}/recurring/:id`]: { record: 'rPatch', body: recurringBody },
    [`POST ${B}/recurring/:id/status`]: { record: 'rStatus', body: { status: 'PAUSED' } },
    [`POST ${B}/recurring/:id/run`]: { record: 'rRun', body: {} },
  };
}
