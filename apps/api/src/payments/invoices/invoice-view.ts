import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Prisma, TxClient } from '@firmivra/db';
import {
  type FirmInvoicePayment,
  type Invoice,
  type InvoiceListItem,
  type InvoicePayment,
  isInvoiceOverdue,
  MY_INVOICE_SECTIONS,
  type MyInvoice,
  type MyInvoiceDetail,
  myInvoiceStatus,
} from '@firmivra/types';
import { firmTimeZone } from '../../appointments/calendar-data.js';

// Reads and answers shared by the firm and portal invoice routes (R7 step 7). Amounts come from
// the database; this file only sums payments and refunds for the answers.

export const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
export const conflict = (code: string, message: string) => new ConflictException({ code, message });

/** `YYYY-MM-DD` of a `@db.Date` column (stored at midnight UTC). */
export const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;
export const toDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (d: Date | null) => d?.toISOString() ?? null;

/** The firm's calendar date now (its time zone), "today" for every invoice rule. */
export async function firmToday(tx: TxClient, businessId: string, at = new Date()) {
  const timeZone = await firmTimeZone(tx, businessId);
  return { timeZone, today: dateIn(timeZone, at) };
}
export const dateIn = (timeZone: string, at: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(at);

/** The firm's Stripe account takes charges (its own row; RLS: this firm only). */
export async function paymentsEnabled(tx: TxClient, businessId: string): Promise<boolean> {
  const account = await tx.stripeAccount.findUnique({
    where: { businessId },
    select: { chargesEnabled: true },
  });
  return account?.chargesEnabled ?? false;
}

const paymentSelect = {
  id: true,
  amountCents: true,
  currency: true,
  status: true,
  failureCode: true,
  paidAt: true,
  refundReservedCents: true,
  createdAt: true,
  // Only a completed checkout means Stripe is still settling it (a bank debit); a declined card's
  // payment_intent.payment_failed never blocks Pay Now.
  _count: { select: { events: { where: { type: 'checkout.session.completed' } } } },
  refunds: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      amountCents: true,
      currency: true,
      status: true,
      refundedAt: true,
      createdAt: true,
    },
  },
} satisfies Prisma.PaymentSelect;
type PaymentRow = Prisma.PaymentGetPayload<{ select: typeof paymentSelect }>;

export const invoiceSelect = {
  id: true,
  clientId: true,
  number: true,
  status: true,
  currency: true,
  subtotalCents: true,
  discountCents: true,
  totalCents: true,
  scheduledFor: true,
  dueOn: true,
  issuedAt: true,
  paidAt: true,
  canceledAt: true,
  cancelReason: true,
  createdAt: true,
  updatedAt: true,
  client: { select: { id: true, displayName: true } },
  engagement: { select: { id: true, title: true } },
  createdBy: { select: { userId: true, user: { select: { name: true } } } },
  lines: {
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      description: true,
      quantity: true,
      unitAmountCents: true,
      amountCents: true,
    },
  },
  payments: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: paymentSelect },
} satisfies Prisma.InvoiceSelect;
export type InvoiceRow = Prisma.InvoiceGetPayload<{ select: typeof invoiceSelect }>;

/**
 * Payments shown to anyone: a checkout the client opened and left (PENDING with no event yet, or
 * expired unpaid) is not a payment. PENDING with a recorded event waits for Stripe (a bank debit).
 */
const shown = (p: PaymentRow) =>
  p.status === 'PENDING' ? p._count.events > 0 : p.failureCode !== 'checkout_expired';
export const processing = (row: InvoiceRow) =>
  row.payments.some((p) => p.status === 'PENDING' && p._count.events > 0);

const confirmedRefunds = (p: PaymentRow) =>
  p.refunds.filter((r) => r.status === 'SUCCEEDED').reduce((s, r) => s + r.amountCents, 0);

/** Received (refunded payments included), confirmed refunds, and what is still to pay. */
export function money(row: InvoiceRow) {
  const received = row.payments.filter((p) => p.status === 'SUCCEEDED' || p.status === 'REFUNDED');
  const amountPaidCents = received.reduce((s, p) => s + p.amountCents, 0);
  const refundedCents = received.reduce((s, p) => s + confirmedRefunds(p), 0);
  const closed = row.status === 'PAID' || row.status === 'CANCELED';
  // A refund never makes money owed again (a refunded invoice stays PAID).
  const balanceDueCents = closed ? 0 : Math.max(0, row.totalCents - amountPaidCents);
  return { amountPaidCents, refundedCents, balanceDueCents };
}

