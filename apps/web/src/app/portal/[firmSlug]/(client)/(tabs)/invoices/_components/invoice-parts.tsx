'use client';

import {
  INVOICE_ERRORS,
  MY_INVOICE_STATUS_LABELS,
  type MyInvoice,
  type MyInvoiceStatus,
} from '@firmivra/types';
import { Badge, type BadgeTone, Button } from '@firmivra/ui';
import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { TipDialog } from './tip-dialog';

// Invoices Review 2 I-N07: Canceled is solid navy, as in the firm's Invoices.
const TONE: Record<MyInvoiceStatus, BadgeTone> = {
  PENDING: 'warning',
  DUE_SOON: 'danger',
  PAID: 'success',
  UPCOMING: 'info',
  CANCELED: 'navy',
};

export const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(
    cents / 100,
  );

export const day = (date: string) =>
  new Date(date.length === 10 ? `${date}T12:00:00` : date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

/** The client's status, or "Processing" while Stripe confirms a payment. */
export function InvoiceStatus({ invoice }: { invoice: MyInvoice }) {
  if (invoice.paymentProcessing) return <Badge tone="info">Processing</Badge>;
  return <Badge tone={TONE[invoice.status]}>{MY_INVOICE_STATUS_LABELS[invoice.status]}</Badge>;
}

/**
 * Pay Now: asks the API for a Stripe checkout (with the tip, Q22) and goes there. Only Stripe's
 * https link is followed; mock mode's `mock:` link opens nothing.
 */
export function usePay(slug: string) {
  return useApiMutation(async ({ id, tipCents = 0 }: { id: string; tipCents?: number }) => {
    const link = await api.myInvoices(slug).pay(id, tipCents > 0 ? { tipCents } : {});
    if (link.url.startsWith('https://')) window.location.assign(link.url);
    return link;
  });
}

/**
 * Q22 (I-N05): an invoice that offers a tip asks for it first (TipDialog); any other goes straight
 * to Stripe. Returns the start function and the dialog to render.
 */
function usePayStep(pay: ReturnType<typeof usePay>) {
  const [asking, setAsking] = useState<MyInvoice | null>(null);
  const start = (invoice: MyInvoice) =>
    invoice.tipOffered ? setAsking(invoice) : pay.mutate({ id: invoice.id });
  const dialog = asking ? (
    <TipDialog
      invoice={asking}
      busy={pay.isPending}
      onClose={() => setAsking(null)}
      onPay={(tipCents) => {
        setAsking(null);
        pay.mutate({ id: asking.id, tipCents });
      }}
    />
  ) : null;
  return { start, dialog };
}

export function PayButton({
  invoice,
  pay,
}: {
  invoice: MyInvoice;
  pay: ReturnType<typeof usePay>;
}) {
  const step = usePayStep(pay);
  return (
    <>
      <Button
        disabled={pay.isPending}
        onClick={() => step.start(invoice)}
        aria-label={`Pay ${invoice.number} now`}
        className="cursor-pointer bg-firm-button! hover:bg-firm-button-hover! focus-visible:outline-firm-primary! disabled:bg-disabled! disabled:text-disabled-text!"
      >
        Pay Now
      </Button>
      {step.dialog}
    </>
  );
}

/**
 * "Make a Payment" at the top of Receipts & Invoices (invoices tab.png): pays the soonest invoice
 * still due, as its row's Pay Now does; disabled when nothing is due (R61).
 */
export function MakePaymentButton({ slug, pay }: { slug: string; pay: ReturnType<typeof usePay> }) {
  const due = useApiQuery(['my-invoices', slug, { view: 'DUE', section: 'CURRENT' }], () =>
    api.myInvoices(slug).list({ view: 'DUE', section: 'CURRENT', limit: 1 }),
  );
  const next = due.data?.items[0];
  const step = usePayStep(pay);
  return (
    <>
      <Button
        disabled={!next || pay.isPending}
        onClick={() => next && step.start(next)}
        title={next ? `Pay ${next.number}` : 'Nothing to pay right now'}
        className="cursor-pointer gap-2 bg-firm-button! hover:bg-firm-button-hover! disabled:bg-disabled! disabled:text-disabled-text!"
      >
        Make a Payment <ArrowRight aria-hidden className="size-5" />
      </Button>
      {step.dialog}
    </>
  );
}

export function PayError({ pay }: { pay: ReturnType<typeof usePay> }) {
  return pay.isError ? (
    <p role="alert" className="text-sm text-danger">
      {errorMessage(pay.error, INVOICE_ERRORS)}
    </p>
  ) : null;
}
