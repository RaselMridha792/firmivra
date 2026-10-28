// IP-F20 and IP-F22 (Octavia's Invoices & Payments review, Oct 27): the Payment Methods query and
// the report run's Group By.
import { describe, expect, it } from 'vitest';
import {
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
