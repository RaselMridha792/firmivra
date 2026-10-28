// IP-F20, IP-F22 and IP-F06 (Octavia's Invoices & Payments review, Oct 27): the Payment Methods
// query, the report run's Group By and the firm's due rules.
import { describe, expect, it } from 'vitest';
import {
  invoiceDueState,
  PAYMENT_METHOD_LABELS,
  PaymentMethodKey,
  PaymentMethodsQuery,
  RunReportRequest,
} from '../../src/index.js';

describe('PaymentMethodsQuery', () => {
  it('takes an optional range on the calendar, start no later than end', () => {
    expect(PaymentMethodsQuery.parse({})).toEqual({});
    expect(PaymentMethodsQuery.parse({ from: '2026-01-01', to: '2026-12-31' })).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
    });
    expect(PaymentMethodsQuery.safeParse({ from: '2026-05-02', to: '2026-05-01' }).success).toBe(
      false,
    );
    expect(PaymentMethodsQuery.safeParse({ from: 'May 1' }).success).toBe(false);
    expect(PaymentMethodsQuery.safeParse({ method: 'CARD' }).success).toBe(false);
  });

  it('labels every method', () => {
    expect(PaymentMethodKey.options.map((m) => PAYMENT_METHOD_LABELS[m])).toEqual([
      'Card',
      'ACH',
      'Cash',
      'Check',
      'Other',
    ]);
  });
});

describe('RunReportRequest.breakdownBy', () => {
  it('names a field for the breakdown, this run only', () => {
    const target = { kind: 'SYSTEM', key: 'revenue_summary' } as const;
    expect(RunReportRequest.parse({ target, breakdownBy: 'method' }).breakdownBy).toBe('method');
    expect(RunReportRequest.parse({ target }).breakdownBy).toBeUndefined();
  });
});

describe('invoiceDueState (IP-F06)', () => {
  const open = (dueOn: string | null, balanceDueCents = 10_000) =>
    ({ status: 'OPEN', dueOn, balanceDueCents }) as const;
  const today = '2026-10-28';
  it('counts days on the firm’s calendar: 7 to 2 Due Soon, 1 Tomorrow, 0 Today, past Overdue', () => {
    expect(invoiceDueState(open('2026-11-05'), today)).toBeNull();
    expect(invoiceDueState(open('2026-11-04'), today)).toBe('DUE_SOON');
    expect(invoiceDueState(open('2026-10-30'), today)).toBe('DUE_SOON');
    expect(invoiceDueState(open('2026-10-29'), today)).toBe('DUE_TOMORROW');
    expect(invoiceDueState(open('2026-10-28'), today)).toBe('DUE_TODAY');
    expect(invoiceDueState(open('2026-10-27'), today)).toBe('OVERDUE');
    // Across a month and a daylight-saving change, still whole days.
    expect(invoiceDueState(open('2026-11-01'), '2026-10-31')).toBe('DUE_TOMORROW');
  });

  it('is only for an open balance with a due date', () => {
    expect(invoiceDueState(open(null), today)).toBeNull();
    expect(invoiceDueState(open('2026-10-28', 0), today)).toBeNull();
    for (const status of ['DRAFT', 'SCHEDULED', 'PAID', 'CANCELED'] as const)
      expect(
        invoiceDueState({ status, dueOn: '2026-10-28', balanceDueCents: 10_000 }, today),
      ).toBeNull();
  });
});
