// R36 (Invoices and Payments, r36_recurring_invoices): recurring schedules and their lines, the
// and the one invoice per schedule and period. Runs as the app role under RLS.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';
import { createFirms, expectInvisibleToOtherFirm } from './r36-helpers.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

let f: Awaited<ReturnType<typeof createFirms>>;
let count = 0;
const A = () => ({ businessId: f.firmA });
const firmA = () => db.forBusiness(f.firmA);
const firmB = () => db.forBusiness(f.firmB);
const day = (d: string) => new Date(`${d}T00:00:00Z`);

const schedule = (data: Record<string, unknown> = {}) =>
  firmA().recurringInvoice.create({
    data: {
      ...A(),
      clientId: f.client,
      name: `Monthly Bookkeeping ${++count}`,
      frequency: 'MONTHLY',
      startOn: day('2026-11-01'),
      nextSendOn: day('2026-11-01'),
      ...data,
    },
  });
const update = (id: string, data: Record<string, unknown>) =>
  firmA().recurringInvoice.update({ where: { id }, data });

beforeAll(async () => {
  f = await createFirms(owner, 'ri');
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), app.$disconnect(), db.disconnect()]);
});

describe('recurring invoices', () => {
  it("start ACTIVE with the screen's defaults", async () => {
    expect(await schedule()).toMatchObject({
      status: 'ACTIVE',
      autoSend: true,
      autopay: false,
      delivery: 'EMAIL_AND_PORTAL',
      occurrences: 0,
      pausedAt: null,
    });
  });

  it('are never one-time, and a live schedule has its next period on or after the start', async () => {
    await expect(schedule({ frequency: 'ONE_TIME' })).rejects.toThrow(/check constraint/i);
    await expect(schedule({ nextSendOn: null })).rejects.toThrow(/check constraint/i);
    await expect(schedule({ nextSendOn: day('2026-10-01') })).rejects.toThrow(/check constraint/i);
    for (const frequency of [
      'WEEKLY',
      'BIWEEKLY',
      'SEMI_MONTHLY',
      'QUARTERLY',
      'SEMIANNUAL',
      'ANNUAL',
    ] as const) {
      await expect(schedule({ frequency })).resolves.toBeTruthy();
    }
  });

  it('end never, on a date or after a number of invoices, not two rules at once', async () => {
    await expect(schedule({ endOn: day('2027-01-01') })).resolves.toBeTruthy();
    await expect(schedule({ maxOccurrences: 12 })).resolves.toBeTruthy();
    await expect(schedule({ endOn: day('2027-01-01'), maxOccurrences: 12 })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(schedule({ endOn: day('2026-10-01') })).rejects.toThrow(/check constraint/i);
    await expect(schedule({ maxOccurrences: 0 })).rejects.toThrow(/check constraint/i);
    const s = await schedule({ maxOccurrences: 2 });
    await expect(update(s.id, { occurrences: 3 })).rejects.toThrow(/check constraint/i);
    await expect(update(s.id, { occurrences: 2 })).resolves.toBeTruthy();
  });

  it('pause keeps the next period and history; finishing clears the next period', async () => {
    const s = await schedule();
    await expect(update(s.id, { status: 'PAUSED' })).rejects.toThrow(/check constraint/i);
    await expect(update(s.id, { status: 'PAUSED', pausedAt: new Date() })).resolves.toMatchObject({
      status: 'PAUSED',
    });
    await expect(update(s.id, { status: 'ACTIVE' })).rejects.toThrow(/check constraint/i); // pausedAt still set
    await expect(update(s.id, { status: 'ACTIVE', pausedAt: null })).resolves.toBeTruthy();
    await expect(update(s.id, { status: 'ENDED', endedAt: new Date() })).rejects.toThrow(
      /check constraint/i,
    ); // next still set
    await expect(
      update(s.id, { status: 'ENDED', endedAt: new Date(), nextSendOn: null }),
    ).resolves.toMatchObject({ status: 'ENDED', nextSendOn: null });
  });

  it('keep terms a code, a percent or fixed discount, and bounded notes and name', async () => {
    await expect(schedule({ paymentTerms: 'Net 14' })).rejects.toThrow(/check constraint/i);
    await expect(schedule({ paymentTerms: 'net_14' })).resolves.toBeTruthy();
    await expect(schedule({ discountType: 'PERCENT' })).rejects.toThrow(/check constraint/i);
    await expect(schedule({ discountType: 'PERCENT', discountPercent: 10 })).resolves.toBeTruthy();
    await expect(
      schedule({ discountType: 'PERCENT', discountPercent: 10, discountCents: 5 }),
    ).rejects.toThrow(/check constraint/i);
    await expect(schedule({ discountCents: 500 })).resolves.toBeTruthy();
    await expect(schedule({ name: '  ' })).rejects.toThrow(/check constraint/i);
    await expect(schedule({ notesToClient: 'x'.repeat(2001) })).rejects.toThrow(
      /check constraint/i,
    );
  });

  it("use the firm's own client, tax rate and template", async () => {
    const other = await runInScope(
      owner,
      { kind: 'business', businessId: f.firmB },
      async (tx) => ({
        client: await tx.client.create({ data: { businessId: f.firmB, displayName: 'B client' } }),
        rate: await tx.invoiceTaxRate.create({
          data: { businessId: f.firmB, name: 'B rate', rateBps: 100 },
        }),
        template: await tx.invoiceTemplate.create({
          data: { businessId: f.firmB, name: 'B template' },
        }),
      }),
    );
    await expect(schedule({ clientId: other.client.id })).rejects.toThrow(/foreign key/i);
    await expect(schedule({ taxRateId: other.rate.id })).rejects.toThrow(/foreign key/i);
    await expect(schedule({ templateId: other.template.id })).rejects.toThrow(/foreign key/i);
  });

  it('have lines that copy onto each invoice, with a positive quantity and a name', async () => {
    const s = await schedule();
    const line = (data: Record<string, unknown>) =>
      firmA().recurringInvoiceLine.create({
        data: {
          ...A(),
          recurringInvoiceId: s.id,
          description: 'Bookkeeping',
          unitAmountCents: 35000,
          ...data,
        },
      });
    await expect(line({})).resolves.toMatchObject({ quantity: expect.anything(), taxable: false });
    await expect(line({ quantity: 0 })).rejects.toThrow(/check constraint/i);
    await expect(line({ unitAmountCents: -1 })).rejects.toThrow(/check constraint/i);
    await expect(line({ description: ' ' })).rejects.toThrow(/check constraint/i);
    await expect(line({ itemName: ' ' })).rejects.toThrow(/check constraint/i);
    const made = await line({ itemName: 'Monthly bookkeeping' });
    await expect(
      firmA().recurringInvoiceLine.delete({ where: { id: made.id } }),
    ).resolves.toBeTruthy();
  });

  it('make one invoice per period: the link is both fields or neither', async () => {
    const s = await schedule();
    const inv = (data: Record<string, unknown>) =>
      firmA().invoice.create({
        data: { ...A(), clientId: f.client, number: `INV-${++count}`, ...data },
      });
    await expect(inv({ recurringInvoiceId: s.id })).rejects.toThrow(/check constraint/i);
    await expect(inv({ recurringPeriodOn: day('2026-11-01') })).rejects.toThrow(
      /check constraint/i,
    );
    const first = await inv({ recurringInvoiceId: s.id, recurringPeriodOn: day('2026-11-01') });
    expect(first.recurringInvoiceId).toBe(s.id);
    await expect(
      inv({ recurringInvoiceId: s.id, recurringPeriodOn: day('2026-11-01') }),
    ).rejects.toThrow(/unique/i);
    await expect(
      inv({ recurringInvoiceId: s.id, recurringPeriodOn: day('2026-12-01') }),
    ).resolves.toBeTruthy();
    await expect(inv({})).resolves.toBeTruthy(); // ordinary invoices are unaffected
  });

  it('are never deleted by the app, and are invisible to another firm', async () => {
    const s = await schedule();
    await expect(firmA().recurringInvoice.deleteMany({ where: { id: s.id } })).rejects.toThrow(
      /permission denied/i,
    );
    await firmA().recurringInvoiceLine.create({
      data: { ...A(), recurringInvoiceId: s.id, description: 'x', unitAmountCents: 100 },
    });
    const b = await runInScope(owner, { kind: 'business', businessId: f.firmB }, async (tx) => {
      const client = await tx.client.create({ data: { businessId: f.firmB, displayName: 'B2' } });
      const row = await tx.recurringInvoice.create({
        data: {
          businessId: f.firmB,
          clientId: client.id,
          name: 'B',
          frequency: 'MONTHLY',
          startOn: day('2026-11-01'),
          nextSendOn: day('2026-11-01'),
        },
      });
      await tx.recurringInvoiceLine.create({
        data: {
          businessId: f.firmB,
          recurringInvoiceId: row.id,
          description: 'y',
          unitAmountCents: 1,
        },
      });
      return row;
    });
    await expectInvisibleToOtherFirm(app, f.firmA, f.firmB, [
      'recurring_invoices',
      'recurring_invoice_lines',
    ]);
    await expect(
      firmB().recurringInvoiceLine.create({
        data: {
          businessId: f.firmB,
          recurringInvoiceId: s.id,
          description: 'z',
          unitAmountCents: 1,
        },
      }),
    ).rejects.toThrow(/foreign key/i);
    expect(b.businessId).toBe(f.firmB);
  });
});
