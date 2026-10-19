import { describe, expect, it } from 'vitest';
import {
  addDays,
  EMAIL_NOT_SET_UP,
  invoiceStatus,
  matches,
  nearestTerms,
  nextOccurrence,
  NOT_EMAILED,
  pageOf,
  refundNote,
  sendStatusOf,
  sortBy,
  templateOf,
  termsOf,
  trend,
} from '../../src/admin-billing/billing-common.js';
import { remindersOf, templatesOf } from '../../src/admin-billing/billing-settings.service.js';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('billing helpers', () => {
  it('works out the page status: Pending, Overdue, and the stored ones', () => {
    const base = { totalCents: 1000, paidCents: 0, creditedCents: 0, dueDate: d('2026-10-10') };
    expect(invoiceStatus({ ...base, status: 'SENT' }, '2026-10-09')).toBe('PENDING');
    expect(invoiceStatus({ ...base, status: 'SENT' }, '2026-10-11')).toBe('OVERDUE');
    expect(invoiceStatus({ ...base, status: 'PARTIALLY_PAID', paidCents: 400 }, '2026-10-11')).toBe(
      'OVERDUE',
    );
    expect(invoiceStatus({ ...base, status: 'PARTIALLY_PAID', paidCents: 400 }, '2026-10-10')).toBe(
      'PARTIALLY_PAID',
    );
    // Fully credited but not yet recomputed: no balance, so not overdue.
    expect(invoiceStatus({ ...base, status: 'SENT', creditedCents: 1000 }, '2026-10-11')).toBe(
      'PENDING',
    );
    for (const s of ['DRAFT', 'PAID', 'VOIDED', 'REFUNDED', 'PARTIALLY_REFUNDED'] as const)
      expect(invoiceStatus({ ...base, status: s }, '2027-01-01')).toBe(s);
  });

  it('reads the payment terms a due date matches, and the nearest of the six', () => {
    expect(termsOf('2026-10-01', '2026-10-31')).toBe('NET_30');
    expect(termsOf('2026-10-01', '2026-10-01')).toBe('DUE_ON_RECEIPT');
    expect(termsOf('2026-10-01', '2026-10-21')).toBeNull();
    expect(nearestTerms(30)).toBe('NET_30');
    expect(nearestTerms(20)).toBe('NET_15');
    expect(nearestTerms(90)).toBe('NET_60');
  });

  it('moves a schedule to its next date, keeping month ends', () => {
    expect(nextOccurrence('2026-01-31', 'MONTHLY', null)).toBe('2026-02-28');
    expect(nextOccurrence('2026-11-30', 'QUARTERLY', null)).toBe('2027-02-28');
    expect(nextOccurrence('2026-10-19', 'WEEKLY', null)).toBe('2026-10-26');
    expect(nextOccurrence('2026-10-19', 'CUSTOM', 10)).toBe('2026-10-29');
    expect(nextOccurrence('2024-02-29', 'ANNUAL', null)).toBe('2025-02-28');
    expect(nextOccurrence('2026-03-15', 'SEMIANNUAL', null)).toBe('2026-09-15');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('shows whether an issued document was emailed', () => {
    const sent = new Date();
    expect(sendStatusOf({ status: 'DRAFT', sentAt: null, sendError: null })).toBe('NOT_SENT');
    expect(sendStatusOf({ status: 'SENT', sentAt: sent, sendError: NOT_EMAILED })).toBe('NOT_SENT');
    expect(sendStatusOf({ status: 'SENT', sentAt: sent, sendError: EMAIL_NOT_SET_UP })).toBe(
      'FAILED',
    );
    expect(sendStatusOf({ status: 'PAID', sentAt: sent, sendError: null })).toBe('SENT');
  });

  it('reads the seeded reminders shape and fills the templates', () => {
    expect(remindersOf({ beforeDueDays: [3], afterDueDays: [1, 7, 14] })).toMatchObject({
      invoiceDue: { enabled: true, days: 3 },
      overdue: { enabled: true, days: 1, repeatEveryDays: 6, maxReminders: 3 },
    });
    const ours = {
      invoiceDue: { enabled: false, days: 5 },
      overdue: { enabled: true, days: 2, repeatEveryDays: 10, maxReminders: 2 },
      estimateExpiring: { enabled: true, days: 1 },
      failedPayment: { enabled: false, days: 1 },
    };
    expect(remindersOf(ours)).toEqual(ours);
    expect(remindersOf({})).toMatchObject({ invoiceDue: { enabled: true } });
    const templates = templatesOf({
      INVOICE: { name: 'Mine', subject: 'Yours', body: 'Hi' },
      ESTIMATE: 'broken',
    });
    expect(Object.keys(templates)).toHaveLength(6);
    expect(templates.INVOICE).toEqual({ name: 'Mine', subject: 'Yours', body: 'Hi' });
    expect(templates.ESTIMATE.name).toBe('Estimate');
  });

  it('keeps list paging, sorting, search and trends in one place', () => {
    expect(pageOf([1, 2, 3, 4, 5], 2, 2)).toEqual({
      items: [3, 4],
      total: 5,
      page: 2,
      pageSize: 2,
      pageCount: 3,
    });
    expect(pageOf([], 4, 10)).toMatchObject({ page: 1, pageCount: 1 });
    expect(sortBy([{ n: 2 }, { n: 10 }, { n: 1 }], (x) => x.n, true).map((x) => x.n)).toEqual([
      10, 2, 1,
    ]);
    expect(matches('inv-10 sample', 'INV-1001', 'Sample Tax')).toBe(true);
    expect(matches('payroll', 'INV-1001', 'Sample Tax')).toBe(false);
    expect(trend(150, 100)).toBe(50);
    expect(trend(5, 0)).toBeNull();
    expect(refundNote('PARTIAL', '')).toBe('[PARTIAL]');
    expect(templateOf([{ description: 'Plan', unitCents: 100 }, { nope: true }])).toEqual([
      { description: 'Plan', quantity: 1, unitCents: 100, taxRateBps: 0 },
    ]);
  });
});
