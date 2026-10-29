// IP-F05 (Octavia's Invoices & Payments review, Oct 27): Create Invoice's Recurring option, its
// named and custom frequencies, the end rule, and the days a schedule's invoices fall on.
import { describe, expect, it } from 'vitest';
import {
  CreateInvoiceRequest,
  InvoiceRecurrenceInput,
  RECURRING_FREQUENCY_LABELS,
  recurrenceLabel,
  RecurringFrequency,
  recurringPeriodOn,
} from '../../src/index.js';

const days = (start: string, rule: Parameters<typeof recurringPeriodOn>[1], n = 4) =>
  Array.from({ length: n }, (_, k) => recurringPeriodOn(start, rule, k));

describe('recurring frequencies', () => {
  it('offers the named ones and Custom, never one-time', () => {
    expect(RecurringFrequency.options).toEqual([
      'WEEKLY',
      'BIWEEKLY',
      'SEMI_MONTHLY',
      'MONTHLY',
      'QUARTERLY',
      'SEMIANNUAL',
      'ANNUAL',
      'CUSTOM',
    ]);
    expect(RECURRING_FREQUENCY_LABELS.SEMI_MONTHLY).toBe('Semi-monthly (twice a month)');
    expect(RECURRING_FREQUENCY_LABELS.SEMIANNUAL).toBe('Semiannual (every six months)');
  });

  it('counts every period from the start, keeping month ends', () => {
    expect(days('2026-01-31', { frequency: 'MONTHLY' })).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
    expect(days('2026-10-28', { frequency: 'WEEKLY' }, 3)).toEqual([
      '2026-10-28',
      '2026-11-04',
      '2026-11-11',
    ]);
    expect(days('2026-10-28', { frequency: 'BIWEEKLY' }, 2)[1]).toBe('2026-11-11');
    expect(days('2026-01-01', { frequency: 'SEMI_MONTHLY' })).toEqual([
      '2026-01-01',
      '2026-01-16',
      '2026-02-01',
      '2026-02-16',
    ]);
    expect(days('2026-11-30', { frequency: 'QUARTERLY' }, 2)[1]).toBe('2027-02-28');
    expect(days('2026-08-31', { frequency: 'SEMIANNUAL' }, 2)[1]).toBe('2027-02-28');
    expect(days('2028-02-29', { frequency: 'ANNUAL' }, 2)[1]).toBe('2029-02-28');
  });

  it('repeats a custom rule every N weeks, months or years', () => {
    expect(
      days('2026-10-28', { frequency: 'CUSTOM', intervalCount: 3, intervalUnit: 'WEEK' }, 3),
    ).toEqual(['2026-10-28', '2026-11-18', '2026-12-09']);
    expect(
      days('2026-10-28', { frequency: 'CUSTOM', intervalCount: 2, intervalUnit: 'MONTH' }, 3),
    ).toEqual(['2026-10-28', '2026-12-28', '2027-02-28']);
    expect(
      days('2026-10-28', { frequency: 'CUSTOM', intervalCount: 52, intervalUnit: 'YEAR' }, 2)[1],
    ).toBe('2078-10-28');
    expect(recurrenceLabel({ frequency: 'CUSTOM', intervalCount: 3, intervalUnit: 'WEEK' })).toBe(
      'Every 3 weeks',
    );
    expect(recurrenceLabel({ frequency: 'CUSTOM', intervalCount: 1, intervalUnit: 'YEAR' })).toBe(
      'Every year',
    );
    expect(recurrenceLabel({ frequency: 'QUARTERLY' })).toBe('Quarterly');
  });
});

describe('the Recurring settings a draft carries', () => {
  const ok = (r: object) => InvoiceRecurrenceInput.safeParse(r).success;

  it('takes an interval only with Custom, 1 to 52, both parts', () => {
    expect(ok({ frequency: 'CUSTOM', intervalCount: 52, intervalUnit: 'YEAR' })).toBe(true);
    expect(ok({ frequency: 'CUSTOM', intervalCount: 1, intervalUnit: 'WEEK' })).toBe(true);
    expect(ok({ frequency: 'CUSTOM', intervalCount: 53, intervalUnit: 'WEEK' })).toBe(false);
    expect(ok({ frequency: 'CUSTOM', intervalCount: 0, intervalUnit: 'WEEK' })).toBe(false);
    expect(ok({ frequency: 'CUSTOM', intervalCount: 2.5, intervalUnit: 'WEEK' })).toBe(false);
    expect(ok({ frequency: 'CUSTOM', intervalCount: 2 })).toBe(false);
    expect(ok({ frequency: 'CUSTOM', intervalUnit: 'MONTH' })).toBe(false);
    expect(ok({ frequency: 'MONTHLY', intervalCount: 2, intervalUnit: 'MONTH' })).toBe(false);
    expect(ok({ frequency: 'ONE_TIME' })).toBe(false);
  });

  it('ends never, on a date or after 2 to 120 invoices, never both', () => {
    expect(ok({ frequency: 'MONTHLY' })).toBe(true);
    expect(ok({ frequency: 'MONTHLY', endOn: '2027-06-30' })).toBe(true);
    expect(ok({ frequency: 'MONTHLY', maxOccurrences: 12 })).toBe(true);
    expect(ok({ frequency: 'MONTHLY', maxOccurrences: 1 })).toBe(false);
    expect(ok({ frequency: 'MONTHLY', maxOccurrences: 121 })).toBe(false);
    expect(ok({ frequency: 'MONTHLY', endOn: '2027-06-30', maxOccurrences: 12 })).toBe(false);
  });

  it('is optional on a draft, and a scheduled draft ends after its first invoice', () => {
    const draft = {
      clientId: '0199b6e1-0000-7000-8000-000000000001',
      lines: [{ description: 'Fake', unitAmountCents: 100 }],
      dueOn: '2026-11-30',
    };
    expect(CreateInvoiceRequest.safeParse(draft).success).toBe(true);
    expect(CreateInvoiceRequest.safeParse({ ...draft, recurring: null }).success).toBe(true);
    const scheduled = { ...draft, scheduledFor: '2026-11-10' };
    const issue = CreateInvoiceRequest.safeParse({
      ...scheduled,
      recurring: { frequency: 'WEEKLY', endOn: '2026-11-10' },
    }).error?.issues[0];
    expect(issue?.path).toEqual(['recurring', 'endOn']);
    expect(
      CreateInvoiceRequest.safeParse({
        ...scheduled,
        recurring: { frequency: 'WEEKLY', endOn: '2026-11-17' },
      }).success,
    ).toBe(true);
  });
});