/** The invoice's state as `myInvoiceStatus()` reads it. */
export const stateOf = (row: InvoiceRow) => ({
  status: row.status,
  dueOn: day(row.dueOn),
  issuedAt: iso(row.issuedAt),
  scheduledFor: day(row.scheduledFor),
});

export const titleOf = (row: InvoiceRow) =>
  row.engagement?.title ?? row.lines[0]?.description ?? row.number;

const lineOf = (l: InvoiceRow['lines'][number]) => ({
  id: l.id,
  description: l.description,
  quantity: Number(l.quantity.toString()),
  unitAmountCents: l.unitAmountCents,
  amountCents: l.amountCents,
});

export function toPayment(p: PaymentRow): InvoicePayment {
  return {
    id: p.id,
    amountCents: p.amountCents,
    currency: p.currency,
    status: p.status,
    refundedCents: confirmedRefunds(p),
    paidAt: iso(p.paidAt),
    createdAt: p.createdAt.toISOString(),
  };
}

function toFirmPayment(p: PaymentRow): FirmInvoicePayment {
  return {
    ...toPayment(p),
    failureCode: p.status === 'FAILED' ? p.failureCode : null,
    refunds: p.refunds.map((r) => ({
      id: r.id,
      amountCents: r.amountCents,
      currency: r.currency,
      status: r.status,
      refundedAt: iso(r.refundedAt),
      createdAt: r.createdAt.toISOString(),
    })),
    refundableCents: p.status === 'SUCCEEDED' ? p.amountCents - p.refundReservedCents : 0,
  };
}

export const shownPayments = (row: InvoiceRow) => row.payments.filter(shown);
export const amountDetail = (row: InvoiceRow) => ({
  lines: row.lines.map(lineOf),
  subtotalCents: row.subtotalCents,
  discountCents: row.discountCents,
  amountPaidCents: money(row).amountPaidCents,
  refundedCents: money(row).refundedCents,
});

export function toListItem(row: InvoiceRow, today: string): InvoiceListItem {
  const state = stateOf(row);
  return {
    id: row.id,
    number: row.number,
    client: { id: row.client.id, displayName: row.client.displayName },
    service: row.engagement ? { id: row.engagement.id, title: row.engagement.title } : null,
    title: titleOf(row),
    status: row.status,
    clientStatus: myInvoiceStatus(state, today),
    currency: row.currency,
    totalCents: row.totalCents,
    balanceDueCents: money(row).balanceDueCents,
    scheduledFor: state.scheduledFor,
    dueOn: state.dueOn,
    overdue: isInvoiceOverdue(state, today),
    issuedAt: state.issuedAt,
    paidAt: iso(row.paidAt),
    canceledAt: iso(row.canceledAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toInvoice(row: InvoiceRow, today: string): Invoice {
  return {
    ...toListItem(row, today),
    ...amountDetail(row),
    payments: shownPayments(row).map(toFirmPayment),
    // Check and cash payments come with R0's offline_payments table (R7 step 11).
    offlinePayments: [],
    cancelReason: row.cancelReason,
    createdBy: row.createdBy
      ? { userId: row.createdBy.userId, name: row.createdBy.user.name }
      : null,
  };
}

/** The client's view of an invoice, or null when the portal never shows it (a draft). */
export function toMyInvoice(
  row: InvoiceRow,
  today: string,
  timeZone: string,
  paymentsOn: boolean,
): MyInvoice | null {
  const state = stateOf(row);
  const status = myInvoiceStatus(state, today);
  if (status === null) return null;
  const { balanceDueCents } = money(row);
  const isProcessing = processing(row);
  const issuedOn = row.issuedAt ? dateIn(timeZone, row.issuedAt) : state.scheduledFor;
  return {
    id: row.id,
    number: row.number,
    service: row.engagement ? { id: row.engagement.id, title: row.engagement.title } : null,
    title: titleOf(row),
    status,
    section: MY_INVOICE_SECTIONS.PAST.includes(status) ? 'PAST' : 'CURRENT',
    currency: row.currency,
    totalCents: row.totalCents,
    balanceDueCents,
    issuedOn: issuedOn ?? dateIn(timeZone, row.createdAt),
    dueOn: state.dueOn,
    overdue: isInvoiceOverdue(state, today),
    paidAt: iso(row.paidAt),
    canceledAt: iso(row.canceledAt),
    paymentProcessing: isProcessing,
    canPay: row.status === 'OPEN' && balanceDueCents > 0 && !isProcessing && paymentsOn,
  };
}

export function toMyInvoiceDetail(row: InvoiceRow, mine: MyInvoice): MyInvoiceDetail {
  return {
    ...mine,
    ...amountDetail(row),
    payments: shownPayments(row).map(toPayment),
    offlinePayments: [],
  };
}
