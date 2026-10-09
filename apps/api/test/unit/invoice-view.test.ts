// What an invoice shows from its payments (R7 step 7): received, refunded, still to pay, and which
// payments anyone sees.
import { describe, expect, it } from 'vitest';
import {
  money,
  processing,
  shownPayments,
  type InvoiceRow,
} from '../../src/payments/invoices/invoice-view.js';

type Payment = InvoiceRow['payments'][number];
const payment = (p: Partial<Payment> & Pick<Payment, 'status'>): Payment => ({
  id: crypto.randomUUID(),
  amountCents: 10_000,
  currency: 'usd',
  failureCode: null,
  paidAt: p.status === 'SUCCEEDED' || p.status === 'REFUNDED' ? new Date() : null,
  refundReservedCents: 0,
  createdAt: new Date(),
  _count: { events: 1 },
  refunds: [],
  ...p,
});
const invoice = (status: InvoiceRow['status'], payments: Payment[]) =>
  ({ status, totalCents: 25_000, payments }) as unknown as InvoiceRow;
const refund = (amountCents: number, status: 'PENDING' | 'SUCCEEDED' | 'FAILED') => ({
  id: crypto.randomUUID(),
  amountCents,
  currency: 'usd',
  status,
  refundedAt: null,
  createdAt: new Date(),
});

describe('invoice money', () => {
  it('counts succeeded and refunded payments, confirmed refunds only, and the balance', () => {
    const row = invoice('OPEN', [
      payment({
        status: 'SUCCEEDED',
        refunds: [refund(2_000, 'SUCCEEDED'), refund(500, 'PENDING')],
      }),
      payment({ status: 'REFUNDED', amountCents: 3_000, refunds: [refund(3_000, 'SUCCEEDED')] }),
      payment({ status: 'FAILED' }),
      payment({ status: 'PENDING' }),
    ]);
    expect(money(row)).toEqual({
      amountPaidCents: 13_000,
      refundedCents: 5_000,
      balanceDueCents: 12_000,
    });
    expect(money(invoice('PAID', row.payments)).balanceDueCents).toBe(0);
    expect(money(invoice('CANCELED', [])).balanceDueCents).toBe(0);
    expect(money(invoice('DRAFT', [])).balanceDueCents).toBe(25_000);
  });

  it('hides checkouts left open or expired; a pending payment with an event is processing', () => {
    const open = payment({ status: 'PENDING', _count: { events: 0 } });
    const expired = payment({ status: 'FAILED', failureCode: 'checkout_expired' });
    const declined = payment({ status: 'FAILED', failureCode: 'card_declined' });
    const debit = payment({ status: 'PENDING' });
    expect(shownPayments(invoice('OPEN', [open, expired, declined]))).toEqual([declined]);
    expect(processing(invoice('OPEN', [open]))).toBe(false);
    expect(processing(invoice('OPEN', [open, debit]))).toBe(true);
  });
});
