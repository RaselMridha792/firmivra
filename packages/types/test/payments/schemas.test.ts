import { describe, expect, it } from 'vitest';
import {
  DUE_SOON_DAYS,
  invoiceTotals,
  isInvoiceOverdue,
  lineAmountCents,
  MY_INVOICE_SECTIONS,
  MY_INVOICE_STATUS_LABELS,
  MY_INVOICE_VIEWS,
  MyInvoiceStatus,
  myInvoiceStatus,
} from '../../src/index.js';

const today = '2026-10-08';
const issuedAt = '2026-10-01T14:00:00.000Z';
const open = (dueOn: string | null) => ({
  status: 'OPEN' as const,
  dueOn,
  issuedAt,
  scheduledFor: null,
});

describe('amounts (the database computes them; these preview them)', () => {
  it.each([
    [1, 30_000, 30_000],
    [1.5, 333, 500], // 499.5 rounds half up, as Postgres round() does
    [0.33, 1, 0],
    [0.5, 1, 1],
    [2.25, 1_999, 4_498], // 4497.75
    [1.15, 100, 115], // 1.15 * 100 is 114.99999999999999 in floating point
    [4.35, 1_001, 4_354], // 4354.35
    [3, 0, 0],
    [10_000, 9_999, 99_990_000],
  ])('%s x %s cents is %s cents', (quantity, unit, cents) => {
    expect(lineAmountCents(quantity, unit)).toBe(cents);
  });

  it('adds the lines and takes off the discount', () => {
    expect(
      invoiceTotals({
        lines: [{ unitAmountCents: 40_000 }, { quantity: 2.5, unitAmountCents: 2_000 }],
        discountCents: 5_000,
      }),
    ).toEqual({ lineAmountsCents: [40_000, 5_000], subtotalCents: 45_000, totalCents: 40_000 });
    expect(invoiceTotals({ lines: [] })).toEqual({
      lineAmountsCents: [],
      subtotalCents: 0,
      totalCents: 0,
    });
  });
});

describe('what the client sees', () => {
  it('never shows a draft, or a draft canceled before it was sent', () => {
    const draft = { dueOn: '2026-10-31', issuedAt: null, scheduledFor: null };
    expect(myInvoiceStatus({ status: 'DRAFT', ...draft }, today)).toBe(null);
    expect(myInvoiceStatus({ status: 'DRAFT', ...draft, scheduledFor: '2026-10-20' }, today)).toBe(
      null,
    );
    expect(myInvoiceStatus({ status: 'CANCELED', ...draft }, today)).toBe(null);
  });

  it('keeps a canceled invoice the client saw: issued, or Upcoming when canceled', () => {
    const canceled = { status: 'CANCELED' as const, dueOn: '2026-10-31' };
    expect(myInvoiceStatus({ ...canceled, issuedAt, scheduledFor: null }, today)).toBe('CANCELED');
    expect(
      myInvoiceStatus({ ...canceled, issuedAt: null, scheduledFor: '2026-10-20' }, today),
    ).toBe('CANCELED');
  });

  it('maps scheduled to Upcoming and paid to Paid', () => {
    expect(
      myInvoiceStatus(
        { status: 'SCHEDULED', dueOn: '2026-11-30', issuedAt: null, scheduledFor: '2026-11-01' },
        today,
      ),
    ).toBe('UPCOMING');
    expect(
      myInvoiceStatus({ status: 'PAID', dueOn: '2026-01-01', issuedAt, scheduledFor: null }, today),
    ).toBe('PAID');
  });

  it(`shows an open invoice as Due Soon within ${DUE_SOON_DAYS} days and once past due`, () => {
    expect(myInvoiceStatus(open('2026-10-15'), today)).toBe('DUE_SOON');
    expect(myInvoiceStatus(open('2026-10-08'), today)).toBe('DUE_SOON');
    expect(myInvoiceStatus(open('2026-09-30'), today)).toBe('DUE_SOON');
    expect(myInvoiceStatus(open('2026-10-16'), today)).toBe('PENDING');
    expect(myInvoiceStatus(open(null), today)).toBe('PENDING');
    // Across a month and a year.
    expect(myInvoiceStatus(open('2027-01-04'), '2026-12-28')).toBe('DUE_SOON');
    expect(myInvoiceStatus(open('2027-01-05'), '2026-12-28')).toBe('PENDING');
  });

  it('calls only an open invoice past its due date overdue', () => {
    expect(isInvoiceOverdue(open('2026-10-07'), today)).toBe(true);
    expect(isInvoiceOverdue(open('2026-10-08'), today)).toBe(false);
    expect(isInvoiceOverdue(open(null), today)).toBe(false);
    expect(
      isInvoiceOverdue(
        { status: 'PAID', dueOn: '2026-01-01', issuedAt, scheduledFor: null },
        today,
      ),
    ).toBe(false);
  });

  it('has a label, one table and the All view for every client status', () => {
    const all = [...MyInvoiceStatus.options].sort();
    expect(Object.keys(MY_INVOICE_STATUS_LABELS).sort()).toEqual(all);
    expect([...MY_INVOICE_VIEWS.ALL].sort()).toEqual(all);
    expect([...MY_INVOICE_SECTIONS.CURRENT, ...MY_INVOICE_SECTIONS.PAST].sort()).toEqual(all);
    const views = [
      ...MY_INVOICE_VIEWS.DUE,
      ...MY_INVOICE_VIEWS.PAID,
      ...MY_INVOICE_VIEWS.UPCOMING,
      ...MY_INVOICE_VIEWS.CANCELED,
    ];
    expect(views.sort()).toEqual(all);
  });
});
