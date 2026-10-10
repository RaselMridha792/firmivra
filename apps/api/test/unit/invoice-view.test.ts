// What an invoice shows from its payments (R7 steps 7 and 11): received (Stripe and offline, as
// the database's app_invoice_paid_cents), refunded, still to pay, and which payments anyone sees.
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
type Offline = InvoiceRow['offlinePayments'][number];
const offline = (amountCents: number, voided = false) =>
  ({ id: crypto.randomUUID(), amountCents, voidedAt: voided ? new Date() : null }) as Offline;
const invoice = (
  status: InvoiceRow['status'],
  payments: Payment[],
  offlinePayments: Offline[] = [],
) => ({ status, totalCents: 25_000, payments, offlinePayments }) as unknown as InvoiceRow;
const refund = (amountCents: number, status: 'PENDING' | 'SUCCEEDED' | 'FAILED') => ({
  id: crypto.randomUUID(),
  amountCents,
  currency: 'usd',
  status,
  refundedAt: null,
  createdAt: new Date(),
});

describe('invoice money', () => {
  it('counts succeeded and refunded payments in full, confirmed refunds only, and the balance', () => {
    const row = invoice('OPEN', [
      payment({
        status: 'SUCCEEDED',
        refunds: [refund(2_000, 'SUCCEEDED'), refund(500, 'PENDING')],
      }),
      payment({ status: 'REFUNDED', amountCents: 3_000, refunds: [refund(3_000, 'SUCCEEDED')] }),
      payment({ status: 'FAILED' }),
      payment({ status: 'PENDING' }),
    ]);
    // A refund never makes money owed again: the balance is the total less what was received.
    expect(money(row)).toEqual({
      amountPaidCents: 13_000,
      refundedCents: 5_000,
      balanceDueCents: 12_000,
    });
    // Live offline payments count; a voided one does not.
    expect(money(invoice('OPEN', row.payments, [offline(4_000), offline(9_000, true)]))).toEqual({
      amountPaidCents: 17_000,
      refundedCents: 5_000,
      balanceDueCents: 8_000,
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
